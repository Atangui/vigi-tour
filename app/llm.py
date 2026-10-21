"""IA locale (Ollama, sur ce PC) : lit chaque fil comme le ferait Claude. Zéro jeton, rien ne sort du PC.

Cascade : les règles de local.py donnent un premier tri instantané, puis l'IA locale relit en arrière-plan
les fils qui peuvent demander une action et remplace ce premier tri par une vraie lecture.
"""
import json
import re
import os
import shutil
import subprocess
import time
import urllib.request
from datetime import datetime
from pathlib import Path

import analyze
import journal
import store
from config import ME_EMAIL, ME_NAME, ME_ROLE, ROOT

# Ollama : variable VIGIE_OLLAMA, sinon copie portable dans runtime/ollama, sinon l'installation du système (PATH)
OLLAMA_DIR = ROOT / "runtime" / "ollama"
OLLAMA_EXE = Path(os.environ.get("VIGIE_OLLAMA") or OLLAMA_DIR / ("ollama.exe" if os.name == "nt" else "ollama"))
if not OLLAMA_EXE.exists() and shutil.which("ollama"):
    OLLAMA_EXE = Path(shutil.which("ollama"))
URL = "http://127.0.0.1:11434"
MODEL = os.environ.get("VIGIE_LOCAL_MODEL", "qwen3:8b")
_http = urllib.request.build_opener(urllib.request.ProxyHandler({}))  # appel local : jamais via un proxy

ITEM = {
    "type": "object",
    "properties": {
        "kind": {"type": "string", "enum": sorted(analyze.KINDS)},
        "title": {"type": "string"},
        "summary": {"type": "string"},
        "deadline": {"type": ["string", "null"]},
        "deadline_type": {"type": "string", "enum": ["explicite", "estimee", "aucune"]},
        "priority": {"type": "string", "enum": ["haute", "moyenne", "basse"]},
        "delegate_to": {"type": ["string", "null"]},
        "delegate_reason": {"type": ["string", "null"]},
        "steps": {"type": "array", "items": {"type": "string"}},
        "evidence": {"type": "string"},
        "confidence": {"type": "number"},
        "lot": {"type": ["string", "null"]},
    },
    "required": ["kind", "title", "summary", "deadline", "deadline_type", "priority", "steps", "evidence", "confidence"],
}
SCHEMA = {
    "type": "object",
    "properties": {"resolved": {"type": "boolean"}, "items": {"type": "array", "items": ITEM}},
    "required": ["resolved", "items"],
}
# La consigne est celle de Claude ; seul le format de sortie change (un fil à la fois, sans brouillon : plus rapide).
FORMAT = """
Pour ce fil, réponds UNIQUEMENT avec un objet JSON : {"resolved": false, "items": [ ... ]}
Chaque item : kind, title (verbe à l'infinitif + objet, 80 car. max), summary, deadline (AAAA-MM-JJ ou null), deadline_type,
priority, delegate_to, delegate_reason, steps (2 à 4 étapes), evidence (citation exacte), confidence, lot.
Pas de brouillon de réponse.
Crée UNE tâche pour CHAQUE demande encore sans réponse de ma part dans le fil (pas seulement celle du dernier message) :
par exemple une demande de rendez-vous dans un message, puis une question d'un collègue dans le suivant = 2 tâches.
Le titre dit avec qui et sur quoi, par exemple « Répondre à Julie : choix de l'hébergeur du site X » ou « Proposer 2 créneaux
à Acme pour la démo » (exemples fictifs, à ne pas recopier) — jamais un titre vague comme « Valider la fonctionnalité ».
ATTENTION au destinataire : une demande écrite À QUELQU'UN D'AUTRE (« Bonjour Romain, peux-tu… », un collègue qui demande
quelque chose à un prestataire) n'est PAS une tâche pour moi. Ne crée une tâche que si c'est moi qui dois agir."""


