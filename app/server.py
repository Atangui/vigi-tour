"""Serveur local Vigie Tour : API JSON + interface web, synchronisation en arrière-plan."""
import json
import os
import threading
import time
import webbrowser
from datetime import date, datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import analyze
import ingest
import journal
import llm
import local
import store
from config import HOST, ME_NAME, PORT, STATIC_DIR, SYNC_EVERY_SECONDS

OPEN = ("a_faire", "en_cours", "en_attente", "delegue")
EDITABLE = {"status", "deadline", "priority", "kind", "notes", "snooze_until", "delegate_to", "title", "reviewed", "lot"}
PRIO = "CASE t.priority WHEN 'haute' THEN 0 WHEN 'moyenne' THEN 1 ELSE 2 END"
LIKELY_DONE_DAYS = 21  # au-delà, une demande ancienne jamais relancée est « probablement traitée »

state = {"busy": False, "step": "", "last_new": 0, "last_analyzed": 0, "llm_done": 0}
wake = threading.Event()
llm_wake = threading.Event()
sync_lock = threading.Lock()


def installed_at():
    """Date de mise en service : premier mail arrivé par la capture continue."""
    value = store.get_meta("installed_at")
    if not value:
        rows = store.query("SELECT MIN(date_utc) d FROM messages WHERE source_file LIKE '%arrivee%'")
        value = rows[0]["d"] if rows and rows[0]["d"] else store.now_iso()
        store.set_meta("installed_at", value)
    return value


def views():
    today = date.today().isoformat()
    soon = (date.today() + timedelta(days=3)).isoformat()
    week = (date.today() + timedelta(days=7)).isoformat()
    now = datetime.now().isoformat(timespec="minutes")
    old = (datetime.now(timezone.utc) - timedelta(days=LIKELY_DONE_DAYS)).isoformat()
    recent = (datetime.now(timezone.utc) - timedelta(days=14)).isoformat()  # « Pour info » : les 2 dernières semaines
    fresh = (datetime.now(timezone.utc) - timedelta(hours=36)).isoformat()
    inst = installed_at()
    open_ = f"t.status IN {OPEN} AND (t.snooze_until IS NULL OR t.snooze_until <= '{now}')"
    act = "t.kind IN ('a_faire','a_transferer','engagement')"
    review = f"{open_} AND t.kind != 'info' AND COALESCE(t.reviewed,0)=0 AND th.last_date < '{inst}'"
    return {
        # « Aujourd'hui » : l'urgent, mais aussi tout ce qui est nouveau depuis 36 h — une demande récente n'est jamais cachée
        "focus": f"{open_} AND {act} AND (t.deadline <= '{soon}' OR t.priority='haute' OR t.created_at >= '{fresh}')",
        "retard": f"{open_} AND t.kind != 'info' AND t.deadline < '{today}'",
        "tout": f"{open_} AND t.kind != 'info'",
        "a_faire": f"{open_} AND t.kind='a_faire'",
        "a_transferer": f"{open_} AND t.kind='a_transferer'",
        "engagement": f"{open_} AND t.kind='engagement'",
        "en_attente": f"{open_} AND (t.kind='en_attente' OR t.status='en_attente')",
        "semaine": f"{open_} AND t.kind != 'info' AND t.deadline <= '{week}'",
        "revue": review,
        "probables": f"{review} AND th.last_date < '{old}'",
        "info": f"t.kind='info' AND t.status NOT IN ('fait','ignore') AND th.last_date >= '{recent}'",
        "reportes": f"t.status IN {OPEN} AND t.snooze_until > '{now}'",
        "fait": "t.status IN ('fait','ignore')",
    }


FROM = "FROM tasks t LEFT JOIN threads th ON th.thread_key = t.thread_key"


