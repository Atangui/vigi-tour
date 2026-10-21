"""Lecture des mails déposés par Power Automate (.eml et .json) vers la base locale."""
import email
import json
import re
from email import policy
from email.utils import getaddresses, parseaddr, parsedate_to_datetime
from datetime import datetime, timedelta, timezone
from html.parser import HTMLParser
from pathlib import Path

import journal
import store
from config import FOLDERS_DIR, INBOX_DIRS, INBOX_NAME, ME_DOMAIN, ME_EMAIL, SENT_NAME

ALERT_WORDS = re.compile(
    r"vuln[ée]rab|action requi|urgent|expir|s[ée]curit|security|rotate|[ée]ch[ée]ance|deadline|facture|invoice|"
    r"paiement|payment|downtime|is down|erreur|error|alert|crash|quota|renouvel|renew|certifica|ssl|dns|domaine|domain|"
    r"vous a attribu|assigned (you|to you)|vous a mentionn|mentioned you|vous a envoy[ée] une demande",
    re.I,
)
NOISE_SENDER = re.compile(r"(^|[._-])(no-?reply|do-?not-?reply|donotreply|notification|notifications|newsletter|news|mailer|marketing|info|events|team|hello|contact)([._-]|@)", re.I)
NOISE_SUBJECT = re.compile(r"synth[èe]se quotidienne des r[ée]actions|webinar|unsubscribe|se d[ée]sabonner", re.I)
SUBJECT_PREFIX = re.compile(r"^\s*((re|tr|fw|fwd|aw|wg|rif|réf)\s*(\[\d+\])?\s*:\s*)+", re.I)
QUOTE_START = re.compile(
    r"^\s*(De\s*:|From\s*:|_{8,}|-{2,}\s*(Original Message|Message d'origine)|Le .{5,80} a [ée]crit\s*:|On .{5,80} wrote:)",
    re.I,
)
SIGNATURE_LINE = re.compile(
    r"^\s*(Phone|Mobile|T[ée]l|Tel)\s*:|consider the environment|"
    r"^\s*Book a meeting|^\s*View my Linkedin|^\s*Vous n.obtenez pas souvent d.e-mail|Pourquoi c.est important|"
    r"safelinks\.protection\.outlook\.com|^\s*\[(linkedin|logo|image)",
    re.I,
)
URL_IN_BRACKETS = re.compile(r"<https?://[^>\s]+>")

# Expéditeurs automatiques dont les rapports récurrents sont regroupés en un seul fil (Wordfence, WordPress, alertes…)
AUTO_SENDER = re.compile(r"(^|[._-])(no-?reply|do-?not-?reply|donotreply|wordpress|website|alerts?|notifications?|"
                         r"mailer(-daemon)?|monitoring|quarantine)([._-]|@)", re.I)
MONTHS = (r"janvier|f[ée]vrier|mars|avril|mai|juin|juillet|ao[uû]t|septembre|octobre|novembre|d[ée]cembre|"
          r"january|february|march|april|may|june|july|august|september|october|november|december")
# Notifications de formulaires web (inscriptions, demandes de contact, candidatures…)
FORM_SUBJECT = re.compile(r"\bform(ulaire)?s?\b|submission|soumission|new (user )?registration|nouvelle (inscription|entr[ée]e|demande)|"
                          r"demande de contact|contact request|candidature|wpforms|gravity ?forms", re.I)
FORM_FIELD = re.compile(r"^\W*(first ?name|last ?name|full ?name|pr[ée]nom|nom|e-?mail( address)?|company|soci[ée]t[ée]|entreprise|"
                        r"organi[sz]ation|job ?title|fonction|poste|phone|t[ée]l[ée]phone|mobile|country|pays|city|ville|"
                        r"salutation|civilit[ée]|message|comments?|website|site web)\b", re.I | re.M)
# Dossiers ignorés par défaut (modifiable dans les réglages)
SYSTEM_FOLDER = re.compile(r"^(courrier ind[ée]sirable|junk( e-?mail)?|[ée]l[ée]ments supprim[ée]s|deleted items|brouillons|drafts|"
                           r"bo[iî]te d.envoi|outbox|historique des conversations|conversation history|"
                           r"probl[èe]mes de synchronisation|sync issues|flux rss|rss (feeds|subscriptions)|archives?)$", re.I)