def _request(path, body=None, timeout=10):
    req = urllib.request.Request(URL + path, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Content-Type": "application/json"})
    with _http.open(req, timeout=timeout) as r:
        return json.loads(r.read())


def running():
    try:
        _request("/api/version", timeout=2)
        return True
    except Exception:
        return False


def ensure_running():
    """Démarre le moteur Ollama en arrière-plan s'il ne tourne pas (sans fenêtre)."""
    if running():
        return True
    if not OLLAMA_EXE.exists():
        return False
    env = dict(os.environ, OLLAMA_HOST="127.0.0.1:11434", OLLAMA_KEEP_ALIVE="30m")
    subprocess.Popen([str(OLLAMA_EXE), "serve"], env=env, cwd=str(OLLAMA_EXE.parent), stdout=subprocess.DEVNULL,
                     stderr=subprocess.DEVNULL,
                     # console cachée (surtout pas « détaché » : chaque sous-processus d'Ollama ouvrirait alors sa propre
                     # fenêtre) et priorité basse : ton travail passe toujours avant la lecture des mails
                     creationflags=(getattr(subprocess, "CREATE_NO_WINDOW", 0) | 0x00004000) if os.name == "nt" else 0)
    for _ in range(30):
        time.sleep(1)
        if running():
            return True
    return False


def model_ready():
    try:
        names = {m["name"] for m in _request("/api/tags")["models"]}
    except Exception:
        return False
    return MODEL in names or f"{MODEL}:latest" in names


def status():
    if not OLLAMA_EXE.exists():
        return {"ok": False, "message": f"IA locale introuvable (Ollama non installé)"}
    if not running():
        return {"ok": False, "message": "IA locale arrêtée"}
    if not model_ready():
        return {"ok": False, "message": f"Modèle {MODEL} en cours d'installation"}
    return {"ok": True, "message": f"IA locale prête ({MODEL})"}


def read_thread(key):
    """Lecture d'un fil par l'IA locale → {"resolved", "items"} (même format que Claude)."""
    prompt = analyze.INSTRUCTIONS.format(me=ME_NAME, email=ME_EMAIL, role=ME_ROLE,
                                         today=datetime.now().strftime("%A %d/%m/%Y"), people=analyze._people_text())
    prompt = prompt[:prompt.index("Réponds UNIQUEMENT")] + FORMAT + "\n\n" + analyze._thread_text(key)
    last = store.query("SELECT direction FROM messages WHERE thread_key=? ORDER BY date_utc DESC LIMIT 1", (key,))
    if last and last[0]["direction"] == "out":  # un petit modèle le remarque mal tout seul
        prompt += ("\n\nNB : le dernier message du fil a été écrit par MOI. Les demandes reçues avant sont donc en principe "
                   "traitées ; ne garde que ce que j'ai promis (engagement) et ce que j'attends en retour (en_attente).")
    out = _request("/api/chat", {
        "model": MODEL, "stream": False, "think": False, "format": SCHEMA, "keep_alive": "30m",
        "options": {"temperature": 0.1, "num_ctx": 8192},
        "messages": [{"role": "system", "content": analyze.ENGINE_SYSTEM}, {"role": "user", "content": prompt}],
    }, timeout=600)
    result = json.loads(out["message"]["content"])
    for it in result.get("items") or []:
        it.setdefault("draft_reply", None)
    return result


def candidates(limit=1):
    return store.query("SELECT thread_key FROM threads WHERE llm_pending=1 AND all_noise=0 ORDER BY last_date DESC LIMIT ?", (limit,))


def process_one():
    """Relit le fil en attente le plus récent. Renvoie la clé traitée, ou None s'il n'y a rien à faire."""
    rows = candidates()
    if not rows:
        return None
    key = rows[0]["thread_key"]
    import local
    subj = store.query("SELECT subject FROM threads WHERE thread_key=?", (key,))
    subj = local._subject(subj[0]["subject"] if subj else "")
    journal.log("ia lit", subj)
    try:
        t0 = time.time()
        result = read_thread(key)
        _drop_answered(key, result)
        _calibrate(key, result)
        _to_triage(key, result)
        kinds = [local.KIND_LABEL.get(it.get("kind"), it.get("kind")) for it in result.get("items") or []]
        journal.log("ia", ("résolu" if result.get("resolved") and not kinds else " + ".join(kinds) or "rien à faire")
                    + f" · {time.time() - t0:.0f} s")
        # Les tâches des règles sont remplacées ; les réponses types restent proposées (bouton ✦ pour une vraie réponse)
        analyze._apply({"threads": [{"thread_key": key, **result}]}, {key}, source="ia")
        _keep_templates(key)
        store.execute("UPDATE threads SET llm_pending=0 WHERE thread_key=?", (key,))
    except Exception as exc:
        print(f"[llm] {key}: {exc}")
        journal.log("erreur", f"ia : {str(exc)[:60]}")
        store.execute("UPDATE threads SET llm_pending=2, analysis_error=? WHERE thread_key=?", (str(exc)[:300], key))
    return key


def _drop_answered(key, result):
    """Règle ferme : une demande est traitée si tu as écrit à la personne qui l'a faite, après sa demande
    (réponse, ou mail à elle). Un transfert à quelqu'un d'autre ne compte pas. Restent tes engagements,
    ce que tu attends des autres et les demandes sans réponse."""
    import local
    msgs = store.query("SELECT direction, date_utc, body, from_addr, to_addrs, cc_addrs FROM messages "
                       "WHERE thread_key=? ORDER BY date_utc", (key,))
    outs = [m for m in msgs if m["direction"] == "out"]
    if not outs:
        return
    flat = [(m, " ".join(local._norm(m["body"] or "").split())) for m in msgs]

    def source(evidence):  # le message le plus récent qui contient la citation
        words = re.sub(r"[«»\"“”.…!?,;:()]", " ", local._norm(evidence or "")).split()
        probe = " ".join(words[:8])
        hits = [m for m, body in flat if len(probe) >= 15 and probe in body and m["direction"] == "in"]
        return hits[-1] if hits else None

    def answered(m):
        who = (m["from_addr"] or "").lower()
        return any(o["date_utc"] > m["date_utc"] and who and who in f"{o['to_addrs'] or ''},{o['cc_addrs'] or ''}".lower()
                   for o in outs)

    last_in = next((m for m in reversed(msgs) if m["direction"] == "in"), None)
    kept, dropped = [], 0
    for it in result.get("items") or []:
        if it.get("kind") in ("a_faire", "a_transferer", "info"):
            src = source(it.get("evidence")) or last_in
            if src is None or answered(src):
                dropped += 1
                continue
        kept.append(it)
    if dropped:
        journal.log("ia", f"{dropped} demande{'s' if dropped > 1 else ''} déjà traitée{'s' if dropped > 1 else ''} par ta réponse")
    result["items"] = kept
    if dropped and not kept:
        result["resolved"] = True


def _calibrate(key, result):
    """Règles fermes après l'IA : une question directe d'un collègue ou d'un correspondant appelle une réponse sous 2 jours
    ouvrés (1 jour pour un VP / Head), et un VP / Head qui t'écrit directement = priorité haute."""
    import local
    msgs = store.query("SELECT * FROM messages WHERE thread_key=? ORDER BY date_utc", (key,))
    if not msgs or msgs[-1]["direction"] == "out":
        return
    last = msgs[-1]
    sender, body = (last["from_addr"] or "").lower(), last["body"] or ""
    if last["me_role"] != "to" or local.is_auto(sender):
        return
    question = "?" in body or bool(local.REQUEST.search(body))
    vip = sender in local._vips()
    soon = local._business_days(local._ref_date(last), 1 if vip else 2).isoformat()
    for it in result.get("items") or []:
        if it.get("kind") not in ("a_faire", "a_transferer"):
            continue
        if question and (local._is_colleague(sender) or local._known(sender)) and (not it.get("deadline") or it["deadline"] > soon):
            it["deadline"], it["deadline_type"] = soon, "estimee"
        if vip:
            it["priority"] = "haute"


def _to_triage(key, result):
    """Avis incertain → « À trier » plutôt que la liste principale : rien n'est perdu, rien n'encombre.
    Incertain = l'IA elle-même doute, ou une notification automatique que tes choix passés jugent sans intérêt."""
    import local
    last = store.query("SELECT from_addr FROM messages WHERE thread_key=? ORDER BY date_utc DESC LIMIT 1", (key,))
    auto = bool(last) and local.is_auto(last[0]["from_addr"] or "")
    p = local._p("attention", local.features(key)).get(1) if local._models["n"] >= 40 else None
    for it in result.get("items") or []:
        if it.get("kind") != "info" and (float(it.get("confidence") or 0) < 0.45 or (auto and p is not None and p < 0.05)):
            it["kind"], it["priority"] = "info", "basse"


def _keep_templates(key):
    """Réponse type (accusé de réception / relance) pour les tâches de l'IA locale, en attendant un éventuel ✦ Claude."""
    import local
    for t in store.query("SELECT * FROM tasks WHERE thread_key=? AND source='ia' AND draft_reply IS NULL", (key,)):
        msg = store.query("SELECT * FROM messages WHERE thread_key=? ORDER BY date_utc DESC LIMIT 1", (key,))[0]
        draft = local.template_reply(t["kind"], msg, t["deadline"])
        if draft:
            store.execute("UPDATE tasks SET draft_reply=? WHERE id=?", (draft, t["id"]))


def close_answered(dry_run=False):
    """Ferme les tâches ouvertes dont la demande précède ta dernière réponse dans le fil (même règle que _drop_answered)."""
    out = []
    for t in store.query("SELECT id, thread_key, kind, evidence, title FROM tasks WHERE user_edited=0 "
                         "AND status IN ('a_faire','en_cours') AND kind IN ('a_faire','a_transferer','info')"):
        probe = {"items": [{"kind": t["kind"], "evidence": t["evidence"]}]}
        _drop_answered(t["thread_key"], probe)
        if not probe["items"]:
            out.append(t)
            if not dry_run:
                store.execute("UPDATE tasks SET status='fait', updated_at=?, notes=TRIM(COALESCE(notes,'') || ' [répondu dans le fil]') "
                              "WHERE id=?", (store.now_iso(), t["id"]))
    return out