def list_tasks(view, q=None, lot=None):
    where = views().get(view, views()["tout"])
    params = []
    if q:
        where += " AND (t.title LIKE ? OR t.summary LIKE ? OR th.subject LIKE ? OR th.last_from LIKE ? OR t.lot LIKE ?)"
        params += [f"%{q}%"] * 5
    if lot:
        where += " AND t.lot = ?"
        params.append(lot)
    order = "t.updated_at DESC" if view == "fait" else f"(t.deadline IS NULL), t.deadline, {PRIO}, th.last_date DESC"
    rows = store.query(
        f"SELECT t.*, th.subject AS thread_subject, th.last_from, th.last_date, th.msg_count, th.folder {FROM} WHERE {where} ORDER BY {order} LIMIT 400",
        params,
    )
    for r in rows:
        r["steps"] = json.loads(r["steps"] or "[]")
    return rows


def counts():
    return {name: store.query(f"SELECT COUNT(*) n {FROM} WHERE {cond}")[0]["n"] for name, cond in views().items()}


def lots():
    return store.query(f"SELECT t.lot AS lot, COUNT(*) AS n {FROM} WHERE {views()['tout']} AND t.lot IS NOT NULL "
                       "GROUP BY t.lot ORDER BY n DESC")


def flux(days=14):
    """Mails reçus par jour (heure locale) sur les derniers jours."""
    since = (datetime.now(timezone.utc) - timedelta(days=days + 1)).isoformat()
    per_day = {}
    for r in store.query("SELECT date_utc FROM messages WHERE direction='in' AND date_utc >= ?", (since,)):
        d = datetime.fromisoformat(r["date_utc"]).astimezone().date()
        per_day[d] = per_day.get(d, 0) + 1
    out = []
    for i in range(days - 1, -1, -1):
        d = date.today() - timedelta(days=i)
        out.append({"day": d.strftime("%d/%m"), "n": per_day.get(d, 0)})
    return out


def signal(days=14):
    """Oscillogrammes de la console : mails reçus, tâches créées et tâches terminées par jour."""
    since = (datetime.now(timezone.utc) - timedelta(days=days + 1)).isoformat()
    first = date.today() - timedelta(days=days - 1)

    def per_day(sql):
        counts = [0] * days
        for r in store.query(sql, (since,)):
            i = (datetime.fromisoformat(r["d"]).astimezone().date() - first).days
            if 0 <= i < days:
                counts[i] += 1
        return counts
    return {"received": [f["n"] for f in flux(days)],
            "created": per_day("SELECT created_at d FROM tasks WHERE created_at >= ?"),
            "done": per_day("SELECT updated_at d FROM tasks WHERE status='fait' AND updated_at >= ?")}


def next_deadline():
    rows = store.query(f"SELECT t.id, t.title, t.deadline {FROM} WHERE {views()['tout']} AND t.deadline >= ? "
                       f"ORDER BY t.deadline, {PRIO} LIMIT 1", (date.today().isoformat(),))
    return rows[0] if rows else None


def api_state():
    return {
        "me": ME_NAME.split()[0].title(),
        "counts": counts(),
        "lots": lots(),
        "flux": flux(),
        "next": next_deadline(),
        "engine": json.loads(store.get_meta("engine_status") or '{"ok": null, "message": "vérification…"}'),
        "paused_until": analyze.paused_until(),
        "usage_today": analyze.usage(1)[0],
        "learning": local.stats(),
        "llm": llm.status(),
        "log": journal.lines(30),
        "llm_reading": state.get("llm_reading", False),
        "signal": signal(),
        "today": {r["source"]: r["n"] for r in store.query(
            "SELECT source, COUNT(*) n FROM tasks WHERE created_at >= ? GROUP BY source",
            (datetime.combine(date.today(), datetime.min.time()).astimezone(timezone.utc).isoformat(),))},
        "llm_pending": store.query("SELECT COUNT(*) n FROM threads WHERE llm_pending=1 AND all_noise=0")[0]["n"],
        "busy": state["busy"], "step": state["step"],
        "last_scan": store.get_meta("last_scan"), "last_analysis": store.get_meta("last_analysis"),
        "installed_at": installed_at(),
        "messages": store.query("SELECT COUNT(*) n FROM messages")[0]["n"],
        "threads": store.query("SELECT COUNT(*) n FROM threads")[0]["n"],
        "pending": store.query("SELECT COUNT(*) n FROM threads WHERE needs_analysis>0 AND all_noise=0")[0]["n"],
        "noise": store.query("SELECT COUNT(*) n FROM threads WHERE all_noise=1")[0]["n"],
        "done_today": store.query("SELECT COUNT(*) n FROM tasks WHERE status='fait' AND updated_at >= ?",
                                  (datetime.combine(date.today(), datetime.min.time()).astimezone(timezone.utc).isoformat(),))[0]["n"],
    }


