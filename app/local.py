"""Moteur local, sans IA : règles + apprentissage de tes choix → tâches. Coût : zéro jeton Claude.

Les règles repèrent les demandes, les échéances, tes engagements et ce que tu attends des autres.
Un classifieur bayésien (appris sur les analyses Claude passées puis sur ce que tu coches, ignores
ou reclasses) décide si un fil mérite ton attention, son type et sa priorité.
"""
import json
import math
import re
import threading
import unicodedata
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta, timezone

import journal
import store
from analyze import guess_lot
from ingest import TICKET, is_auto
from config import ME_DOMAIN, ME_EMAIL, ME_NAME, ME_ROLE, load_people

ME_FIRST = ME_NAME.split()[0]
TODAY = None  # date figée (tests)


def _today():
    return TODAY or date.today()

# ---------------------------------------------------------------- repérage par règles
REQUEST = re.compile(
    r"\b(peux[- ]tu|pourrais[- ]tu|pouvez[- ]vous|pourriez[- ]vous|pouvons[- ]nous|pourrions[- ]nous|tu peux|tu pourrais|"
    r"vous pouvez|vous pourriez|est[- ]ce que (tu|vous) (peux|pourrais|pouvez|pourriez)|merci de(?!\s+(ton|ta|tes|votre|vos)\b)|merci d['’](?!avance)|"
    r"est[- ]il possible|serait[- ]il possible|aurais[- ]tu|auriez[- ]vous|as[- ]tu pu|avez[- ]vous pu|il faudrait|"
    r"il faut que tu|j['’]aurais besoin|j['’]ai besoin|nous avons besoin|on a besoin|besoin de (ton|votre)|"
    r"je te (laisse|demande)|je vous (laisse|demande)|stp|svp|s['’]il (te|vous) pla[iî]t|"
    r"(ton|votre) (avis|retour|aide|validation|go)|pour validation|[àa] valider|"
    r"please(?!\s+(find|note|see|be advised|do not|don.t))|could you|can you|would you|let me know(?! if you (have|need))|kindly|need you|need your|your (feedback|help|input)|"
    r"action (required|requise)|waiting for reply: customer|vous a attribu[ée]|vous a mentionn[ée]|assigned (to )?you|mentioned you)",
    re.I,
)
COMMIT = re.compile(
    r"\b(je (te|vous) (reviens|recontacte|renvoie|envoie|transmets|tiens au courant|fais un retour|confirme|pr[ée]pare)|"
    r"je reviens vers|je m['’]en (occupe|charge)|je (vais|regarde|check|m['’]occupe|traite|corrige|mets|publie|v[ée]rifie|"
    r"fais le n[ée]cessaire|suis (encore )?dessus|pr[ée]pare|reprends|termine|finalise)|"
    r"i(['’]ll| will) (check|send|get back|look|fix|update|prepare|come back)|i am (on it|working on))\b",
    re.I,
)
THANKS = re.compile(r"^\W*(merci|thanks?|thank you|bien re[çc]u|re[çc]u|parfait|super|top|nickel|ok|d['’]accord|noted|not[ée]|"
                    r"great|perfect|cool|g[ée]nial|excellent|bravo)\b", re.I)
URGENT = re.compile(r"\b(urgent|urgence|asap|au plus vite|d[èe]s que possible|rapidement|imm[ée]diat|immediately|critical|critique|"
                    r"bloquant|blocking|prioritaire|high priority|action (required|requise)|en panne|is down|ne fonctionne plus|"
                    r"not working|doesn['’]t work|hors service)", re.I)
SITE_PROBLEM = re.compile(r"\b(bug|erreur|error|ne fonctionne|not working|cass[ée]|broken|acc[eè]s|access|login|connexion|"
                          r"mot de passe|password|compte|account|page blanche|404|500|plant[ée]|crash)", re.I)
ALERT = re.compile(r"vuln[ée]rab|action requi|expir|s[ée]curit|security|update (available|required)|mise [àa] jour|"
                   r"problems? found|downtime|is down|erreur|error|alert|crash|quota|renouvel|renew|certifica|ssl|"
                   r"domaine|domain|facture|invoice|paiement|payment|[ée]ch[ée]ance|deadline", re.I)
EN_WORDS = re.compile(r"\b(the|you|please|could|would|thanks|regards|with|this|that|will|have)\b", re.I)
FR_WORDS = re.compile(r"\b(le|la|les|des|vous|merci|pour|avec|cette|est|sont|nous|bonjour)\b", re.I)

# Demande → titre à l'infinitif : « Peux-tu m'envoyer le fichier ? » → « Envoyer le fichier »
LEAD = re.compile(
    r"^.*?\b(peux[- ]tu|pourrais[- ]tu|pouvez[- ]vous|pourriez[- ]vous|pouvons[- ]nous|tu peux|tu pourrais|vous pouvez|"
    r"vous pourriez|merci de(?!\s+(ton|ta|tes|votre|vos)\b)|merci d['’](?!avance)(?=\w)|il faudrait|aurais[- ]tu la possibilit[ée] de|"
    r"serait[- ]il possible de|est[- ]il possible de|j['’]aurais besoin que tu|could you|can you|would you|please)\s*", re.I)