JUNK_FOLDER = re.compile(r"^(courrier ind[ée]sirable|junk( e-?mail)?)$", re.I)
KEEP_HEADERS = ("list-unsubscribe", "list-id", "precedence", "auto-submitted")
# Tickets de support (prestataire, Zendesk…) : l'objet change avec le statut, le numéro reste
TICKET = re.compile(r"\b(action|incident|ticket|request|demande|case|issue|requ[eê]te)\s*#\s*(\d{4,})\b", re.I)


class _HTMLText(HTMLParser):
    BLOCK = {"br", "p", "div", "tr", "li", "h1", "h2", "h3", "h4", "table"}

    def __init__(self):
        super().__init__()
        self.parts, self._skip = [], 0

    def handle_starttag(self, tag, attrs):
        if tag in ("style", "script", "head"):
            self._skip += 1
        elif tag in self.BLOCK:
            self.parts.append("\n")

    def handle_endtag(self, tag):
        if tag in ("style", "script", "head") and self._skip:
            self._skip -= 1
        elif tag in self.BLOCK:
            self.parts.append("\n")

    def handle_data(self, data):
        if not self._skip:
            self.parts.append(data)


def html_to_text(html):
    p = _HTMLText()
    try:
        p.feed(html or "")
    except Exception:
        return re.sub(r"<[^>]+>", " ", html or "")
    return "".join(p.parts)


def clean_body(text):
    """Garde le message lui-même : coupe l'historique cité et les signatures."""
    lines, out = (text or "").replace("\r", "").replace("\xa0", " ").split("\n"), []
    for line in lines:
        if out and QUOTE_START.match(line):
            break
        if SIGNATURE_LINE.search(line):
            continue
        out.append(URL_IN_BRACKETS.sub("", line).rstrip())
    body = re.sub(r"\n{3,}", "\n\n", "\n".join(out)).strip()
    body = re.sub(r"[ \t‌͏﻿]{2,}", " ", body)
    return body[:4000]


def norm_subject(subject):
    s = SUBJECT_PREFIX.sub("", subject or "").strip().lower()
    return re.sub(r"\s+", " ", s) or "(sans objet)"


def addr_list(value):
    if not value:
        return []
    if isinstance(value, list):
        out = []
        for v in value:
            if isinstance(v, dict):
                v = (v.get("emailAddress") or v).get("address") or v.get("address", "")
            out.append(str(v))
        return [a.strip().lower() for a in out if a]
    return [a.lower() for _, a in getaddresses([str(value).replace(";", ",")]) if a]


def noise_reason(from_addr, subject, preview, headers=None):
    text = f"{subject} {preview}"
    if ALERT_WORDS.search(text) or TICKET.search(subject or ""):
        return None  # une alerte, une échéance ou un ticket de support (un humain écrit via la plateforme) n'est jamais du bruit
    headers = headers or {}
    if headers.get("list-unsubscribe") or headers.get("list-id"):
        return "newsletter"
    if (headers.get("precedence") or "").lower() in ("bulk", "list", "junk"):
        return "envoi de masse"
    if (headers.get("auto-submitted") or "no").lower() != "no":
        return "message automatique"
    if NOISE_SUBJECT.search(subject or ""):
        return "notification"
    if from_addr and NOISE_SENDER.search(from_addr.split("@")[0] + "@"):
        return "expéditeur automatique"
    return None


def is_auto(from_addr):
    return bool(from_addr and AUTO_SENDER.search(from_addr.split("@")[0] + "@"))


def is_form(from_addr, subject, body):
    if (from_addr or "").endswith("@" + ME_DOMAIN) and not is_auto(from_addr):
        return False  # un collègue qui écrit n'est pas une notification de formulaire
    fields = len(FORM_FIELD.findall((body or "")[:3000]))
    return fields >= 4 or bool(FORM_SUBJECT.search(subject or "") and (fields >= 2 or is_auto(from_addr)))


