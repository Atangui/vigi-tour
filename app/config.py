"""Configuration de Vigie Tour : chemins, identité, annuaire « qui gère quoi ».

L'identité (nom, e-mail, rôle) et l'annuaire des collègues viennent de `config.local.json`, à la racine du dépôt
(ignoré par git). Copiez `config.example.json` en `config.local.json` et adaptez-le. Sans ce fichier, l'application
démarre avec l'identité fictive d'« Alex Martin ».

Réglages possibles (fichier ou variable d'environnement, la variable l'emporte) :
  inbox_dir   / VIGIE_INBOX   dossier surveillé, synchronisé par Power Automate (défaut : ~/VigieTour/inbox)
  claude_exe  / VIGIE_CLAUDE  chemin de la CLI Claude (optionnelle, uniquement pour les boutons ✦)
  claude_model/ VIGIE_MODEL   modèle Claude appelé à la demande (défaut : haiku)
  port        / VIGIE_PORT    port du serveur local (défaut : 8777)
  VIGIE_DATA                  dossier de la base SQLite (défaut : ./data) ; VIGIE_CONFIG : autre fichier de config
"""
import json
import os
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.environ.get("VIGIE_DATA") or ROOT / "data")  # base SQLite + journaux (ignorés par git)
DB_PATH = DATA_DIR / "vigie.db"
STATIC_DIR = Path(__file__).resolve().parent / "static"
CONFIG_PATH = Path(os.environ.get("VIGIE_CONFIG") or ROOT / "config.local.json")

# Annuaire fictif, utilisé tant que config.local.json ne définit pas « people ».
DEFAULT_PEOPLE = [
    {"nom": "Léa Martin", "email": "lea.martin@example.com", "role": "Head of Digital",
     "sujets": "arbitrages web, sites, plugins, priorités de l'équipe digitale"},
    {"nom": "Hugo Bernard", "email": "hugo.bernard@example.com", "role": "VP Operations",
     "sujets": "budget, facturation, hébergement, décisions"},
    {"nom": "Sarah Cohen", "email": "sarah.cohen@example.com", "role": "Responsable communication",
     "sujets": "contenus des événements, intervenants, bios, programme"},
    {"nom": "Yanis Petit", "email": "yanis.petit@example.com", "role": "Graphiste senior",
     "sujets": "visuels, logos partenaires, bannières"},
]


def _load():
    if CONFIG_PATH.exists():
        try:
            return json.loads(CONFIG_PATH.read_text(encoding="utf-8-sig"))
        except Exception as exc:  # un JSON cassé ne doit pas empêcher l'appli de démarrer
            print(f"[config] {CONFIG_PATH.name} illisible : {exc}")
    return {}


CONFIG = _load()
_me = CONFIG.get("me") or {}

ME_EMAIL = (_me.get("email") or "alex.martin@example.com").strip().lower()
ME_NAME = _me.get("name") or "Alex Martin"
ME_ROLE = _me.get("role") or "Webmaster chez Nova Events (sites événementiels, newsletters, WordPress)"
ME_DOMAIN = ME_EMAIL.split("@")[-1]  # les adresses de ce domaine sont des « collègues »

# Dossier synchronisé (OneDrive, Dropbox, dossier local…) où Power Automate dépose les mails.
INBOX_ROOT = Path(os.path.expanduser(os.environ.get("VIGIE_INBOX") or CONFIG.get("inbox_dir") or "~/VigieTour/inbox"))
INBOX_DIRS = [
    INBOX_ROOT / "arrivee",     # capture continue (.eml), flux « Capture »
    INBOX_ROOT / "historique",  # rattrapage (.eml ou .json), flux « Historique »
]
FOLDERS_DIR = INBOX_ROOT / "dossiers"  # liste des dossiers Outlook (dossiers-*.json), déposée par le flux d'historique
INBOX_NAME, SENT_NAME = "Boîte de réception", "Éléments envoyés"

CLAUDE_EXE = (os.environ.get("VIGIE_CLAUDE") or CONFIG.get("claude_exe") or shutil.which("claude")
              or str(Path.home() / ".local" / "bin" / ("claude.exe" if os.name == "nt" else "claude")))
CLAUDE_MODEL = os.environ.get("VIGIE_MODEL") or CONFIG.get("claude_model") or "haiku"  # appelé uniquement à la demande
SYNC_EVERY_SECONDS = 60   # lecture du dossier surveillé
HOST = "127.0.0.1"
PORT = int(os.environ.get("VIGIE_PORT") or CONFIG.get("port") or 8777)


def load_people():
    """Annuaire « qui gère quoi » : celui de config.local.json, sinon l'annuaire fictif par défaut."""
    return CONFIG.get("people") or DEFAULT_PEOPLE
