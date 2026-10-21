"""Journal du moteur : ce que Vigie Tour fait en ce moment (affiché dans les terminaux du thème Spatial)."""
import threading
from collections import deque
from datetime import datetime

_lines = deque(maxlen=80)
_lock = threading.Lock()
_seq = [0]


def log(verb, text):
    """Une ligne : « 041 lire     Ticket 4821 — Alerte plugin… »."""
    with _lock:
        _seq[0] += 1
        _lines.append({"n": _seq[0], "verb": verb, "text": " ".join(str(text).split())[:90],
                       "at": datetime.now().strftime("%H:%M:%S")})


def lines(limit=30):
    with _lock:
        return list(_lines)[-limit:]


def seed(store):
    """Au démarrage, le journal reprend les dernières tâches classées pour ne pas s'afficher vide."""
    if _lines:
        return
    labels = {"a_faire": "à faire", "a_transferer": "à transférer", "engagement": "engagement",
              "en_attente": "en attente", "info": "à trier"}
    for t in reversed(store.query("SELECT kind, title, source FROM tasks ORDER BY id DESC LIMIT 14")):
        who = {"local": "règles", "ia": "ia", "claude": "✦ claude"}.get(t["source"], "classer")
        log(who, f"→ {labels.get(t['kind'], t['kind'])} · {t['title']}")