PRONOUN = re.compile(r"^(me |m['’]|nous |lui |leur |te |t['’]|me$)", re.I)
TAIL = re.compile(r"[\s,;:.!?]*(stp|svp|s['’]il (te|vous) pla[iî]t|please|merci( beaucoup| d['’]avance)?|thanks?( you)?)?[\s,;:.!?]*$", re.I)

# Engagement « je t'envoie X » → « Envoyer X »
VERB_INF = {"envoie": "Envoyer", "renvoie": "Renvoyer", "transmets": "Transmettre", "regarde": "Regarder", "check": "Vérifier",
            "corrige": "Corriger", "publie": "Publier", "mets": "Mettre", "vérifie": "Vérifier", "verifie": "Vérifier",
            "traite": "Traiter", "prépare": "Préparer", "prepare": "Préparer", "confirme": "Confirmer", "reprends": "Reprendre",
            "termine": "Terminer", "finalise": "Finaliser", "reviens": "Revenir", "recontacte": "Recontacter", "fais": "Faire"}

WEEKDAYS = {"lundi": 0, "mardi": 1, "mercredi": 2, "jeudi": 3, "vendredi": 4, "samedi": 5, "dimanche": 6,
            "monday": 0, "tuesday": 1, "wednesday": 2, "thursday": 3, "friday": 4, "saturday": 5, "sunday": 6}
MONTHS = {"janvier": 1, "janv": 1, "january": 1, "jan": 1, "février": 2, "fevrier": 2, "févr": 2, "february": 2, "feb": 2,
          "mars": 3, "march": 3, "mar": 3, "avril": 4, "avr": 4, "april": 4, "apr": 4, "mai": 5, "may": 5, "juin": 6,
          "june": 6, "jun": 6, "juillet": 7, "juil": 7, "july": 7, "jul": 7, "août": 8, "aout": 8, "august": 8, "aug": 8,
          "septembre": 9, "sept": 9, "september": 9, "sep": 9, "octobre": 10, "october": 10, "oct": 10, "novembre": 11,
          "november": 11, "nov": 11, "décembre": 12, "decembre": 12, "december": 12, "déc": 12, "dec": 12}
_MON = "|".join(sorted(MONTHS, key=len, reverse=True))
DATE_NUM = re.compile(r"\b(\d{1,2})/(\d{1,2})(?:/(\d{2,4}))?\b|\b(\d{1,2})\.(\d{1,2})\.(\d{2,4})\b")
DATE_DM = re.compile(rf"\b(\d{{1,2}})(?:er|st|nd|rd|th)?\s+(?:de\s+|of\s+)?({_MON})\.?\b(?:\s+(\d{{4}}))?", re.I)
DATE_MD = re.compile(rf"\b({_MON})\.?\s+(\d{{1,2}})(?:st|nd|rd|th)?\b(?:,?\s+(\d{{4}}))?", re.I)
CUE = re.compile(r"(avant|d['’]ici|pour|au plus tard|jusqu['’]|by|before|until|due|deadline|[ée]ch[ée]ance|limite|no later than)\W+(le\W+|the\W+)?$", re.I)

GREETING = re.compile(r"^\s*(bonjour|bonsoir|hello|hi|salut|coucou|dear|hey)\b[^\n,]*[,\n!]?\s*", re.I)
BOILERPLATE = re.compile(r"^.*(above this line|au-dessus de cette ligne|do not reply to this|ne pas r[ée]pondre [àa] ce|difficult[ée]s d.affichage|probl[èe]mes? d.affichage|trouble viewing|view (it|this e?-?mail) in (your|a) browser|version (en ligne|web)).*$", re.I | re.M)
SENTENCE = re.compile(r"(?<=[.!?])\s+|\n+")


def _norm(text):
    text = unicodedata.normalize("NFKD", (text or "").lower())
    return "".join(c for c in text if not unicodedata.combining(c))


def _sentences(text):
    return [s.strip() for s in SENTENCE.split(text or "") if len(s.strip()) > 3]


def _business_days(start, n):
    d = start
    while n > 0:
        d += timedelta(days=1)
        if d.weekday() < 5:
            n -= 1
    return d


def _friday(d):
    return d + timedelta(days=(4 - d.weekday()) % 7)


def _mk(y, m, d, ref):
    try:
        out = date(y or ref.year, m, d)
    except ValueError:
        return None
    if not y and out < ref - timedelta(days=7):
        out = date(ref.year + 1, m, d)
    return out


