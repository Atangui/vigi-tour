"""Lanceur Vigie Tour : démarre le serveur s'il ne tourne pas, puis ouvre l'interface dans une fenêtre d'application."""
import os
import subprocess
import sys
import time
import urllib.request
import webbrowser
from pathlib import Path

from config import DATA_DIR, HOST, PORT

APP_DIR = Path(__file__).resolve().parent
URL = f"http://{HOST}:{PORT}/"
EDGE_PATHS = [
    Path(os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)")) / "Microsoft/Edge/Application/msedge.exe",
    Path(os.environ.get("ProgramFiles", r"C:\Program Files")) / "Microsoft/Edge/Application/msedge.exe",
]
NO_PROXY = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def running():
    try:
        return NO_PROXY.open(URL + "api/state", timeout=8).status == 200
    except Exception:
        return False


def start_server():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    pythonw = Path(sys.executable).with_name("pythonw.exe")
    env = dict(os.environ, VIGIE_NO_BROWSER="1", PYTHONIOENCODING="utf-8")
    log = open(DATA_DIR / "server.log", "a", encoding="utf-8")
    subprocess.Popen(
        [str(pythonw if pythonw.exists() else sys.executable), str(APP_DIR / "server.py")],
        cwd=APP_DIR, env=env, stdout=log, stderr=log,
        creationflags=subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.CREATE_NO_WINDOW,
    )
    for _ in range(40):
        if running():
            return True
        time.sleep(0.25)
    return False


def open_window():
    edge = next((p for p in EDGE_PATHS if p.exists()), None)
    if edge:  # fenêtre d'application dédiée, sans barre d'adresse
        subprocess.Popen([str(edge), f"--app={URL}", "--window-size=1440,900"])
    else:
        webbrowser.open(URL)


if __name__ == "__main__":
    if not running():
        start_server()
    if "--background" not in sys.argv:
        open_window()
