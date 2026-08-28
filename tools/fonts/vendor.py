#!/usr/bin/env python3
"""Vendor the web app's typefaces as woff2, so no request ever leaves the origin.

GhostPass encrypts on the device so the server never sees anything. A <link> to
fonts.googleapis.com voided that promise on every page load: the holder's IP,
user agent and referrer reached a third party before the unlock screen. This
script fetches the faces once; nginx serves them from the app's own origin.

Run it when a weight or a family changes in FAMILIES below:

    uv run --with 'fonttools[woff]==4.55.3' tools/fonts/vendor.py

It rewrites apps/web/public/fonts/ and apps/web/src/fonts.css, then prints the
SHA256 of every file. Review the diff: a font that changes bytes without a
declared reason is worth a question.

Two traps this script exists to survive:

  * Hanken Grotesk is a VARIABLE font. Google emits one @font-face per
    requested weight, all pointing at the same file. Copying that shape with
    per-weight filenames makes the browser download identical bytes once per
    name. We deduplicate by hash and declare `font-weight: 100 900` instead.
  * Only the `latin` and `latin-ext` subsets are kept. French needs nothing
    else (oe sits in `latin`), and every other subset is dead weight the
    unicode-range would never request anyway.
"""

from __future__ import annotations

import hashlib
import pathlib
import re
import sys
import urllib.parse
import urllib.request

from fontTools.ttLib import TTFont

# A modern UA is required: Google serves ttf to anything it does not recognise.
UA = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
CSS_API = "https://fonts.googleapis.com/css2"
FAMILIES = {
    "Hanken Grotesk": ("hanken-grotesk", "400;500;600;700"),
    "Spectral": ("spectral", "500;600;700"),
    # Le monospace de la charte ghost-suite, commun aux huit produits
    # (ghostsuite/tools/brand/vendor_fonts.py, décision du 2026-08-27).
    # GhostPass servait IBM Plex Mono, seul de la suite à le faire.
    "JetBrains Mono": ("jetbrains-mono", "400;500;700"),
}
SUBSETS = {"latin", "latin-ext"}

ROOT = pathlib.Path(__file__).resolve().parents[2]
FONT_DIR = ROOT / "apps/web/public/fonts"
CSS_OUT = ROOT / "apps/web/src/fonts.css"

HEADER = """/* Polices auto-hébergées — aucune requête ne sort de l'origine.
 *
 * FICHIER GÉNÉRÉ par tools/fonts/vendor.py — ne pas éditer à la main.
 *
 * GhostPass chiffre sur l'appareil pour que le serveur ne voie jamais rien.
 * Un <link> vers fonts.googleapis.com annulait cette promesse à chaque
 * chargement de page : adresse IP, agent et référent du porteur partaient chez
 * un tiers avant même l'écran de déverrouillage.
 *
 * Hanken Grotesk et JetBrains Mono sont des POLICES VARIABLES : un seul
 * fichier par sous-ensemble couvre tout l'intervalle de graisses, et
 * l'intervalle déclaré est lu dans la table fvar de chaque fichier — le coder
 * en dur donnait 100 à 900 à JetBrains Mono, qui s'arrête à 800. Spectral est
 * une instance statique, un fichier par poids. Licences dans
 * public/fonts/OFL.txt.
 *
 * font-display: swap — sur un coffre-fort, ne rien voir vaut moins que voir
 * dans la police de repli.
 */
"""


# Les deux seuls hôtes dont ce script accepte des octets. Tout le reste est
# refusé avant la requête : les URL viennent d'une réponse HTTP, donc d'une
# source que nous ne contrôlons pas, et `urllib` accepte `file://` — une
# réponse détournée ferait lire un fichier local et l'écrirait dans le dépôt
# sous un nom de police. C'est exactement ce que la règle Semgrep
# `dynamic-urllib-use-detected` signale, et cette liste y répond.
ALLOWED_HOSTS = frozenset({"fonts.googleapis.com", "fonts.gstatic.com"})