def find_deadline(texts, ref):
    """Échéance écrite dans le texte → (date, 'explicite'|'estimee') ou (None, 'aucune')."""
    found = []
    for text in texts:
        if not text:
            continue
        low = _norm(text)
        for m in DATE_NUM.finditer(text):
            g = m.groups()
            d, mo, y = (g[0], g[1], g[2]) if g[0] else (g[3], g[4], g[5])
            y = int(y) + (2000 if y and len(y) == 2 else 0) if y else None
            if 1 <= int(mo) <= 12:
                found.append((_mk(y, int(mo), int(d), ref), "explicite"))
        for m in DATE_DM.finditer(text):
            found.append((_mk(int(m.group(3)) if m.group(3) else None, MONTHS[m.group(2).lower()], int(m.group(1)), ref), "explicite"))
        for m in DATE_MD.finditer(text):
            found.append((_mk(int(m.group(3)) if m.group(3) else None, MONTHS[m.group(1).lower()], int(m.group(2)), ref), "explicite"))
        if re.search(r"\b(apres[- ]demain|day after tomorrow)\b", low):
            found.append((ref + timedelta(days=2), "explicite"))
        elif re.search(r"\b(demain|tomorrow)\b", low):
            found.append((ref + timedelta(days=1), "explicite"))
        if re.search(r"\b(aujourd'hui|aujourd’hui|ce soir|today|tonight|eod|end of (the )?day|ce matin|cet apres-midi)\b", low):
            found.append((ref, "explicite"))
        if re.search(r"\b(asap|au plus vite|des que possible|urgent|rapidement|immediately)\b", low):
            found.append((_business_days(ref, 1), "estimee"))
        if re.search(r"\b(semaine prochaine|next week)\b", low):
            found.append((_friday(ref) + timedelta(days=7), "estimee"))
        elif re.search(r"\b(fin de (la )?semaine|cette semaine|end of (the )?week|this week)\b", low):
            found.append((_friday(ref), "estimee"))
        if re.search(r"\b(fin du mois|fin de mois|end of (the )?month)\b", low):
            nxt = (ref.replace(day=28) + timedelta(days=4)).replace(day=1)
            found.append((nxt - timedelta(days=1), "estimee"))
        m = re.search(r"\b(?:dans|in) (\d{1,2}) (jours|days)\b", low)
        if m:
            found.append((ref + timedelta(days=int(m.group(1))), "explicite"))
        for name, wd in WEEKDAYS.items():
            if re.search(rf"\b{name}\b", low):
                delta = (wd - ref.weekday()) % 7 or 7
                found.append((ref + timedelta(days=delta), "explicite"))
    found = [f for f in found if f[0] and f[0] >= ref]
    if not found:
        return None, "aucune"
    return min(found, key=lambda f: f[0])


def _cue_texts(body):
    """Passages qui suivent « avant / d'ici / pour le / by… » : une date à cet endroit est une échéance."""
    out = []
    for m in DATE_NUM.finditer(body or ""):
        if CUE.search(body[max(0, m.start() - 30):m.start()]):
            out.append(body[max(0, m.start() - 30):m.end()])
    for rx in (DATE_DM, DATE_MD):
        for m in rx.finditer(body or ""):
            if CUE.search(body[max(0, m.start() - 30):m.start()]):
                out.append(body[max(0, m.start() - 30):m.end()])
    return out


def _clip(text, n=80):
    text = re.sub(r"\s+", " ", text or "").strip()
    return text if len(text) <= n else text[:n].rsplit(" ", 1)[0] + "…"


def _subject(s):
    s = re.sub(r"^\s*((re|tr|fw|fwd|aw|wg|réf)\s*:\s*)+", "", s or "", flags=re.I).strip()
    m = TICKET.search(s)
    if m:  # « [Support] Action #4821] (Waiting for reply: Provider) Alerte plugin… » → « Ticket 4821 — Alerte plugin… »
        rest = re.sub(r"^\s*\]\s*", "", s[m.end():])
        rest = re.sub(r"\((waiting for reply:[^)]*|resolved|closed|[^)]*attente[^)]*)\)\s*", "", rest, flags=re.I).strip(" -:")
        return f"Ticket {m.group(2)}" + (f" — {rest}" if rest else "")
    return s or "(sans objet)"


def _first_name(addr=None, name=None):
    if not name and addr:
        rows = store.query("SELECT from_name FROM messages WHERE from_addr=? AND from_name != '' LIMIT 1", (addr,))
        name = rows[0]["from_name"] if rows else addr.split("@")[0]
    parts = [p for p in re.split(r"[\s,]+", name or "") if p]
    for p in parts:  # « Léa MARTIN » → Léa ; « MARTIN Léa » → Léa
        if not p.isupper() and p[:1].isalpha():
            return p.strip("'\"")
    return (parts[0].title() if parts else "").strip("'\"")


def _ticket(subject):
    """Statut d'un ticket de support d'après son objet : 'resolu', 'prestataire' (on attend le support), 'client' ou None."""
    if not TICKET.search(subject or ""):
        return None
    if re.search(r"\((resolved|closed|r[ée]solu|ferm[ée]|cl[oô]tur[ée])\)", subject, re.I):
        return "resolu"
    if re.search(r"waiting for reply:\s*customer|attente (du )?client", subject, re.I):
        return "client"
    if re.search(r"waiting for reply:|en attente", subject, re.I):
        return "prestataire"
    return None


def _pick_request(msgs):
    """Le message reçu le plus récent qui te demande quelque chose, depuis ton dernier envoi dans le fil."""
    since = max((m["date_utc"] for m in msgs if m["direction"] == "out"), default="")
    for m in reversed(msgs):
        if m["direction"] != "in" or m["date_utc"] <= since:
            continue
        sender = (m["from_addr"] or "").lower()
        body = BOILERPLATE.sub("", m["body"] or "")
        named = ME_FIRST.lower() in _norm(body)
        if m["is_noise"] or m["is_form"] or is_auto(sender) or not (m["me_role"] in ("to", "other") or named):
            continue
        if any(REQUEST.search(x) or (x.endswith("?") and len(x) > 12) for x in _sentences(body)):
            return m
    return None


def _english(text):
    return len(EN_WORDS.findall(text or "")) > len(FR_WORDS.findall(text or "")) + 2


def _is_colleague(addr):
    return (addr or "").lower().endswith("@" + ME_DOMAIN)