def update_tasks(ids, fields, note=None):
    fields = {k: v for k, v in fields.items() if k in EDITABLE}
    if not ids or not fields:
        return {"ok": False}
    sets = ", ".join(f"{k}=?" for k in fields) + ", user_edited=1, updated_at=?"
    for tid in ids:
        store.execute(f"UPDATE tasks SET {sets} WHERE id=?", (*fields.values(), store.now_iso(), int(tid)))
        if note:
            store.execute("UPDATE tasks SET notes = TRIM(COALESCE(notes,'') || ' ' || ?) WHERE id=?", (note, int(tid)))
    what = {"fait": "fait", "ignore": "ignorer", "delegue": "transférer"}.get(fields.get("status"))
    if what or "kind" in fields or "priority" in fields:
        journal.log("apprendre", f"+{len(ids)} décision{'s' if len(ids) > 1 else ''} ({what or 'reclassement'})")
    return {"ok": True, "n": len(ids)}


def backfill_lots():
    for r in store.query("SELECT id, title, summary FROM tasks WHERE lot IS NULL"):
        lot = analyze.guess_lot(r["title"], r["summary"])
        if lot:
            store.execute("UPDATE tasks SET lot=? WHERE id=?", (lot, r["id"]))


def sync_now(manual=False):
    """Lecture des nouveaux mails + analyse locale (règles + apprentissage). Quelques secondes, zéro jeton Claude."""
    with sync_lock:
        state.update(busy=True, step="Lecture des nouveaux mails…")
        try:
            new = ingest.scan()
            state["step"] = "Analyse locale…"
            threads, tasks = local.process_pending()
            tasks += local.zero_oubli()  # filet de sécurité : question directe restée sans réponse ni tâche depuis 24 h
            state.update(last_new=new, last_analyzed=threads)
            if new or manual:
                journal.log("sync", f"{new} nouveau{'x' if new > 1 else ''} mail{'s' if new > 1 else ''} · {threads} fil{'s' if threads > 1 else ''} analysé{'s' if threads > 1 else ''}")
            if threads:
                llm_wake.set()
            return {"ok": True, "new": new, "threads": threads, "tasks": tasks}
        finally:
            state["busy"], state["step"] = False, ""


def llm_worker():
    """IA locale en arrière-plan : relit un par un les fils qui peuvent demander une action (du plus récent au plus ancien)."""
    store.execute("UPDATE threads SET llm_pending=1 WHERE llm_pending=2")  # nouvel essai après un échec
    while True:
        try:
            if llm.ensure_running() and llm.model_ready():
                state["llm_reading"] = True
                try:
                    key = llm.process_one()
                finally:
                    state["llm_reading"] = False
                if key:
                    state["llm_done"] += 1
                    store.set_meta("last_analysis", store.now_iso())
                    continue
        except Exception as exc:
            print(f"[llm] {exc}")
        llm_wake.wait(60)
        llm_wake.clear()


