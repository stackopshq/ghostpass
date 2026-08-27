#!/usr/bin/env bash
# Rend les assets iOS depuis les sources vectorielles de la charte.
#
# Les PNG du catalogue Xcode sont des *sorties* : les retoucher à la main condamne le
# prochain changement de teinte à de la peinture pixel. La source est le SVG, et cette
# commande est la seule façon de produire les PNG.
#
#   ./tools/brand/render-ios-assets.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BRAND="$ROOT/tools/brand"
ASSETS="$ROOT/apps/ios/Ghostpass/Assets.xcassets"

command -v rsvg-convert >/dev/null || {
  echo "rsvg-convert introuvable — brew install librsvg" >&2
  exit 1
}

# LogoMark : la silhouette pleine, sur fond transparent. 64 pt, donc 64/128/192 px.
for facteur in 1 2 3; do
  taille=$((64 * facteur))
  rsvg-convert -w "$taille" -h "$taille" \
    "$BRAND/ghostpass-icon.svg" \
    -o "$ASSETS/LogoMark.imageset/LogoMark@${facteur}x.png"
done

# AppIcon : 1024 px, et **sans canal alpha** — l'App Store refuse une icône transparente.
# On aplatit donc sur du blanc, comme le faisait l'icône précédente.
rsvg-convert -w 1024 -h 1024 -b white \
  "$BRAND/ghostpass-icon.svg" \
  -o "$ASSETS/AppIcon.appiconset/AppIcon-1024.png"

echo "Assets rendus depuis tools/brand/ghostpass-icon.svg"