def _request_title(sentence):
    m = LEAD.match(sentence)
    if not m:
        return None
    rest = PRONOUN.sub("", sentence[m.end():].strip())
    rest = re.sub(r",?\s*\b(stp|svp)\b", "", TAIL.sub("", rest), flags=re.I).strip(" ,;:-")
    if len(rest) < 6:
        return None
    return _clip(rest[0].upper() + rest[1:])


def _commit_title(sentence, to_first):
    m = re.search(r"\bje (te |vous |t['’]|lui )?(vais|reviens vers|reviens|m['’]en occupe|m['’]en charge|\w+)\s*(.*)", sentence, re.I)
    if not m:
        return None
    verb, rest = m.group(2).lower(), TAIL.sub("", m.group(3) or "").strip(" ,;:-")
    if verb == "vais" and rest:
        return _clip(rest[0].upper() + rest[1:])
    if verb.startswith("reviens"):
        return _clip(f"Revenir vers {to_first}" + (f" {rest}" if rest else ""))
    if verb in VERB_INF:
        return _clip(f"{VERB_INF[verb]} {rest}".strip() + (f" à {to_first}" if to_first and verb in ("envoie", "renvoie", "transmets") else ""))
    return None


# ---------------------------------------------------------------- annuaire : suggestion de transfert
_STOP = set("de des du la le les et en au aux un une pour sur avec par ses son contenus contenu infos info demandes demande".split())


def _people_keywords():
    mine = set(re.findall(r"\w{4,}", _norm(ME_ROLE)))
    out = []
    for p in load_people():
        words = {w for w in re.findall(r"\w{4,}", _norm(p.get("sujets", ""))) if w not in _STOP and w not in mine}
        out.append((p, words))
    return out


def _delegate(text, sender):
    low, best = _norm(text), (None, 0)
    for p, words in _people_keywords():
        if p["email"] in (ME_EMAIL, sender):
            continue
        score = sum(1 for w in words if re.search(rf"\b{re.escape(w)}", low))
        if score > best[1]:
            best = (p, score)
    return best[0] if best[1] >= 2 else None


def _vips():
    return {p["email"] for p in load_people() if re.search(r"\b(VP|Head|Direct|CEO|Pr[ée]sident)", p.get("role", ""))}


# ---------------------------------------------------------------- apprentissage (Bayes naïf)
WORD = re.compile(r"[a-z][a-z0-9'-]{2,}")
STOPWORDS = set("""les des une pour avec dans sur par pas que qui est sont mais vous nous elle ils ete etre avoir fait cette ces
son ses aux the and for you your with this that are have from will not but can our was all any bonjour merci cordialement
regards thanks best hello hi dear bien bonne journee""".split()) | set(_norm(ME_NAME).split())


_known_cache = {"at": 0.0, "set": set()}


def _known(addr):
    """Correspondant réel : un collègue, ou quelqu'un à qui tu as déjà écrit (le marketing n'y est jamais)."""
    if _is_colleague(addr) and not is_auto(addr):
        return True
    now = datetime.now().timestamp()
    if now - _known_cache["at"] > 300:
        seen = set()
        for r in store.query("SELECT to_addrs, cc_addrs FROM messages WHERE direction='out'"):
            seen.update(a.strip().lower() for a in f"{r['to_addrs'] or ''},{r['cc_addrs'] or ''}".split(",") if a.strip())
        _known_cache.update(at=now, set=seen)
    return (addr or "").lower() in _known_cache["set"]


def features(thread_key):
    msgs = store.query("SELECT * FROM messages WHERE thread_key=? ORDER BY date_utc", (thread_key,))
    if not msgs:
        return []
    last = msgs[-1]
    inbound = [m for m in msgs if m["direction"] == "in"]
    ref = inbound[-1] if inbound else last
    text = _norm(f"{ref['subject']} {(ref['body'] or '')[:600]}")
    toks = [w for w in WORD.findall(text) if w not in STOPWORDS]
    addr = (ref["from_addr"] or "").lower()
    toks += [f"__from:{addr}", f"__dom:{addr.split('@')[-1]}", f"__role:{ref['me_role']}", f"__last:{last['direction']}",
             f"__folder:{_norm(ref['folder'] or '')}"]
    body = ref["body"] or ""
    if "?" in body:
        toks.append("__question")
    if REQUEST.search(body):
        toks.append("__request")
    if ref["is_form"]:
        toks.append("__form")
    if thread_key.startswith("a:"):
        toks.append("__auto")
    if ALERT.search(f"{ref['subject']} {body[:400]}"):
        toks.append("__alert")
    if ME_FIRST.lower() in _norm(body):
        toks.append("__named")
    toks.append("__known" if _known(addr) else "__unknown")
    return toks


class NaiveBayes:
    def __init__(self):
        self.docs, self.tok, self.tot, self.vocab = Counter(), defaultdict(Counter), Counter(), set()

    def add(self, toks, label, w=1.0):
        self.docs[label] += w
        for t in set(toks):
            self.tok[label][t] += w
            self.tot[label] += w
            self.vocab.add(t)

    def proba(self, toks):
        if len(self.docs) < 2:
            return {}
        n, v = sum(self.docs.values()), len(self.vocab) + 1
        toks = [t for t in set(toks) if t in self.vocab]
        scores = {}
        for label, nd in self.docs.items():
            s = sum(math.log((self.tok[label][t] + 1) / (self.tot[label] + v)) for t in toks)
            # adoucissement : avec quelques centaines d'exemples, Bayes naïf est trop sûr de lui
            scores[label] = math.log(nd / n) + s * 0.35
        top = max(scores.values())
        ex = {k: math.exp(s - top) for k, s in scores.items()}
        z = sum(ex.values())
        return {k: e / z for k, e in ex.items()}


