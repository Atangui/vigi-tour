"""Claude à la demande (CLI local, optionnel) : analyse d'un fil, réponse rédigée, barre de commande."""
import json
import re
import subprocess
import tempfile
import unicodedata
from datetime import datetime, timedelta

import store
from config import CLAUDE_EXE, CLAUDE_MODEL, ME_EMAIL, ME_NAME, ME_ROLE, load_people

KINDS = {"a_faire", "a_transferer", "engagement", "en_attente", "info"}

INSTRUCTIONS = """Tu es l'assistant de {me} ({email}), {role}.
Date du jour : {today}. Tu analyses des fils de mails professionnels (français ou anglais).

Pour CHAQUE fil, décide ce que {me} doit faire. Types possibles :
- "a_faire" : une action attendue de {me} (demande explicite ou implicite).
- "a_transferer" : la demande relève plutôt d'une autre personne de l'annuaire ci-dessous ; propose qui et pourquoi.
- "engagement" : {me} a promis quelque chose dans un mail qu'il a envoyé ("je t'envoie ça demain").
- "en_attente" : {me} attend une réponse ou une action de quelqu'un d'autre (relance à prévoir).
- "info" : utile à savoir, aucune action.
Si le fil ne demande rien (remerciement, accusé de réception, newsletter), renvoie "items": [].
Si {me} a déjà répondu ou traité la demande dans le fil, mets "resolved": true et n'invente pas d'action.
Notifications de formulaires web (marquées [FORMULAIRE WEB] : inscriptions, demandes de contact, candidatures, programmes,
abonnements…) : elles ne concernent PAS {me}, sauf si la demande porte sur le fonctionnement d'un site (bug, formulaire
cassé, accès, compte, erreur technique) ou si elle lui est adressée nommément. Sinon "items": [] — ni tâche, ni transfert, ni info.
Rapports automatiques récurrents (Wordfence, mises à jour WordPress, alertes de supervision) : le fil regroupe les rapports
successifs ; crée UNE seule tâche consolidée d'après le rapport le plus récent, et rien s'il n'appelle aucune action.
Un mail rangé dans un sous-dossier (champ « Dossier ») mérite la même attention qu'un mail de la boîte de réception.
Tickets de support (prestataire, plateforme de support…) : le fil réunit tous les messages du ticket ; le statut de l'objet du DERNIER message dit qui doit agir.
« Waiting for reply: Customer » = c'est à {me} ou à son équipe de répondre ("a_faire", sauf si un collègue a déjà répondu après) ;
« Waiting for reply: Provider » ou équivalent = on attend le prestataire ("en_attente") ; « Resolved » / « Closed » = "resolved": true.
Fils anciens : si le dernier message date de plus de 30 jours, ne garde une action que si elle reste vraiment ouverte
(demande restée sans réponse de {me}, engagement non tenu, attente d'une réponse qui mérite une relance) ; sinon "resolved": true.

Échéances : convertis les dates relatives ("vendredi", "fin de semaine", "ASAP") en date AAAA-MM-JJ à partir de la date du mail.
"deadline_type" = "explicite" si la date est écrite, "estimee" si tu la proposes, "aucune" sinon (deadline null).
Priorité : "haute", "moyenne" ou "basse" (urgence × importance de l'expéditeur et des enjeux).
"steps" : 2 à 5 étapes concrètes pour résoudre. "draft_reply" : brouillon de réponse court, dans le style direct et cordial de {me}
(tutoiement avec les collègues, vouvoiement avec l'externe), en français sauf si le fil est en anglais.
"evidence" : citation exacte (moins de 25 mots) du passage qui justifie la tâche. "confidence" entre 0 et 1.
"lot" : courte étiquette commune aux tâches de même nature, pour les traiter en série (ex. « Sécurité WordPress »,
« Newsletters », « Logos partenaires »), ou null si la tâche est isolée.

Annuaire « qui gère quoi » :
{people}

Réponds UNIQUEMENT avec un objet JSON valide, sans texte autour, au format :
{{"threads":[{{"thread_key":"...","resolved":false,"items":[{{"kind":"a_faire","title":"verbe à l'infinitif + objet (max 80 car.)",
"summary":"1 phrase","deadline":"2026-10-12","deadline_type":"explicite","priority":"haute","delegate_to":null,"delegate_reason":null,
"steps":["..."],"draft_reply":"...","evidence":"...","confidence":0.8,"lot":null}}]}}]}}
"""