def worker():
    try:
        state.update(busy=True, step="Mise à jour de la base…")
        ingest.migrate()
        store.execute("DELETE FROM meta WHERE k='paused_until'")  # plus d'analyse Claude automatique à mettre en pause
    except Exception as exc:
        print(f"[migrate] {exc}")
    while True:
        try:
            sync_now()
        except Exception as exc:
            print(f"[worker] {exc}")
        wake.wait(SYNC_EVERY_SECONDS)
        wake.clear()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def _send(self, code, body, ctype="application/json; charset=utf-8"):
        data = body if isinstance(body, bytes) else json.dumps(body, ensure_ascii=False, default=str).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _json_body(self):
        length = int(self.headers.get("Content-Length") or 0)
        return json.loads(self.rfile.read(length) or b"{}")

    def do_GET(self):
        url = urlparse(self.path)
        qs = {k: v[0] for k, v in parse_qs(url.query).items()}
        if url.path == "/api/state":
            return self._send(200, api_state())
        if url.path == "/api/tasks":
            return self._send(200, list_tasks(qs.get("view", "focus"), qs.get("q"), qs.get("lot")))
        if url.path == "/api/folders":
            return self._send(200, ingest.folders_summary())
        if url.path == "/api/usage":
            return self._send(200, analyze.usage(7))
        if url.path == "/api/thread":
            return self._send(200, store.query(
                "SELECT msg_id, direction, from_name, from_addr, to_addrs, cc_addrs, subject, date_utc, body, has_attachments, "
                "folder, web_link, is_form, "
                "source_file LIKE '%.eml' AS can_open FROM messages WHERE thread_key=? ORDER BY date_utc", (qs.get("key", ""),)))
        path = STATIC_DIR / ("index.html" if url.path in ("/", "") else url.path.lstrip("/"))
        if path.is_file() and STATIC_DIR in path.resolve().parents:
            text = {".html": "text/html", ".css": "text/css", ".js": "application/javascript", ".svg": "image/svg+xml"}
            binary = {".png": "image/png", ".ico": "image/x-icon"}
            ctype = text[path.suffix] + "; charset=utf-8" if path.suffix in text else binary.get(path.suffix, "application/octet-stream")
            return self._send(200, path.read_bytes(), ctype)
        self._send(404, {"error": "introuvable"})

    def do_POST(self):
        url = urlparse(self.path)
        body = self._json_body()
        if url.path == "/api/task":
            tid = body.pop("id", None)
            return self._send(200, update_tasks([tid] if tid else [], body))
        if url.path == "/api/bulk":
            return self._send(200, update_tasks(body.get("ids") or [], body.get("fields") or {}, body.get("note")))
        if url.path == "/api/command":
            try:
                return self._send(200, analyze.command((body.get("text") or "").strip()[:500]))
            except Exception as exc:
                return self._send(200, {"reply": f"Je n’ai pas pu traiter la demande : {exc}"[:300], "actions": [], "error": True})
        if url.path == "/api/sync":
            return self._send(200, sync_now(manual=True))
        if url.path == "/api/engine":
            return self._send(200, analyze.engine_status(force=True))
        if url.path == "/api/folders":
            store.set_meta("folders_excluded", json.dumps(sorted(body.get("excluded") or []), ensure_ascii=False))
            n = ingest.apply_folder_choices()
            wake.set()
            return self._send(200, {"ok": True, "threads": n})
        if url.path == "/api/reanalyze":  # Claude, à la demande, sur un seul fil
            journal.log("✦ claude", "analyse d'un fil à la demande")
            return self._send(200, analyze.analyze_thread(body.get("thread_key") or ""))
        if url.path == "/api/draft":      # Claude, à la demande : réponse rédigée
            journal.log("✦ claude", "rédaction d'une réponse à la demande")
            return self._send(200, analyze.draft(body.get("id") or 0))
        if url.path == "/api/open":
            rows = store.query("SELECT source_file FROM messages WHERE msg_id=?", (body.get("msg_id"),))
            if rows and rows[0]["source_file"].lower().endswith(".eml") and Path(rows[0]["source_file"]).exists():
                os.startfile(rows[0]["source_file"])
                return self._send(200, {"ok": True})
            return self._send(200, {"ok": False})
        self._send(404, {"error": "introuvable"})


def main():
    store.db()
    journal.seed(store)
    backfill_lots()
    installed_at()
    threading.Thread(target=worker, daemon=True).start()
    threading.Thread(target=llm_worker, daemon=True).start()
    ThreadingHTTPServer.allow_reuse_address = False  # sous Windows, sinon on partage le port d'une autre appli en silence
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    url = f"http://{HOST}:{PORT}/"
    print(f"Vigie Tour tourne sur {url}  (Ctrl+C pour arrêter)")
    if os.environ.get("VIGIE_NO_BROWSER") != "1":
        threading.Timer(1.0, lambda: webbrowser.open(url)).start()
    server.serve_forever()


if __name__ == "__main__":
    main()