_models = {"attention": NaiveBayes(), "kind": NaiveBayes(), "priority": NaiveBayes(), "n": 0, "user": 0, "sig": None}
_mlock = threading.Lock()


def _signature():
    r = store.query("SELECT COUNT(*) n, MAX(updated_at) u FROM tasks WHERE user_edited=1")[0]
    c = store.query("SELECT COUNT(*) n FROM threads WHERE analyzed_by IN ('claude','ia')")[0]["n"]
    return (r["n"], r["u"], c)


def train(force=False):
    """(Ré)apprend à partir des analyses Claude passées et de tes décisions (qui pèsent 3 fois plus)."""
    sig = _signature()
    if not force and sig == _models["sig"]:
        return
    att, kind, prio = NaiveBayes(), NaiveBayes(), NaiveBayes()
    labels = {}  # thread_key → (attention, poids)
    for th in store.query("SELECT thread_key FROM threads WHERE analyzed_by IN ('claude','ia') AND all_noise=0"):
        labels[th["thread_key"]] = (0, 1.0)
    user = 0
    for t in store.query("SELECT thread_key, kind, priority, status, user_edited, source FROM tasks"):
        key = t["thread_key"]
        if t["user_edited"]:
            user += 1
            useful = t["status"] != "ignore"
            prev = labels.get(key, (0, 0))
            # une seule tâche utile suffit à rendre le fil utile ; sinon tes « Ignorer » l'emportent sur Claude
            labels[key] = (1, 3.0) if useful or (prev[1] >= 3 and prev[0] == 1) else (0, 3.0)
            if useful:
                kind.add(features(key), t["kind"], 3.0)
                prio.add(features(key), t["priority"] or "moyenne", 3.0)
        elif t["source"] in ("claude", "ia") and t["kind"] != "info":  # lectures par une IA = exemples
            if labels.get(key, (0, 0))[1] < 3:
                labels[key] = (1, 1.0)
            kind.add(features(key), t["kind"], 1.0)
            prio.add(features(key), t["priority"] or "moyenne", 1.0)
    for key, (y, w) in labels.items():
        att.add(features(key), y, w)
    with _mlock:
        _models.update(attention=att, kind=kind, priority=prio, n=len(labels), user=user, sig=sig)


def stats():
    return {"examples": _models["n"], "decisions": _models["user"]}


def _p(model, toks):
    with _mlock:
        return _models[model].proba(toks)


# ---------------------------------------------------------------- analyse d'un fil
def _ref_date(m):
    return datetime.fromisoformat(m["date_utc"]).astimezone().date()