LOT_RULES = [
    (re.compile(r"plugin|wordpress|elementor|gravity|vuln[ée]rab|faille|\bcve\b|csrf|xss", re.I), "Sécurité WordPress"),
    (re.compile(r"newsletter|e-?mailing|mailchimp|brevo", re.I), "Newsletters"),
]


def guess_lot(*texts):
    """Lot par mots-clés, quand l'IA n'en a pas proposé."""
    text = " ".join(t or "" for t in texts)
    for rx, label in LOT_RULES:
        if rx.search(text):
            return label
    return None


def _people_text():
    return "\n".join(f"- {p['nom']} <{p['email']}> — {p['role']} : {p['sujets']}" for p in load_people())


def _thread_text(key):
    msgs = store.query("SELECT * FROM messages WHERE thread_key=? ORDER BY date_utc", (key,))[-6:]
    lines = [f"### FIL thread_key={key}"]
    for m in msgs:
        local = datetime.fromisoformat(m["date_utc"]).astimezone().strftime("%a %d/%m/%Y %H:%M")
        who = "MOI" if m["direction"] == "out" or m["from_addr"] == ME_EMAIL else f"{m['from_name']} <{m['from_addr']}>"
        place = {"to": "destinataire direct", "cc": "en copie", "from": "expéditeur", "other": "via liste/alias"}[m["me_role"]]
        folder = m["folder"] or ""
        lines.append(f"--- {local} | De : {who} | À : {m['to_addrs']} | Cc : {m['cc_addrs']} | {ME_NAME} : {place}"
                     + (f" | Dossier : {folder}" if folder and not folder.startswith("id:") else "")
                     + (" | [FORMULAIRE WEB]" if m["is_form"] else ""))
        lines.append(f"Objet : {m['subject']}" + (" | pièces jointes" if m["has_attachments"] else ""))
        lines.append((m["body"] or "")[:800 if m["is_form"] else 1800])
    return "\n".join(lines)


ENGINE_SYSTEM = "Tu es le moteur d'analyse de Vigie Tour. Tu suis exactement la consigne et tu réponds en JSON quand elle le demande."


def call_claude(prompt, timeout=300):
    # Mode « moteur » : sans outils, sans serveurs MCP ni plugins, sans le prompt système de Claude Code.
    # Coût fixe d'un appel : ~150 jetons au lieu de ~19 000.
    proc = subprocess.run(
        [CLAUDE_EXE, "-p", "--output-format", "json", "--model", CLAUDE_MODEL, "--max-turns", "1",
         "--tools", "", "--strict-mcp-config", "--setting-sources", "local", "--no-session-persistence",
         "--system-prompt", ENGINE_SYSTEM],
        input=prompt.encode("utf-8"), capture_output=True, timeout=timeout, cwd=tempfile.gettempdir(),
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),  # pas de fenêtre noire qui clignote
    )
    out = proc.stdout.decode("utf-8", errors="replace")
    try:
        envelope = json.loads(out)
    except json.JSONDecodeError:
        raise RuntimeError((out or proc.stderr.decode("utf-8", errors="replace"))[:400])
    _count_usage(envelope)
    if envelope.get("is_error"):
        raise RuntimeError(str(envelope.get("result"))[:400])
    return envelope.get("result", "")


def _count_usage(envelope):
    """Cumul quotidien des appels et des jetons, affiché dans les réglages."""
    u = envelope.get("usage") or {}
    key = "usage:" + datetime.now().strftime("%Y-%m-%d")
    day = json.loads(store.get_meta(key) or '{"calls":0,"tokens_in":0,"tokens_out":0,"cost":0}')
    day["calls"] += 1
    day["tokens_in"] += sum(u.get(k) or 0 for k in ("input_tokens", "cache_creation_input_tokens", "cache_read_input_tokens"))
    day["tokens_out"] += u.get("output_tokens") or 0
    day["cost"] = round(day["cost"] + (envelope.get("total_cost_usd") or 0), 4)
    store.set_meta(key, json.dumps(day))


def usage(days=7):
    out = []
    for i in range(days - 1, -1, -1):
        d = (datetime.now() - timedelta(days=i)).strftime("%Y-%m-%d")
        out.append({"day": d, **json.loads(store.get_meta("usage:" + d) or '{"calls":0,"tokens_in":0,"tokens_out":0,"cost":0}')})
    return out