def fetch(url: str) -> bytes:
    parts = urllib.parse.urlsplit(url)
    if parts.scheme != "https" or parts.hostname not in ALLOWED_HOSTS:
        raise ValueError(f"URL refusée : {parts.scheme}://{parts.hostname}")
    # L'identifiant porte son dernier segment en double — c'est la forme que
    # Semgrep rend, et une version tronquée ne supprime rien du tout.
    # nosemgrep: python.lang.security.audit.dynamic-urllib-use-detected.dynamic-urllib-use-detected
    return urllib.request.urlopen(
        urllib.request.Request(url, headers={"User-Agent": UA}), timeout=30
    ).read()


def main() -> int:
    query = "&".join(f"family={f.replace(' ', '+')}:wght@{w}"
                     for f, (_, w) in FAMILIES.items())
    css = fetch(f"{CSS_API}?{query}&display=swap").decode()

    seen: dict[str, dict] = {}
    for block in re.split(r"(?=/\* )", css):
        head = re.match(r"/\* ([a-z-]+) \*/", block)
        if not head or head.group(1) not in SUBSETS:
            continue
        subset = head.group(1)
        family = re.search(r"font-family: '([^']+)'", block).group(1)
        weight = int(re.search(r"font-weight: (\d+)", block).group(1))
        url = re.search(r"url\((https://[^)]+\.woff2)\)", block).group(1)
        rng = re.search(r"unicode-range: ([^;]+);", block).group(1)

        data = fetch(url)
        digest = hashlib.sha256(data).hexdigest()
        if digest in seen:            # même fichier qu'un poids déjà vu → variable
            seen[digest]["weights"].append(weight)
            continue

        slug = FAMILIES[family][0]
        tmp = FONT_DIR / f".probe-{digest[:8]}.woff2"
        FONT_DIR.mkdir(parents=True, exist_ok=True)
        tmp.write_bytes(data)
        variable = "fvar" in TTFont(tmp)
        tmp.unlink()

        name = f"{slug}-{'variable' if variable else weight}-{subset}.woff2"
        (FONT_DIR / name).write_bytes(data)
        seen[digest] = dict(family=family, name=name, subset=subset, rng=rng,
                            variable=variable, weights=[weight],
                            sha=digest, size=len(data))

    faces = sorted(seen.values(),
                   key=lambda e: (e["family"], e["subset"] != "latin", e["weights"][0]))
    if not faces:
        print("aucune police récupérée — l'API a changé de forme ?", file=sys.stderr)
        return 2

    kept = {e["name"] for e in faces}
    for stale in FONT_DIR.glob("*.woff2"):
        if stale.name not in kept:
            stale.unlink()
            print(f"  retiré  {stale.name}")

    body = [HEADER]
    for e in faces:
        if e["variable"]:
            # L'intervalle vient de la police, pas d'une constante : « 100 900 »
            # était juste pour Hanken Grotesk et faux pour toute autre variable.
            # Un navigateur à qui on promet un poids que le fichier n'a pas
            # synthétise un gras, ce qui ne ressemble à aucune erreur.
            axe = next(a for a in TTFont(FONT_DIR / e["name"])["fvar"].axes
                       if a.axisTag == "wght")
            weight = f"{int(axe.minValue)} {int(axe.maxValue)}"
        else:
            weight = str(e["weights"][0])
        body.append(f"""
@font-face {{
  font-family: "{e['family']}";
  font-style: normal;
  font-weight: {weight};
  font-display: swap;
  src: url("/fonts/{e['name']}") format("woff2");
  unicode-range: {e['rng']};
}}""")
    CSS_OUT.write_text("\n".join(body) + "\n")

    total = sum(e["size"] for e in faces)
    print(f"{len(faces)} fichiers, {total / 1024:.0f} Kio")
    for e in faces:
        print(f"  {e['sha'][:12]}  {e['name']:40s} {e['size'] / 1024:6.1f} Kio")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