def analyze(thread_key):
    """Renvoie (items, closes) : tâches proposées et statut des anciennes (« repondu », « reponse »)."""
    msgs = store.query("SELECT * FROM messages WHERE thread_key=? ORDER BY date_utc", (thread_key,))
    if not msgs or all(m["is_noise"] for m in msgs):
        return [], None
    last = msgs[-1]
    today = _today()
    age = (today - _ref_date(last)).days
    toks = features(thread_key)
    p_att = _p("attention", toks).get(1)
    trained = _models["n"] >= 40
    items = []

    if last["direction"] == "out":
        body, ref = last["body"] or "", _ref_date(last)
        to = [a.strip() for a in (last["to_addrs"] or "").split(",") if a.strip() and a.strip() != ME_EMAIL and not is_auto(a.strip())]
        to_first = _first_name(to[0]) if to else ""
        commit = next((s for s in _sentences(body) if COMMIT.search(s)), None)
        ask = next((s for s in _sentences(body) if s.endswith("?") or REQUEST.search(s)), None)
        if age <= 30 and commit:
            dl, dlt = find_deadline([commit], ref)
            if not dl:
                dl, dlt = _business_days(ref, 2), "estimee"
            items.append(_item("engagement", _commit_title(commit, to_first) or f"Tenir mon engagement : {_clip(_subject(last['subject']), 55)}",
                               commit, dl, dlt, last, to_first, 0.65, toks))
        if age <= 30 and ask and to:
            dl, dlt = find_deadline([ask], ref)
            relance = _business_days(ref, 3)
            items.append(_item("en_attente", f"Relancer {to_first} si pas de réponse : {_clip(_subject(last['subject']), 45)}",
                               ask, max(dl, relance) if dl else relance, "estimee", last, to_first, 0.6, toks))
        return items, "repondu"

    # Dernier message reçu — ou, s'il ne te demande rien, la dernière demande qui t'a été faite depuis ta dernière réponse
    last = _pick_request(msgs) or last
    body, ref = last["body"] or "", _ref_date(last)
    body = BOILERPLATE.sub("", body)
    sender = (last["from_addr"] or "").lower()
    first = _first_name(sender, last["from_name"])
    named = ME_FIRST.lower() in _norm(body)
    if last["is_form"] and not (SITE_PROBLEM.search(f"{last['subject']} {body[:800]}") or named):
        return [], "reponse"
    ticket = _ticket(last["subject"])
    if ticket == "resolu":
        return [], "resolu"
    if ticket == "prestataire":  # quelqu'un de ton équipe a répondu (toi ou un collègue) : on attend le prestataire
        title = f"Attendre la réponse du support : {_clip(_subject(last['subject']), 55)}"
        return [_item("en_attente", title, _clip(body, 160), _business_days(ref, 3), "estimee", last, first, 0.7, toks)], "repondu"
    sents = _sentences(body)
    asks = [s for s in sents if REQUEST.search(s) or (s.endswith("?") and len(s) > 12)]
    core = GREETING.sub("", body)
    thanks_only = len(core) < 250 and bool(THANKS.match(core)) and not asks
    if thanks_only and len(msgs) > 1:
        return [], "reponse"
    direct = last["me_role"] in ("to", "other") or named
    alert = bool(ALERT.search(f"{last['subject']} {body[:400]}")) and (thread_key.startswith("a:") or not _is_colleague(sender))
    strong = bool(asks) and direct and (_known(sender) or named)
    p = p_att if trained else None

    # Décision : règles d'abord, l'apprentissage tranche les cas douteux et écarte ce que tu ignores toujours
    if strong:  # demande directe d'un collègue : toujours gardée ; d'un correspondant connu : sauf si tu l'ignores toujours
        keep = _is_colleague(sender) or p is None or p >= 0.12
    elif asks and direct:  # demande d'un inconnu (plateforme, prestataire, marketing…) : l'apprentissage tranche
        keep = p is not None and p >= 0.5
    elif alert:
        keep = p >= 0.45 if p is not None else bool(URGENT.search(f"{last['subject']} {body[:400]}"))
    else:
        keep = p is not None and p >= 0.7 and direct
    if age > 30:  # fil ancien : seulement ce qui reste vraiment ouvert
        keep = keep and p is not None and p >= 0.6
    if not keep:
        if (direct or alert) and not last["is_noise"] and age <= 14 and not thanks_only:
            # pas de demande claire : à trier, en « Pour info » (sauf ce que tu ignores d'habitude)
            if not (p is not None and p < 0.15):
                return [_item("info", f"À lire : {_clip(_subject(last['subject']), 70)}", _clip(body, 160), None, "aucune",
                              last, first, round(p_att or 0.4, 2), toks)], "reponse"
        return [], "reponse"

    evidence = asks[0] if asks else (sents[0] if sents else last["subject"])
    dl, dlt = find_deadline(asks + _cue_texts(body) + [last["subject"]], ref)
    kinds = _p("kind", toks)
    kind = "a_faire"
    if not strong and kinds:
        kind = max(kinds, key=kinds.get)
        kind = kind if kind in ("a_faire", "a_transferer") else "a_faire"
    assigned = re.search(r"vous a (attribu|mentionn)|assigned|mentioned you", f"{last['subject']} {evidence}", re.I)
    if (alert and not strong) or assigned:  # alerte ou tâche attribuée (Planner, SharePoint…) : l'objet dit tout
        title = f"Traiter : {_clip(_subject(last['subject']), 70)}"
    else:
        title = next((t for t in (_request_title(s) for s in asks) if t), None) or \
            (f"Répondre à {first} : {_clip(_subject(last['subject']), 55)}" if asks else f"Traiter : {_clip(_subject(last['subject']), 70)}")
    conf = 0.55 + 0.4 * (p_att if p_att is not None else 0.5) if strong else (p_att or 0.5)
    it = _item(kind, title, evidence, dl, dlt, last, first, round(min(conf, 0.95), 2), toks)
    who = _delegate(f"{last['subject']} {body[:1500]}", sender)
    if who:
        it["delegate_to"], it["delegate_reason"] = who["nom"], f"Sujet de son périmètre : {who['sujets']}"
    return [it], "reponse"


def _item(kind, title, evidence, deadline, dl_type, msg, first, conf, toks):
    prio = _priority(kind, evidence, deadline, msg, toks)
    when = deadline.strftime("%d/%m") if deadline else None
    if kind in ("a_faire", "a_transferer"):
        steps = ["Relire la demande et les pièces jointes" if msg["has_attachments"] else "Relire la demande",
                 "Faire le nécessaire" + (f" avant le {when}" if when else ""),
                 f"Répondre à {first} pour confirmer" if first else "Confirmer que c'est fait"]
    elif kind == "engagement":
        steps = [f"Faire ce que j'ai promis : « {_clip(evidence, 90)} »", f"Envoyer le résultat à {first}" if first else "Envoyer le résultat"]
    elif kind == "en_attente":
        steps = [f"Attendre la réponse de {first}" + (f" jusqu'au {when}" if when else ""), f"Relancer {first} si rien n'est arrivé"]
    else:
        steps = []
    return {"kind": kind, "title": title, "summary": _clip(evidence, 200), "deadline": deadline.isoformat() if deadline else None,
            "deadline_type": dl_type if deadline else "aucune", "priority": prio, "delegate_to": None, "delegate_reason": None,
            "steps": steps, "draft_reply": template_reply(kind, msg, deadline, first), "evidence": _clip(evidence, 160), "confidence": conf}