def engine_status(force=False):
    """Vérifie (et mémorise) que la CLI Claude est connectée."""
    cached = store.get_meta("engine_status")
    if cached and not force:
        return json.loads(cached)
    try:
        call_claude("Réponds uniquement : OK", timeout=90)
        status = {"ok": True, "message": "Claude connecté"}
    except FileNotFoundError:
        status = {"ok": False, "message": f"Claude introuvable : {CLAUDE_EXE}"}
    except Exception as exc:
        msg = str(exc)
        if "401" in msg or "authenticat" in msg.lower():
            msg = "Claude n'est pas connecté : lance « claude » puis /login une fois."
        status = {"ok": False, "message": msg[:200]}
    store.set_meta("engine_status", json.dumps(status, ensure_ascii=False))
    return status


def _extract_json(text):
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end < 0:
        raise ValueError("pas de JSON dans la réponse")
    return json.loads(text[start:end + 1])


def _clean_date(value):
    if value and re.match(r"^\d{4}-\d{2}-\d{2}$", str(value)):
        return value
    return None


def _apply(result, keys, source="claude"):
    now = store.now_iso()
    for th in result.get("threads", []):
        key = th.get("thread_key")
        if key not in keys:
            continue
        last = store.query("SELECT msg_id FROM messages WHERE thread_key=? ORDER BY date_utc DESC LIMIT 1", (key,))
        items, _, stale = respect_decisions(key, th.get("items") or [], explicit=source == "claude")
        if stale:  # rien de nouveau depuis ta dernière décision sur ce fil : une relecture ne change rien
            store.execute("UPDATE threads SET needs_analysis=0, analyzed_at=?, analysis_error=NULL WHERE thread_key=?", (now, key))
            continue
        # Les tâches non modifiées par l'utilisateur et non terminées sont remplacées par la nouvelle analyse.
        if th.get("resolved"):
            store.execute("UPDATE tasks SET status='fait', updated_at=?, notes=COALESCE(notes,'') || ' [traité dans le fil]' "
                          "WHERE thread_key=? AND status IN ('a_faire','en_cours','en_attente') AND user_edited=0", (now, key))
        store.execute("DELETE FROM tasks WHERE thread_key=? AND user_edited=0 AND status IN ('a_faire','en_cours','en_attente')", (key,))
        for it in items:
            kind = it.get("kind") if it.get("kind") in KINDS else "a_faire"
            status = {"en_attente": "en_attente", "info": "a_faire"}.get(kind, "a_faire")
            title = (it.get("title") or "")[:160]
            store.execute(
                """INSERT INTO tasks(thread_key, kind, title, summary, deadline, deadline_type, priority, delegate_to,
                   delegate_reason, steps, draft_reply, evidence, confidence, status, source_msg_id, created_at, updated_at, lot, source)
                   VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (key, kind, title, it.get("summary"), _clean_date(it.get("deadline")),
                 it.get("deadline_type") or "aucune", it.get("priority") or "moyenne", it.get("delegate_to"),
                 it.get("delegate_reason"), json.dumps(it.get("steps") or [], ensure_ascii=False), it.get("draft_reply"),
                 it.get("evidence"), float(it.get("confidence") or 0.5), status, last[0]["msg_id"] if last else None, now, now,
                 it.get("lot") or guess_lot(title, it.get("summary")), source),
            )
        store.execute("UPDATE threads SET needs_analysis=0, analyzed_at=?, analysis_error=NULL, analyzed_by=? WHERE thread_key=?", (now, source, key))


LIMIT_RX = re.compile(r"hit your limit|usage limit|rate.?limit|limit reached", re.I)


def pause_if_limited(err):
    """Limite d'usage Claude atteinte : on met l'analyse en pause jusqu'à l'heure de reprise annoncée."""
    if not LIMIT_RX.search(err or ""):
        return False
    until = datetime.now() + timedelta(minutes=30)
    m = re.search(r"resets\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?", err, re.I)
    if m:
        h, mi = int(m.group(1)) % 12 if m.group(3) else int(m.group(1)), int(m.group(2) or 0)
        h += 12 if (m.group(3) or "").lower() == "pm" else 0
        until = datetime.now().replace(hour=h, minute=mi, second=0, microsecond=0)
        if until <= datetime.now():
            until += timedelta(days=1)
    store.set_meta("paused_until", until.isoformat(timespec="minutes"))
    return True


def paused_until():
    v = store.get_meta("paused_until")
    return v if v and datetime.fromisoformat(v) > datetime.now() else None


def _limit_message(err):
    if pause_if_limited(err):
        return f"Limite d’usage Claude atteinte : réessaie après {paused_until()[11:16]}."
    if "401" in err or "authenticat" in err.lower():
        return "Claude n’est pas connecté : lance « claude » puis /login une fois."
    return f"Claude n’a pas pu répondre : {err[:160]}"


def analyze_thread(key):
    """À la demande : analyse complète d'un fil par Claude (remplace l'analyse locale). Un seul appel."""
    prompt = INSTRUCTIONS.format(me=ME_NAME, email=ME_EMAIL, role=ME_ROLE,
                                 today=datetime.now().strftime("%A %d/%m/%Y"), people=_people_text())
    try:
        _apply(_extract_json(call_claude(prompt + "\n\n" + _thread_text(key), timeout=180)), {key})
    except Exception as exc:
        return {"ok": False, "message": _limit_message(str(exc))}
    ids = [r["id"] for r in store.query("SELECT id FROM tasks WHERE thread_key=? AND status NOT IN ('fait','ignore') "
                                         "ORDER BY id DESC", (key,))]
    return {"ok": True, "ids": ids,
            "message": f"Claude a analysé le fil : {len(ids)} tâche{'s' if len(ids) > 1 else ''}" if ids else "Claude : rien à faire dans ce fil"}


DRAFT_PROMPT = """Tu es l'assistant de {me} ({role}). Nous sommes le {today}.
Tâche à régler : {title} — {summary}
Rédige la réponse que {me} peut envoyer dans ce fil, prête à coller dans Outlook : courte, directe et cordiale,
tutoiement avec les collègues, vouvoiement avec l'externe, en français sauf si le fil est en anglais, signée « {first} ».
Propose aussi 2 à 4 étapes concrètes pour régler la tâche.
Réponds UNIQUEMENT en JSON : {{"draft_reply":"...","steps":["..."]}}

