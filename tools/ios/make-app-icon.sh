#!/usr/bin/env bash
# Produit l'icône de l'application iOS à partir du logo de la suite.
#
# La source est `assets/logo/favicon.svg` : la variante **remplie** du logo, celle que
# ghostboard emploie comme icône. Le logo au trait ne convient pas — son trait fait 4 %
# de la hauteur et disparaît aux petites tailles.
#
# Deux écarts avec la source, et deux seulement :
#   — le cadrage est recentré sur le tracé. Le viewBox d'origine est aligné en haut : le
#     fantôme occupe y 9..496 dans un carré de 548, soit 9 px de marge au-dessus contre
#     52 en dessous. Sous le masque arrondi d'iOS, il frôlerait le bord.
#   — le fond est aplati en blanc : une icône d'application ne peut pas être transparente,
#     là où le favicon de la suite l'est.
#
# Le fichier source n'est pas modifié : il est généré par tools/brand/ghost_suite.py et
# porte la mention « ne pas éditer à la main ».
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SOURCE="$ROOT/assets/logo/favicon.svg"
CIBLE="$ROOT/apps/ios/Ghostpass/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png"
MARGE=0.10

command -v rsvg-convert >/dev/null || { echo "rsvg-convert manquant : brew install librsvg" >&2; exit 1; }
[[ -f "$SOURCE" ]] || { echo "Logo introuvable : $SOURCE" >&2; exit 1; }

TEMPO="$(mktemp -d)"
trap 'rm -rf "$TEMPO"' EXIT

SOURCE="$SOURCE" MARGE="$MARGE" python3 - "$TEMPO/icone.svg" <<'PY'
import os, re, sys

svg = open(os.environ["SOURCE"]).read()
marge = float(os.environ["MARGE"])

# Boîte du tracé : la silhouette n'emploie que M et C, donc les coordonnées alternent en
# x et y, et les courbes restent dans l'enveloppe de leurs points de contrôle.
trace = re.search(r'<path[^>]*\sd="([^"]*)"', svg, re.S).group(1)
silhouette = trace[: trace.index("Z") + 1]
valeurs = [float(n) for n in re.findall(r'-?\d+\.?\d*', silhouette)]
xs, ys = valeurs[0::2], valeurs[1::2]
cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
cote = max(max(xs) - min(xs), max(ys) - min(ys)) / (1 - 2 * marge)

recadre = f'viewBox="{cx - cote / 2:.1f} {cy - cote / 2:.1f} {cote:.1f} {cote:.1f}"'
open(sys.argv[1], "w").write(re.sub(r'viewBox="[^"]*"', recadre, svg, count=1))
print(f"  tracé {min(xs):.0f}..{max(xs):.0f} × {min(ys):.0f}..{max(ys):.0f} → {recadre}")
PY

rsvg-convert -w 1024 -h 1024 -b white "$TEMPO/icone.svg" -o "$CIBLE"
echo "  icône écrite : ${CIBLE#$ROOT/}"