def template_reply(kind, msg, deadline=None, first=None):
    """Réponse type, sans IA : accusé de réception, « comme promis » ou relance."""
    if isinstance(deadline, str):
        deadline = date.fromisoformat(deadline) if deadline else None
    other = msg["from_addr"] if msg["direction"] == "in" else (msg["to_addrs"] or "").split(",")[0].strip()
    if first is None:
        first = _first_name(other, msg["from_name"] if msg["direction"] == "in" else None)
    english, tu, sign = _english(msg["body"] or ""), _is_colleague(other), ME_FIRST
    when = deadline.strftime("%d/%m") if deadline else None
    hello = f"Hello {first}," if english else f"Bonjour {first}," if first else "Bonjour,"
    bye = f"Best regards,\n{sign}" if english else (f"Bonne journée,\n{sign}" if tu else f"Bien cordialement,\n{sign}")
    if kind in ("a_faire", "a_transferer"):
        if english:
            return f"{hello}\n\nThanks for your message, I'm on it and will get back to you" + (f" by {when}." if when else " shortly.") + f"\n\n{bye}"
        return (f"{hello}\n\nMerci pour {'ton' if tu else 'votre'} message, je m'en occupe et {'je te' if tu else 'je vous'} reviens"
                + (f" d'ici le {when}." if when else " rapidement.") + f"\n\n{bye}")
    if kind == "engagement":
        return f"{hello}\n\nAs promised, here is …\n\n{bye}" if english else f"{hello}\n\nComme promis, voici …\n\n{bye}"
    if kind == "en_attente":
        if english:
            return f"{hello}\n\nJust following up on my previous email: any news on this?\n\nThanks,\n{sign}"
        return (f"{hello}\n\nJe me permets de revenir vers {'toi' if tu else 'vous'} au sujet de mon précédent message : "
                f"{'as-tu' if tu else 'avez-vous'} pu avancer ?\n\nMerci,\n{sign}")
    return None


def llm_candidate(thread_key):
    """Le fil mérite-t-il une lecture par l'IA locale ? (récent, adressé à toi, ou écrit par toi, hors bruit et formulaires)"""
    rows = store.query("SELECT * FROM messages WHERE thread_key=? ORDER BY date_utc DESC LIMIT 1", (thread_key,))
    if not rows:
        return False
    last = rows[0]
    body = last["body"] or ""
    if last["is_noise"] or (_today() - _ref_date(last)).days > 30:
        return False
    if _ticket(last["subject"]) in ("prestataire", "resolu"):  # le statut du ticket suffit : on attend le support, ou c'est fini
        return False
    if last["direction"] == "out":
        return True
    named = ME_FIRST.lower() in _norm(body)
    if last["is_form"] and not (named or SITE_PROBLEM.search(f"{last['subject']} {body[:800]}")):
        return False
    return last["me_role"] in ("to", "other") or named or bool(ALERT.search(f"{last['subject']} {body[:400]}"))


def _priority(kind, evidence, deadline, msg, toks):
    if kind == "info":
        return "basse"
    text = f"{msg['subject']} {evidence}"
    if URGENT.search(text) or (deadline and deadline <= _today() + timedelta(days=2)):
        return "haute"
    learned = _p("priority", toks)
    if learned and max(learned.values()) >= 0.6:
        return max(learned, key=learned.get)
    if msg["direction"] == "in" and (msg["from_addr"] or "").lower() in _vips():
        return "haute"
    if msg["me_role"] == "cc" or (deadline and deadline > _today() + timedelta(days=14)):
        return "basse"
    return "moyenne"


# ---------------------------------------------------------------- application en base
OPEN = "('a_faire','en_cours','en_attente')"


def apply(thread_key):
    items, closes = analyze(thread_key)
    now = store.now_iso()
    auto = f"thread_key=? AND user_edited=0 AND status IN {OPEN}"
    if closes == "resolu":  # ticket résolu ou fermé : plus rien à faire ni à attendre
        store.execute(f"UPDATE tasks SET status='fait', updated_at=?, notes=TRIM(COALESCE(notes,'') || ' [ticket résolu]') "
                      f"WHERE {auto}", (now, thread_key))
    elif closes == "repondu":  # tu as écrit dans le fil : est traitée chaque demande dont tu as répondu à l'auteur
        import llm
        for t in store.query(f"SELECT id, kind, evidence FROM tasks WHERE {auto} AND kind IN ('a_faire','a_transferer','info')",
                             (thread_key,)):
            probe = {"items": [{"kind": t["kind"], "evidence": t["evidence"]}]}
            llm._drop_answered(thread_key, probe)
            if not probe["items"]:
                store.execute("UPDATE tasks SET status='fait', updated_at=?, notes=TRIM(COALESCE(notes,'') || ' [répondu dans le fil]') "
                              "WHERE id=?", (now, t["id"]))
    elif closes == "reponse":  # on m'a répondu : l'attente est terminée
        store.execute(f"UPDATE tasks SET status='fait', updated_at=?, notes=TRIM(COALESCE(notes,'') || ' [réponse reçue]') "
                      f"WHERE {auto} AND kind='en_attente'", (now, thread_key))
    from analyze import respect_decisions
    items, _, stale = respect_decisions(thread_key, items)  # ce que tu as déjà réglé ne revient pas
    # les demandes restées sans réponse (ex. un simple transfert à un tiers) restent ouvertes ; le reste est recalculé
    keep = " AND kind NOT IN ('a_faire','a_transferer')" if closes == "repondu" else ""
    if not stale:
        store.execute(f"DELETE FROM tasks WHERE {auto}{keep}", (thread_key,))
    last = store.query("SELECT msg_id FROM messages WHERE thread_key=? ORDER BY date_utc DESC LIMIT 1", (thread_key,))
    for it in items:
        store.execute(
            """INSERT INTO tasks(thread_key, kind, title, summary, deadline, deadline_type, priority, delegate_to, delegate_reason,
               steps, draft_reply, evidence, confidence, status, source_msg_id, created_at, updated_at, lot, source)
               VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'local')""",
            (thread_key, it["kind"], it["title"][:160], it["summary"], it["deadline"], it["deadline_type"], it["priority"],
             it["delegate_to"], it["delegate_reason"], json.dumps(it["steps"], ensure_ascii=False), it["draft_reply"],
             it["evidence"], it["confidence"], "en_attente" if it["kind"] == "en_attente" else "a_faire",
             last[0]["msg_id"] if last else None, now, now, guess_lot(it["title"], it["summary"])),
        )
    queued = llm_candidate(thread_key)
    store.execute("UPDATE threads SET needs_analysis=0, analyzed_at=?, analysis_error=NULL, analyzed_by='local', llm_pending=? WHERE thread_key=?",
                  (now, int(queued), thread_key))
    subj = store.query("SELECT subject FROM threads WHERE thread_key=?", (thread_key,))
    what = ", ".join(KIND_LABEL.get(it["kind"], it["kind"]) for it in items) or "rien à faire"
    journal.log("règles", f"{_subject(subj[0]['subject'] if subj else '')} → {what}" + (" · ia en file" if queued else ""))
    return len(items)


