"""Base SQLite locale : messages, fils de discussion, tâches, recherche plein texte."""
import sqlite3
import threading
from datetime import datetime, timezone

from config import DATA_DIR, DB_PATH

_lock = threading.RLock()

SCHEMA = """
CREATE TABLE IF NOT EXISTS messages (
    msg_id TEXT PRIMARY KEY,
    thread_key TEXT NOT NULL,
    direction TEXT NOT NULL,            -- 'in' (reçu) ou 'out' (envoyé par moi)
    from_addr TEXT, from_name TEXT,
    to_addrs TEXT, cc_addrs TEXT,
    me_role TEXT,                       -- 'to', 'cc', 'from', 'other'
    subject TEXT, date_utc TEXT,
    body TEXT, preview TEXT,
    has_attachments INTEGER DEFAULT 0,
    is_noise INTEGER DEFAULT 0, noise_reason TEXT,
    source_file TEXT, ingested_at TEXT
);
CREATE INDEX IF NOT EXISTS ix_msg_thread ON messages(thread_key, date_utc);

CREATE TABLE IF NOT EXISTS threads (
    thread_key TEXT PRIMARY KEY,
    subject TEXT, last_date TEXT, last_from TEXT, last_direction TEXT,
    msg_count INTEGER DEFAULT 0,
    all_noise INTEGER DEFAULT 0,
    needs_analysis INTEGER DEFAULT 1,
    analyzed_at TEXT, analysis_error TEXT
);

CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    thread_key TEXT NOT NULL,
    kind TEXT NOT NULL,                 -- a_faire | a_transferer | engagement | en_attente | info
    title TEXT, summary TEXT,
    deadline TEXT, deadline_type TEXT,  -- explicite | estimee | aucune
    priority TEXT,                      -- haute | moyenne | basse
    delegate_to TEXT, delegate_reason TEXT,
    steps TEXT, draft_reply TEXT, evidence TEXT,
    confidence REAL,
    status TEXT DEFAULT 'a_faire',      -- a_faire | en_cours | en_attente | delegue | fait | ignore
    snooze_until TEXT, notes TEXT,
    user_edited INTEGER DEFAULT 0,
    source_msg_id TEXT,
    created_at TEXT, updated_at TEXT
);
CREATE INDEX IF NOT EXISTS ix_task_status ON tasks(status, deadline);

CREATE TABLE IF NOT EXISTS files_seen (path TEXT PRIMARY KEY, size INTEGER, mtime REAL);
CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);

CREATE VIRTUAL TABLE IF NOT EXISTS msg_fts USING fts5(msg_id UNINDEXED, subject, body, sender);
"""


def now_iso():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def connect():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(DB_PATH, check_same_thread=False, timeout=30)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA journal_mode=WAL")
    con.executescript(SCHEMA)
    _migrate(con)
    return con


def _migrate(con):
    """Colonnes ajoutées après la première version."""
    cols = {r[1] for r in con.execute("PRAGMA table_info(tasks)")}
    if "lot" not in cols:
        con.execute("ALTER TABLE tasks ADD COLUMN lot TEXT")       # regroupement de tâches similaires
    if "reviewed" not in cols:
        con.execute("ALTER TABLE tasks ADD COLUMN reviewed INTEGER DEFAULT 0")  # vue dans la revue de l'historique
    cols = {r[1] for r in con.execute("PRAGMA table_info(messages)")}
    for col, decl in (("folder", "TEXT"),        # dossier Outlook (« Boîte de réception », « Projets / Salons »…)
                      ("conv_id", "TEXT"),       # conversationId Microsoft Graph, pour rattacher les réponses
                      ("web_link", "TEXT"),      # lien Outlook sur le web
                      ("is_form", "INTEGER DEFAULT 0")):  # notification de formulaire web
        if col not in cols:
            con.execute(f"ALTER TABLE messages ADD COLUMN {col} {decl}")
    con.execute("CREATE INDEX IF NOT EXISTS ix_msg_conv ON messages(conv_id)")
    if "source" not in {r[1] for r in con.execute("PRAGMA table_info(tasks)")}:
        con.execute("ALTER TABLE tasks ADD COLUMN source TEXT DEFAULT 'claude'")  # 'claude' ou 'local' (moteur sans IA)
    cols = {r[1] for r in con.execute("PRAGMA table_info(threads)")}
    if "folder" not in cols:
        con.execute("ALTER TABLE threads ADD COLUMN folder TEXT")
    if "llm_pending" not in cols:  # 1 = à relire par l'IA locale, 2 = échec (nouvel essai au redémarrage)
        con.execute("ALTER TABLE threads ADD COLUMN llm_pending INTEGER DEFAULT 0")
    if "analyzed_by" not in cols:
        con.execute("ALTER TABLE threads ADD COLUMN analyzed_by TEXT")
        con.execute("UPDATE threads SET analyzed_by='claude' WHERE analyzed_at IS NOT NULL")
    con.commit()


_con = None


def db():
    global _con
    if _con is None:
        _con = connect()
    return _con


def query(sql, params=()):
    with _lock:
        return [dict(r) for r in db().execute(sql, params).fetchall()]


def execute(sql, params=()):
    with _lock:
        cur = db().execute(sql, params)
        db().commit()
        return cur


def set_meta(k, v):
    execute("INSERT INTO meta(k, v) VALUES(?, ?) ON CONFLICT(k) DO UPDATE SET v=excluded.v", (k, str(v)))


def get_meta(k, default=None):
    rows = query("SELECT v FROM meta WHERE k=?", (k,))
    return rows[0]["v"] if rows else default