{thread}"""


def draft(task_id):
    """À la demande : réponse rédigée par Claude pour une tâche (et plan d'action affiné)."""
    rows = store.query("SELECT * FROM tasks WHERE id=?", (int(task_id),))
    if not rows:
        return {"ok": False, "message": "Tâche introuvable"}
    t = rows[0]
    prompt = DRAFT_PROMPT.format(me=ME_NAME, role=ME_ROLE, today=datetime.now().strftime("%A %d/%m/%Y"), title=t["title"],
                                 summary=t["summary"] or "", first=ME_NAME.split()[0], thread=_thread_text(t["thread_key"]))
    try:
        out = _extract_json(call_claude(prompt, timeout=120))
    except Exception as exc:
        return {"ok": False, "message": _limit_message(str(exc))}
    steps = [str(x) for x in (out.get("steps") or [])][:6]
    store.execute("UPDATE tasks SET draft_reply=?, steps=CASE WHEN ?='[]' THEN steps ELSE ? END, updated_at=? WHERE id=?",
                  (out.get("draft_reply") or t["draft_reply"], json.dumps(steps, ensure_ascii=False),
                   json.dumps(steps, ensure_ascii=False), store.now_iso(), t["id"]))
    return {"ok": True, "message": "Réponse rédigée par Claude"}


COMMAND_PROMPT = """Tu es l'assistant de Vigie Tour, le gestionnaire de tâches de {me}. Nous sommes le {today}.
Tâches ouvertes (id | type | échéance | priorité | de | titre | lot) :
{tasks}

Demande de {me} : « {text} »

Traduis la demande en actions sur ces tâches. N'utilise que des id de la liste. N'agis que si la demande est claire.
Réponds UNIQUEMENT en JSON :
{{"reply":"une phrase courte en français qui dit ce que tu proposes",
"actions":[{{"type":"done|snooze|delegate|priority|deadline|filter","ids":[1,2],"until":"AAAA-MM-JJTHH:MM","deadline":"AAAA-MM-JJ",
"priority":"haute|moyenne|basse","to":"Prénom Nom","query":"texte à rechercher"}}]}}
- snooze = reporter jusqu'à "until" ; deadline = changer l'échéance ; delegate = marquer comme confié à "to" ;
- filter = afficher exactement les tâches "ids" qui répondent à une question du type « qu'est-ce qui… » ; "query" = libellé court de cette sélection (3 à 5 mots) ;
- si rien ne correspond, "actions": [] et explique-le dans "reply"."""


def command(text):
    """Demande en langage naturel → actions proposées (jamais appliquées sans confirmation de l'utilisateur)."""
    rows = store.query(
        "SELECT t.id, t.kind, t.deadline, t.priority, t.title, t.lot, th.last_from FROM tasks t "
        "LEFT JOIN threads th ON th.thread_key = t.thread_key "
        "WHERE t.status IN ('a_faire','en_cours','en_attente','delegue') ORDER BY (t.deadline IS NULL), t.deadline LIMIT 150")
    lines = "\n".join(f"{r['id']} | {r['kind']} | {r['deadline'] or '-'} | {r['priority']} | {r['last_from'] or '-'} | {r['title']} | {r['lot'] or '-'}" for r in rows)
    prompt = COMMAND_PROMPT.format(me=ME_NAME, today=datetime.now().strftime("%A %d/%m/%Y %H:%M"), tasks=lines, text=text)
    try:
        result = _extract_json(call_claude(prompt, timeout=120))
    except RuntimeError as exc:
        if pause_if_limited(str(exc)):
            return {"reply": f"Limite d'usage Claude atteinte : réessaie après {paused_until()[11:16]}.", "actions": []}
        raise
    known = {r["id"] for r in rows}
    actions = []
    for a in result.get("actions") or []:
        ids = [i for i in (a.get("ids") or []) if i in known]
        if a.get("type") == "filter" or ids:
            a["ids"] = ids
            a["titles"] = [r["title"] for r in rows if r["id"] in ids][:8]
            actions.append(a)
    return {"reply": result.get("reply") or "", "actions": actions}


# ---------------------------------------------------------------- mémoire de tes décisions
_STOPW = set("pour avec dans sur par les des une que qui est son ses aux the and for site sites mettre jour faire verifier".split())


def _words(text):
    text = unicodedata.normalize("NFKD", (text or "").lower())
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    return {w for w in re.findall(r"[a-z0-9]{4,}", text) if w not in _STOPW}


def _same_request(item, done):
    """Même demande ? Titres proches, ou même passage du mail cité."""
    a, b = _words(item.get("title")), _words(done["title"])
    if a and b and len(a & b) / len(a | b) >= 0.3:
        return True
    ea, eb = " ".join(sorted(_words(item.get("evidence")))), " ".join(sorted(_words(done["evidence"])))
    return bool(ea) and ea == eb


def respect_decisions(key, items, explicit=False):
    """Ce que tu as marqué Fait, Ignoré ou Délégué ne revient pas quand le fil est relu (par l'IA locale, Claude ou
    les règles) ; si aucun mail n'est arrivé depuis ta décision, la relecture ne change rien au fil ; pour un rapport
    automatique (Wordfence, alertes…), une seule tâche consolidée est gardée. Renvoie (gardés, écartés, fil inchangé)."""
    decided = store.query("SELECT title, evidence, updated_at FROM tasks WHERE thread_key=? AND user_edited=1 "
                          "AND status IN ('fait','ignore','delegue')", (key,))
    auto = key.startswith(("a:", "t:"))
    kept, dropped = [], 0
    last_dec = max((d["updated_at"] for d in decided), default="")
    newest_in = store.query("SELECT MAX(ingested_at) d FROM messages WHERE thread_key=? AND direction='in'", (key,))[0]["d"] or ""
    # Aucun mail reçu depuis ta dernière décision : la relecture automatique (pas un ✦ Claude demandé) ne change rien
    if decided and newest_in <= last_dec and not explicit:
        return [], len(items), True
    for it in items:
        if any(_same_request(it, d) for d in decided):
            dropped += 1
            continue
        kept.append(it)
    if auto and len([k for k in kept if k.get("kind") != "info"]) > 1:  # rapport récurrent : une seule tâche consolidée
        first = next(k for k in kept if k.get("kind") != "info")
        dropped += len(kept) - 1
        kept = [first]
    return kept, dropped, False