KIND_LABEL = {"a_faire": "à faire", "a_transferer": "à transférer", "engagement": "engagement", "en_attente": "en attente",
              "info": "à trier"}


def process_pending():
    """Analyse locale de tous les fils en attente. Instantané, sans Claude. Renvoie (fils, tâches)."""
    train()
    rows = store.query("SELECT thread_key FROM threads WHERE needs_analysis>0 AND all_noise=0 ORDER BY last_date DESC")
    n = 0
    for r in rows:
        try:
            n += apply(r["thread_key"])
        except Exception as exc:
            print(f"[local] {r['thread_key']}: {exc}")
            store.execute("UPDATE threads SET needs_analysis=0, analysis_error=? WHERE thread_key=?", (str(exc)[:300], r["thread_key"]))
    if rows:
        store.set_meta("last_analysis", store.now_iso())
    return len(rows), n


# ---------------------------------------------------------------- zéro oubli
def zero_oubli(hours=24, days=10):
    """Filet de sécurité : une vraie personne t'a écrit directement, avec une question ou une demande, il y a plus de
    24 h, tu n'as pas répondu et aucune tâche ouverte ne la suit → tâche « Sans réponse » en priorité haute.
    Indépendant des règles et de l'IA : ce qui leur a échappé ressort quand même. Renvoie le nombre d'alertes créées."""
    now = datetime.now(timezone.utc)
    lo, hi = (now - timedelta(days=days)).isoformat(), (now - timedelta(hours=hours)).isoformat()
    rows = store.query(
        "SELECT th.thread_key, th.last_date FROM threads th WHERE th.all_noise=0 AND th.last_direction='in' "
        "AND th.last_date BETWEEN ? AND ? AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.thread_key=th.thread_key "
        "AND (t.status IN ('a_faire','en_cours','en_attente','delegue') OR (t.user_edited=1 AND t.updated_at >= th.last_date)))",
        (lo, hi))
    made = 0
    for r in rows:
        last = store.query("SELECT * FROM messages WHERE thread_key=? ORDER BY date_utc DESC LIMIT 1", (r["thread_key"],))[0]
        sender, body = (last["from_addr"] or "").lower(), BOILERPLATE.sub("", last["body"] or "")
        named = ME_FIRST.lower() in _norm(body)
        if last["is_noise"] or last["is_form"] or is_auto(sender) or not (last["me_role"] == "to" or named):
            continue
        if not (named or _known(sender)):  # un vrai correspondant (collègue ou quelqu'un à qui tu as déjà écrit)
            continue
        if _ticket(last["subject"]) in ("prestataire", "resolu"):
            continue
        asks = [s for s in _sentences(body) if REQUEST.search(s) or (s.endswith("?") and len(s) > 12)]
        if not asks:
            continue
        first = _first_name(sender, last["from_name"])
        age = max(1, (now - datetime.fromisoformat(last["date_utc"])).days)
        title = f"Sans réponse depuis {age} j : {_clip(_subject(last['subject']), 50)} ({first})"
        stamp = store.now_iso()
        store.execute(
            """INSERT INTO tasks(thread_key, kind, title, summary, deadline, deadline_type, priority, steps, draft_reply, evidence,
               confidence, status, source_msg_id, created_at, updated_at, lot, source, notes)
               VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (r["thread_key"], "a_faire", title, f"{first} attend une réponse : « {_clip(asks[0], 160)} »", _today().isoformat(),
             "estimee", "haute", json.dumps([f"Relire le message de {first}", f"Répondre à {first}, ou transférer"], ensure_ascii=False),
             template_reply("a_faire", last, None, first), _clip(asks[0], 160), 0.9, "a_faire", last["msg_id"], stamp, stamp,
             "Zéro oubli", "local", "[zéro oubli]"))
        journal.log("zéro oubli", f"{first} · {_subject(last['subject'])}")
        made += 1
    return made
