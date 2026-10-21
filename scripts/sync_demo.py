"""Régénère docs/ (démo statique, prête pour GitHub Pages) à partir de app/static/.

    python scripts/sync_demo.py

Copie app.css, app.js, globe.js et les icônes telles quelles, puis produit docs/index.html à partir de
app/static/index.html : titre « démo », métadonnées de partage, et chargement de docs/demo.js (qui simule
l'API /api/... dans le navigateur) avant l'application. docs/demo.js est maintenu à la main.
"""
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC, DST = ROOT / "app" / "static", ROOT / "docs"

TITLE = "Vigie Tour — démo interactive"
DESCRIPTION = ("Vigie Tour transforme vos e-mails en tâches (à faire, en attente, engagements, échéances) "
               "avec une analyse locale, zéro jeton. Démo interactive : données fictives.")
META = (f'<meta name="description" content="{DESCRIPTION}">\n'
        f'  <meta property="og:title" content="{TITLE}">\n'
        f'  <meta property="og:description" content="{DESCRIPTION}">\n'
        '  <meta property="og:type" content="website">\n'
        '  <meta name="twitter:card" content="summary">')


def main():
    DST.mkdir(exist_ok=True)
    for name in ("app.css", "app.js", "globe.js", "vigie.png", "vigie.ico"):
        shutil.copyfile(SRC / name, DST / name)
    html = (SRC / "index.html").read_text(encoding="utf-8")
    for old, new in (
        ("<title>Vigie Tour</title>", f"<title>{TITLE}</title>\n  {META}"),
        ('<script src="globe.js"></script>', '<script src="demo.js"></script>\n  <script src="globe.js"></script>'),
    ):
        if html.count(old) != 1:
            raise SystemExit(f"Motif introuvable dans index.html : {old}")
        html = html.replace(old, new)
    (DST / "index.html").write_text(html, encoding="utf-8", newline="\n")
    (DST / ".nojekyll").write_text("", encoding="utf-8")
    print("docs/ à jour :", ", ".join(sorted(p.name for p in DST.iterdir())))


if __name__ == "__main__":
    main()
