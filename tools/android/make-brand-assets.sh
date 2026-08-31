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
# `GHOSTSUITE` dit où trouver le dépôt de la charte ; par défaut, un clone voisin. C'est la
# convention de `build-jni.sh`, et coder le chemin en dur ici obligeait à ranger les deux
# dépôts d'une seule façon — sans le dire, et en échouant sur « outil introuvable ».
SUITE="${GHOSTSUITE:-$(cd "$ROOT/.." && pwd)/suite}"
OUTIL="$SUITE/tools/brand/icone-adaptative-android.py"
CADRE="$SUITE/tools/brand/icone-ios.py"
SOURCE="$ROOT/assets/logo/favicon.svg"
RES="$ROOT/apps/android/app/src/main/res"

[[ -f "$OUTIL" ]] || { echo "Outil de charte introuvable : $OUTIL" >&2; exit 1; }
[[ -f "$SOURCE" ]] || { echo "Logo introuvable : $SOURCE" >&2; exit 1; }

# La nuit de la charte, celle de `values/colors.xml`. Le fond d'une icône adaptative doit
# être opaque : Android compose le premier plan par-dessus, et une couche transparente
# laisserait voir ce que le lanceur a derrière.
python3 "$OUTIL" "$SOURCE" "$RES"

# ─── L'enseigne de l'écran d'entrée ───
#
# La marque posée sur la plaque, en `drawable-*`. Fond **transparent** : c'est la plaque qui
# fournit le contraste, et l'aplatir ici donnerait un carré blanc au milieu d'une carte de
# verre.
#
# Recadrée par `icone-ios.py --cadre`, et c'est ce qui manquait : la plaque donne sa marge
# autour de l'**image**, pas autour de la silhouette. Sans recadrage, la silhouette remplit
# sa boîte bord à bord et paraît à l'étroit — là où celle de son produit frère respire.
echo
echo "Enseigne (drawable-*/marque.png)"
TEMPO="$(mktemp -d)"
trap 'rm -rf "$TEMPO"' EXIT
python3 "$CADRE" --cadre "$TEMPO/marque.svg" "$SOURCE"
# 64 dp — la taille de la plaque dans `EcranDeDeverrouillage`.
for densite in mdpi:64 hdpi:96 xhdpi:128 xxhdpi:192 xxxhdpi:256; do
  nom="${densite%%:*}"; cote="${densite##*:}"
  mkdir -p "$RES/drawable-$nom"
  rsvg-convert -w "$cote" -h "$cote" "$TEMPO/marque.svg" -o "$RES/drawable-$nom/marque.png"
  printf "  drawable-%-8s %4s px\n" "$nom" "$cote"
done
