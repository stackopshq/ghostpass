#!/usr/bin/env bash
# Produit l'icône adaptative Android à partir du logo de la suite.
#
# Pendant de `tools/ios/make-brand-assets.sh`, et il ne fait presque rien lui-même : tout le
# travail est dans `suite/tools/brand/icone-adaptative-android.py`, qui mesure la silhouette
# et la recadre pour la **zone sûre de 72 dp** — pas pour la toile de 108 (charte §6).
#
# La source est `assets/logo/favicon.svg`, la variante remplie : le logo au trait a un trait
# de 4 % de la hauteur, qui disparaît aux petites tailles.
#
# Ce script est court parce que la difficulté n'est pas ici. Elle est dans la proportion, et
# l'outil la vérifie sur le PNG qu'il vient d'écrire — un cadrage juste sur le papier et
# faux à l'écran s'installerait, se lancerait, et ne paraîtrait trop grand que chez
# quelqu'un d'autre.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUTIL="$ROOT/../suite/tools/brand/icone-adaptative-android.py"
SOURCE="$ROOT/assets/logo/favicon.svg"
RES="$ROOT/apps/android/app/src/main/res"

[[ -f "$OUTIL" ]] || { echo "Outil de charte introuvable : $OUTIL" >&2; exit 1; }
[[ -f "$SOURCE" ]] || { echo "Logo introuvable : $SOURCE" >&2; exit 1; }

# La nuit de la charte, celle de `values/colors.xml`. Le fond d'une icône adaptative doit
# être opaque : Android compose le premier plan par-dessus, et une couche transparente
# laisserait voir ce que le lanceur a derrière.
exec python3 "$OUTIL" "$SOURCE" "$RES" --fond "#0B0F17"
