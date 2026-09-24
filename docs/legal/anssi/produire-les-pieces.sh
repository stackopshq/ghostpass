#!/usr/bin/env bash
# Produit les pièces du dossier ANSSI depuis leurs sources markdown.
#
# ─── Pourquoi ce script existe plutôt qu'un `pandoc` à la main ───
#
# `anssi-dossier-technique.md` est un document de travail : il porte un avertissement qui
# s'adresse à l'éditrice — « je ne suis pas juriste », « à faire relire » — et une section
# « À compléter avant dépôt » qui liste ce qui manque. Ces passages sont utiles dans le
# dépôt et **n'ont rien à faire dans une pièce envoyée à une administration** : ils
# parlent du processus de rédaction, pas du produit déclaré.
#
# Converti tel quel, le document partait avec. Clara l'a vu avant l'envoi.
#
# Une source, deux lectures : le markdown garde tout, la pièce jointe n'emporte que ce qui
# décrit le moyen de cryptologie. Le découpage se fait sur les titres, nommés ci-dessous.
set -euo pipefail

RACINE="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
SORTIE="$RACINE/docs/legal/anssi"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

command -v pandoc >/dev/null || { echo "pandoc introuvable (brew install pandoc)" >&2; exit 1; }
[[ -x "$CHROME" ]] || { echo "Chrome introuvable — il sert de moteur PDF." >&2; exit 1; }

dire() { printf "\n\033[1m▸ %s\033[0m\n" "$*" >&2; }

# Retire les sections destinées à la lecture interne. Les titres sont donnés en entier :
# une correspondance partielle emporterait un jour une section voisine sans prévenir.
sans_sections_internes() {
  python3 - "$1" <<'PY'
import re, sys
INTERNES = [
    "Avertissement sur ce que ce document est, et n'est pas",
    "Avertissement",
    "À compléter avant dépôt",
    "Pourquoi cette voie plutôt qu'une autre",
]
texte = open(sys.argv[1], encoding="utf-8").read()
sorties, garde = [], True
for ligne in texte.split("\n"):
    titre = re.match(r"^(#{1,6})\s+(.*)$", ligne)
    if titre:
        nom = re.sub(r"^\d+\.\s*", "", titre.group(2)).strip()
        nom = re.sub(r"^§?\s*\d+\.?\s*", "", nom).strip()
        garde = not any(nom.startswith(i) or i in nom for i in INTERNES)
    if garde:
        sorties.append(ligne)
print("\n".join(sorties).rstrip() + "\n", end="")
PY
}

produire() {
  local source="$1" base="$2" titre="$3" nettoyer="$4"
  local tmp; tmp="$(mktemp -t anssi).md"
  if [[ "$nettoyer" == oui ]]; then
    sans_sections_internes "$source" > "$tmp"
  else
    cp "$source" "$tmp"
  fi
  pandoc "$tmp" --metadata title="$titre" --metadata author="StackOps" \
    -o "$SORTIE/$base.docx"
  local html; html="$(mktemp -t anssi).html"
  pandoc "$tmp" -s --embed-resources --metadata title="$titre" -o "$html"
  "$CHROME" --headless --disable-gpu --no-pdf-header-footer \
    --print-to-pdf="$SORTIE/$base.pdf" "file://$html" >/dev/null 2>&1
  rm -f "$tmp" "$html"
  printf '  %-42s %s\n' "$base.pdf" "$(du -h "$SORTIE/$base.pdf" | cut -f1)" >&2
}

dire "Pièces du dossier ANSSI"
produire "$RACINE/docs/anssi-dossier-technique.md" \
  "GhostPass-dossier-technique" "GhostPass — documentation technique" oui
produire "$SORTIE/brochure-commerciale.md" \
  "GhostPass-brochure-commerciale" "GhostPass — présentation du produit" non
produire "$SORTIE/presentation-societe.md" \
  "StackOps-presentation" "StackOps — présentation de la société" non

# Le contrôle qui manquait : une pièce qui parle encore du processus de rédaction n'est
# pas prête à partir. On lit **la pièce produite**, pas la source dont elle est censée
# sortir.
#
# `pdftotext` et non `pandoc` : pandoc ne lit pas le PDF en entrée. Écrit avec lui, ce
# contrôle échouait en silence, `grep` cherchait dans du vide, et il restait vert alors
# que le nettoyage était désactivé — vérifié par mutation. Un contrôle qui ne sait pas
# rougir vaut moins que pas de contrôle, puisqu'on le croit.
#
# Pas de `-exit-on-error` : il rend 99 sur des avertissements bénins, alors que le texte
# s'extrait parfaitement — le contrôle devenait faussement rouge. C'est le **texte vide**
# qui fait foi : si rien ne sort du PDF, le contrôle n'a rien lu et doit le dire.
dire "Aucune trace interne dans les pièces produites ?"
command -v pdftotext >/dev/null || {
  echo "  pdftotext introuvable (brew install poppler) — CONTRÔLE NON EFFECTUÉ" >&2
  exit 2
}
MOTIFS="je ne suis pas juriste|à faire relire|à compléter avant|à trancher|faites relire"
fautes=0
for f in "$SORTIE"/*.pdf; do
  texte="$(pdftotext -q "$f" - 2>/dev/null || true)"
  if [[ -z "$texte" ]]; then
    echo "  ✗ $(basename "$f") : aucun texte extrait — le contrôle ne peut rien dire" >&2
    fautes=$((fautes + 1))
  elif printf '%s' "$texte" | grep -qiE "$MOTIFS"; then
    echo "  ✗ $(basename "$f") : contient un passage destiné à la lecture interne" >&2
    fautes=$((fautes + 1))
  else
    echo "  ✓ $(basename "$f")" >&2
  fi
done
[[ $fautes -eq 0 ]] || exit 1