def auto_key(from_addr, subject):
    """« Wordfence activity for 7 September 2026 » et « … 14 September 2026 » → même fil."""
    s = re.sub(rf"\b({MONTHS})\b", "", norm_subject(subject), flags=re.I)
    s = re.sub(r"\d+([.,:/-]\d+)*", "#", s)
    return f"a:{from_addr}|{re.sub(r'\s+', ' ', s).strip()}"


def ticket_key(subject):
    """« [Support] Action #4821] (Waiting for reply: Provider) … » → « t:action #4821 » : un ticket = un fil, quel que soit son statut."""
    m = TICKET.search(subject or "")
    return f"t:{m.group(1).lower()} #{m.group(2)}" if m else None


def _thread_key(msg):
    tk = ticket_key(msg["subject"])
    if tk:
        return tk
    if msg.get("conv_id"):
        rows = store.query("SELECT thread_key FROM messages WHERE conv_id=? LIMIT 1", (msg["conv_id"],))
        if rows:
            return rows[0]["thread_key"]
    for ref in msg.get("refs", []):
        rows = store.query("SELECT thread_key FROM messages WHERE msg_id=?", (ref,))
        if rows:
            return rows[0]["thread_key"]
    if is_auto(msg["from_addr"]):
        return auto_key(msg["from_addr"], msg["subject"])
    return "s:" + norm_subject(msg["subject"])


# ---------- Dossiers Outlook ----------
_folders_cache = {"mtime": None, "map": {}}


def folder_map():
    """{id Graph: « Parent / Sous-dossier »} d'après le dernier fichier dossiers-*.json déposé par Power Automate."""
    files = sorted(FOLDERS_DIR.glob("dossiers-*.json")) if FOLDERS_DIR.exists() else []
    if not files:
        return {}
    mtime = files[-1].stat().st_mtime
    if _folders_cache["mtime"] != mtime:
        out = {}

        def walk(items, prefix):
            for f in items or []:
                name = prefix + (f.get("displayName") or "?")
                out[f.get("id")] = name
                walk(f.get("childFolders"), name + " / ")
        try:
            data = json.loads(files[-1].read_text(encoding="utf-8-sig"))
            walk(data.get("value", data) if isinstance(data, dict) else data, "")
            _folders_cache.update(mtime=mtime, map=out)
        except Exception as exc:  # fichier en cours de synchro : on garde la liste précédente
            print(f"[ingest] dossiers : {exc}")
    return _folders_cache["map"]


def excluded_folders():
    """Noms des dossiers ignorés : choix de l'utilisateur, sinon les dossiers système (indésirables, supprimés…)."""
    saved = store.get_meta("folders_excluded")
    if saved is not None:
        return set(json.loads(saved))
    names = set(folder_map().values()) | {r["folder"] for r in store.query("SELECT DISTINCT folder FROM messages WHERE folder IS NOT NULL")}
    return {n for n in names if SYSTEM_FOLDER.match(n.split(" / ")[0])}


def folder_noise(folder, excluded=None):
    if folder and JUNK_FOLDER.match(folder.split(" / ")[0]):
        return "courrier indésirable"
    if folder and folder in (excluded if excluded is not None else excluded_folders()):
        return "dossier ignoré"
    return None


def _save(msg):
    me = ME_EMAIL.lower()
    to, cc = msg["to"], msg["cc"]
    if msg["from_addr"] == me:
        direction, me_role = ("in", "to") if me in to else ("out", "from")
    else:
        direction = "in"
        me_role = "to" if me in to else "cc" if me in cc else "other"
    msg["thread_key"] = _thread_key(msg)
    folder = msg.get("folder") or (SENT_NAME if direction == "out" else INBOX_NAME)
    form = direction == "in" and is_form(msg["from_addr"], msg["subject"], msg["body"])
    reason = folder_noise(folder) or (None if direction == "out" else
                                      noise_reason(msg["from_addr"], msg["subject"], msg["body"][:300], msg.get("headers")))
    cur = store.execute(
        """INSERT OR IGNORE INTO messages(msg_id, thread_key, direction, from_addr, from_name, to_addrs, cc_addrs, me_role,
           subject, date_utc, body, preview, has_attachments, is_noise, noise_reason, source_file, ingested_at,
           folder, conv_id, web_link, is_form)
           VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (msg["msg_id"], msg["thread_key"], direction, msg["from_addr"], msg["from_name"], ", ".join(to), ", ".join(cc),
         me_role, msg["subject"], msg["date_utc"], msg["body"], msg["body"][:220].replace("\n", " "),
         int(msg["has_attachments"]), int(bool(reason)), reason, msg["source_file"], store.now_iso(),
         folder, msg.get("conv_id"), msg.get("web_link"), int(form)),
    )
    if not cur.rowcount and (msg.get("conv_id") or msg.get("web_link")):
        # déjà connu (capture .eml) : on complète avec les infos Graph
        store.execute("UPDATE messages SET conv_id=COALESCE(conv_id, ?), web_link=COALESCE(web_link, ?) WHERE msg_id=?",
                      (msg.get("conv_id"), msg.get("web_link"), msg["msg_id"]))
    if cur.rowcount:
        store.execute("INSERT INTO msg_fts(msg_id, subject, body, sender) VALUES(?,?,?,?)",
                      (msg["msg_id"], msg["subject"], msg["body"], f"{msg['from_name']} {msg['from_addr']}"))
        _refresh_thread(msg["thread_key"])
        if reason or form:
            journal.log("écarter", f"{msg['subject']} · {'formulaire' if form and not reason else reason}")
        else:
            journal.log("lire", f"{msg['from_name'] or msg['from_addr']} · {msg['subject']}")
    return bool(cur.rowcount)


def _refresh_thread(key):
    rows = store.query("SELECT * FROM messages WHERE thread_key=? ORDER BY date_utc", (key,))
    if not rows:
        store.execute("DELETE FROM threads WHERE thread_key=?", (key,))
        return
    last = rows[-1]
    all_noise = int(all(r["is_noise"] for r in rows))
    folder = next((r["folder"] for r in reversed(rows) if r["direction"] == "in" and r["folder"]), last["folder"])
    store.execute(
        """INSERT INTO threads(thread_key, subject, last_date, last_from, last_direction, msg_count, all_noise, needs_analysis, folder)
           VALUES(?,?,?,?,?,?,?,?,?)
           ON CONFLICT(thread_key) DO UPDATE SET subject=excluded.subject, last_date=excluded.last_date,
             last_from=excluded.last_from, last_direction=excluded.last_direction, msg_count=excluded.msg_count,
             all_noise=excluded.all_noise, needs_analysis=excluded.needs_analysis, folder=excluded.folder""",
        (key, last["subject"], last["date_utc"], last["from_name"] or last["from_addr"], last["direction"],
         len(rows), all_noise, 0 if all_noise else 1, folder),
    )


def parse_eml(path):
    raw = path.read_bytes()
    m = email.message_from_bytes(raw, policy=policy.default)
    plain, html = None, None
    for part in m.walk():
        if part.get_content_maintype() == "multipart" or part.get_filename():
            continue
        ctype = part.get_content_type()
        try:
            content = part.get_content()
        except Exception:
            continue
        if ctype == "text/plain" and plain is None:
            plain = content
        elif ctype == "text/html" and html is None:
            html = content
    text = plain if plain and plain.strip() else html_to_text(html)
    name, addr = parseaddr(str(m.get("From", "")))
    try:
        date = parsedate_to_datetime(m.get("Date")).astimezone(timezone.utc).isoformat(timespec="seconds")
    except Exception:
        date = store.now_iso()
    refs = re.findall(r"<[^>]+>", f"{m.get('In-Reply-To', '')} {m.get('References', '')}")
    return {
        "msg_id": (m.get("Message-ID") or f"<{path.name}>").strip(),
        "refs": list(reversed(refs)),
        "from_addr": addr.lower(), "from_name": name or addr,
        "to": addr_list(m.get("To")), "cc": addr_list(m.get("Cc")),
        "subject": str(m.get("Subject", "")).strip(), "date_utc": date,
        "body": clean_body(text),
        "has_attachments": any(p.get_filename() for p in m.walk()),
        "headers": {k.lower(): str(v) for k, v in m.items() if k.lower() in KEEP_HEADERS},
        "folder": INBOX_NAME,
        "source_file": str(path),
    }


def parse_json_items(path):
    """Fichier .json produit par Power Automate (requête Microsoft Graph) : {"value": [mails]}, un tableau ou un seul mail."""
    data = json.loads(path.read_text(encoding="utf-8-sig"))
    items = data.get("value", [data] if "subject" in data else []) if isinstance(data, dict) else data
    folders = folder_map()
    default_folder = SENT_NAME if path.name.startswith("sent-") else INBOX_NAME
    for it in items or []:
        if it.get("isDraft"):
            continue
        sender, sender_name = it.get("from") or "", ""
        if isinstance(sender, dict):  # format Microsoft Graph : {"emailAddress": {"name": ..., "address": ...}}
            sender_name = (sender.get("emailAddress") or {}).get("name", "")
            sender = (sender.get("emailAddress") or {}).get("address", "")
        body = it.get("body") or it.get("bodyPreview") or ""
        if isinstance(body, dict):
            body = body.get("content", "")
        yield {
            "msg_id": it.get("internetMessageId") or it.get("id"),
            "refs": [],
            "from_addr": str(sender).lower(), "from_name": sender_name or str(sender),
            "to": addr_list(it.get("toRecipients") or it.get("to")),
            "cc": addr_list(it.get("ccRecipients") or it.get("cc")),
            "subject": it.get("subject") or "",
            "date_utc": (it.get("receivedDateTime") or it.get("sentDateTime") or store.now_iso()).replace("Z", "+00:00"),
            "body": clean_body(html_to_text(body) if "<" in body else body),
            "has_attachments": bool(it.get("hasAttachments")),
            "headers": {h.get("name", "").lower(): h.get("value", "") for h in it.get("internetMessageHeaders") or []
                        if h.get("name", "").lower() in KEEP_HEADERS},
            # dossier pas encore dans la liste : on garde son id, renommé dès que la liste est à jour (resolve_folders)
            "folder": folders.get(it.get("parentFolderId")) or ("id:" + it["parentFolderId"] if it.get("parentFolderId") else default_folder),
            "conv_id": it.get("conversationId"),
            "web_link": it.get("webLink"),
            "source_file": str(path),
        }


def resolve_folders():
    """Donne leur nom aux dossiers encore inconnus (id Graph) dès que la liste des dossiers les contient."""
    fm, changed = folder_map(), False
    for r in store.query("SELECT DISTINCT folder FROM messages WHERE folder LIKE 'id:%'"):
        if fm.get(r["folder"][3:]):
            store.execute("UPDATE messages SET folder=? WHERE folder=?", (fm[r["folder"][3:]], r["folder"]))
            changed = True
    if changed:
        apply_folder_choices()


def apply_folder_choices():
    """Applique les dossiers ignorés / surveillés aux mails déjà lus, et relance l'analyse des fils concernés."""
    touched, excluded = set(), excluded_folders()
    for r in store.query("SELECT msg_id, thread_key, direction, folder, from_addr, subject, preview, noise_reason FROM messages"):
        fn = folder_noise(r["folder"], excluded)
        if fn and r["noise_reason"] != fn:
            store.execute("UPDATE messages SET is_noise=1, noise_reason=? WHERE msg_id=?", (fn, r["msg_id"]))
            touched.add(r["thread_key"])
        elif not fn and r["noise_reason"] in ("dossier ignoré", "courrier indésirable"):
            reason = None if r["direction"] == "out" else noise_reason(r["from_addr"], r["subject"], r["preview"] or "")
            store.execute("UPDATE messages SET is_noise=?, noise_reason=? WHERE msg_id=?", (int(bool(reason)), reason, r["msg_id"]))
            touched.add(r["thread_key"])
    for key in touched:
        _refresh_thread(key)
    return len(touched)


def folders_summary():
    """Dossiers connus (liste Outlook + dossiers vus dans les mails), avec le nombre de mails lus et l'état surveillé/ignoré."""
    counts = {r["folder"]: r["n"] for r in store.query("SELECT folder, COUNT(*) n FROM messages WHERE folder IS NOT NULL GROUP BY folder")}
    names = (set(folder_map().values()) | set(counts)) - {n for n in counts if n.startswith("id:")}
    excluded = excluded_folders()
    return sorted(({"name": n, "count": counts.get(n, 0), "excluded": n in excluded,
                    "system": bool(SYSTEM_FOLDER.match(n.split(" / ")[0]))} for n in names),
                  key=lambda f: (f["name"] not in (INBOX_NAME, SENT_NAME), f["system"], f["name"].lower()))


def migrate():
    """Mises à jour ponctuelles des mails déjà importés (une seule fois chacune)."""
    if not store.get_meta("mig_folders"):
        store.execute("UPDATE messages SET folder=? WHERE folder IS NULL AND (direction='out' OR source_file LIKE '%sent-%')", (SENT_NAME,))
        store.execute("UPDATE messages SET folder=? WHERE folder IS NULL", (INBOX_NAME,))
        store.execute("UPDATE threads SET folder=? WHERE folder IS NULL", (INBOX_NAME,))
        # conversationId des mails importés par l'historique : relie mieux les futures réponses
        for path in sorted((INBOX_DIRS[1]).glob("*.json")) if INBOX_DIRS[1].exists() else []:
            try:
                for it in (json.loads(path.read_text(encoding="utf-8-sig")).get("value") or []):
                    if it.get("conversationId") and it.get("internetMessageId"):
                        store.execute("UPDATE messages SET conv_id=? WHERE msg_id=? AND conv_id IS NULL",
                                      (it["conversationId"], it["internetMessageId"]))
            except Exception as exc:
                print(f"[migrate] {path.name}: {exc}")
        store.set_meta("mig_folders", store.now_iso())
    if not store.get_meta("mig_tickets"):
        # Un ticket éclaté en plusieurs fils selon son statut (« Waiting for reply: Customer / Provider », « Resolved ») → un seul fil
        moved = {}
        for r in store.query("SELECT msg_id, thread_key, subject FROM messages"):
            new = ticket_key(r["subject"])
            if new and new != r["thread_key"]:
                store.execute("UPDATE messages SET thread_key=? WHERE msg_id=?", (new, r["msg_id"]))
                moved.setdefault(r["thread_key"], set()).add(new)
        for old in moved:
            for t in store.query("SELECT id, source_msg_id FROM tasks WHERE thread_key=?", (old,)):
                src = store.query("SELECT thread_key FROM messages WHERE msg_id=?", (t["source_msg_id"],))
                if src and src[0]["thread_key"] != old:
                    store.execute("UPDATE tasks SET thread_key=? WHERE id=?", (src[0]["thread_key"], t["id"]))
                elif not src and not store.query("SELECT 1 FROM messages WHERE thread_key=? LIMIT 1", (old,)):
                    store.execute("UPDATE tasks SET thread_key=? WHERE id=?", (sorted(moved[old])[0], t["id"]))
            _refresh_thread(old)
        recent = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
        for key in {n for s in moved.values() for n in s}:
            _refresh_thread(key)
            # relu (règles puis IA locale) seulement s'il est récent ; sinon on garde les tâches telles quelles
            store.execute("UPDATE threads SET needs_analysis=CASE WHEN last_date >= ? THEN 1 ELSE 0 END WHERE thread_key=?", (recent, key))
        store.set_meta("mig_tickets", store.now_iso())
    if not store.get_meta("mig_tickets_noise2"):
        # Les mises à jour de tickets (no-reply@support.example.com…) avaient été classées « expéditeur automatique »
        keys = set()
        for r in store.query("SELECT msg_id, thread_key, subject FROM messages WHERE is_noise=1 AND noise_reason IN "
                             "('expéditeur automatique', 'notification', 'message automatique', 'newsletter', 'envoi de masse')"):
            if TICKET.search(r["subject"] or ""):
                store.execute("UPDATE messages SET is_noise=0, noise_reason=NULL WHERE msg_id=?", (r["msg_id"],))
                keys.add(r["thread_key"])
        recent = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
        for key in keys:
            _refresh_thread(key)
            store.execute("UPDATE threads SET needs_analysis=CASE WHEN last_date >= ? THEN 1 ELSE 0 END WHERE thread_key=?", (recent, key))
        store.set_meta("mig_tickets_noise2", store.now_iso())
    if not store.get_meta("mig_auto_threads"):
        # Rapports automatiques récurrents (Wordfence, mises à jour WordPress…) : un seul fil par type de rapport
        moved = {}
        for r in store.query("SELECT msg_id, thread_key, from_addr, subject FROM messages WHERE direction='in' AND thread_key LIKE 's:%'"):
            if is_auto(r["from_addr"]):
                new = auto_key(r["from_addr"], r["subject"])
                store.execute("UPDATE messages SET thread_key=? WHERE msg_id=?", (new, r["msg_id"]))
                moved.setdefault(r["thread_key"], set()).add(new)
        for old, news in moved.items():
            if not store.query("SELECT 1 FROM messages WHERE thread_key=? LIMIT 1", (old,)):
                store.execute("UPDATE tasks SET thread_key=? WHERE thread_key=?", (sorted(news)[0], old))
            _refresh_thread(old)
        for key in {n for s in moved.values() for n in s}:
            _refresh_thread(key)
        store.set_meta("mig_auto_threads", store.now_iso())
    if not store.get_meta("mig_noise_v2"):
        # Tâches assignées / mentions venant d'adresses « no-reply » : ce n'est pas du bruit
        for r in store.query("SELECT msg_id, thread_key, from_addr, subject, preview FROM messages "
                             "WHERE is_noise=1 AND noise_reason IN ('expéditeur automatique', 'notification')"):
            if not noise_reason(r["from_addr"], r["subject"], r["preview"] or ""):
                store.execute("UPDATE messages SET is_noise=0, noise_reason=NULL WHERE msg_id=?", (r["msg_id"],))
                _refresh_thread(r["thread_key"])
        store.set_meta("mig_noise_v2", store.now_iso())
    if not store.get_meta("mig_forms"):
        # Notifications de formulaires : marquées, et fils réanalysés avec la règle « ne me concerne pas »
        keys = set()
        for r in store.query("SELECT msg_id, thread_key, from_addr, subject, body FROM messages WHERE direction='in'"):
            if is_form(r["from_addr"], r["subject"], r["body"]):
                store.execute("UPDATE messages SET is_form=1 WHERE msg_id=?", (r["msg_id"],))
                keys.add(r["thread_key"])
        for key in keys:
            store.execute("UPDATE threads SET needs_analysis=1 WHERE thread_key=? AND all_noise=0", (key,))
        store.set_meta("mig_forms", store.now_iso())


def scan():
    """Importe les nouveaux fichiers. Renvoie le nombre de nouveaux messages."""
    resolve_folders()
    new = 0
    for folder in INBOX_DIRS:
        if not folder.exists():
            continue
        for path in sorted(folder.iterdir()):
            if path.suffix.lower() not in (".eml", ".json"):
                continue
            st = path.stat()
            seen = store.query("SELECT size, mtime FROM files_seen WHERE path=?", (str(path),))
            if seen and seen[0]["size"] == st.st_size and seen[0]["mtime"] == st.st_mtime:
                continue
            try:
                msgs = [parse_eml(path)] if path.suffix.lower() == ".eml" else list(parse_json_items(path))
                for msg in msgs:
                    if msg["msg_id"]:
                        new += _save(msg)
            except Exception as exc:  # un fichier en cours de synchro OneDrive sera relu au passage suivant
                print(f"[ingest] {path.name}: {exc}")
                continue
            store.execute("INSERT OR REPLACE INTO files_seen(path, size, mtime) VALUES(?,?,?)",
                          (str(path), st.st_size, st.st_mtime))
    store.set_meta("last_scan", store.now_iso())
    return new
