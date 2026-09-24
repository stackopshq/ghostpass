#!/usr/bin/env bash
# **Les deux catalogues disent-ils la même chose ?**
#
#   tools/android/temoin-des-traductions.sh
#
# Ce que ce témoin attrape, et que rien d'autre n'attrape : **une clé absente de
# `values-en/` ne produit aucune erreur**. Android retombe silencieusement sur `values/`,
# et l'écran affiche du français au milieu de l'anglais. L'application se lance, les tests
# passent, l'écran s'affiche — le repli a exactement la forme d'un succès.
#
# C'est la classe de défaut que ce dépôt poursuit depuis le début : le mécanisme de secours
# produit ce que produirait le cas nominal. On ne peut donc pas le voir à l'exécution ; on
# le voit en comparant les fichiers.
#
# Il vérifie les deux sens :
#
#   - une clé de `values/` sans jumelle dans `values-en/` → l'anglais affichera du français ;
#   - une clé de `values-en/` sans jumelle dans `values/` → clé morte, ou faute de frappe
#     dans un nom : la traduction ne sera jamais atteinte, et personne ne s'en apercevra.
#
# Les chaînes marquées `translatable="false"` sont exclues du premier sens : « Français » et
# « English » s'écrivent dans leur propre langue et n'ont rien à traduire (voir
# `Preferences.Langue`).
#
# ─── Et il doit savoir tomber ───
#
#   VERIFIER_QUE_JE_ROUGIS=1 tools/android/temoin-des-traductions.sh
#
# retire une clé au hasard de chaque côté, en mémoire, et exige que le témoin la voie.
set -uo pipefail

RACINE="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RES="$RACINE/apps/android/app/src/main/res"
FR="$RES/values/strings.xml"
EN="$RES/values-en/strings.xml"

for f in "$FR" "$EN"; do
  [[ -f "$f" ]] || { echo "  ✗ introuvable : $f" >&2; exit 1; }
done

# Les noms déclarés, `plurals` compris. `translatable="false"` est repéré sur la même
# ligne que le nom, ce qui suffit : l'attribut ne s'écrit jamais ailleurs ici.
noms() {
  grep -oE '<(string|plurals) name="[^"]+"[^>]*' "$1" \
    | { if [[ "${2:-}" == "traduisibles" ]]; then grep -v 'translatable="false"'; else cat; fi; } \
    | sed -E 's/.*name="([^"]+)".*/\1/' | sort
}

comparer() {
  local a="$1" b="$2"
  local manquantes
  manquantes="$(comm -23 <(noms "$a" traduisibles) <(noms "$b"))"
  echo "$manquantes"
}

verdict=0
rapporter() {
  local titre="$1" liste="$2" explication="$3"
  if [[ -z "$liste" ]]; then
    printf "  \033[32m✓ %s\033[0m\n" "$titre"
  else
    printf "  \033[31m✗ %s\033[0m\n" "$titre"
    printf "    %s\n" "$explication"
    echo "$liste" | sed 's/^/      /'
    verdict=1
  fi
}

# ─── Le témoin sait-il rougir ? ───
#
# On ne vérifie pas le témoin en le relisant : on lui donne un catalogue amputé et on exige
# qu'il le dise. Sans cela, un `grep` dont l'expression ne correspond à rien rendrait deux
# listes vides, `comm` ne trouverait aucune différence, et le vert serait parfait.
if [[ -n "${VERIFIER_QUE_JE_ROUGIS:-}" ]]; then
  TEMP="$(mktemp -d)"
  trap 'rm -rf "$TEMP"' EXIT
  CIBLE="$(noms "$FR" traduisibles | head -1)"
  [[ -n "$CIBLE" ]] || { echo "  ✗ le catalogue français est vide : rien à amputer" >&2; exit 1; }
  grep -v "name=\"$CIBLE\"" "$EN" > "$TEMP/en.xml"
  echo "  Épreuve : « $CIBLE » retirée de values-en/."
  if [[ -n "$(comparer "$FR" "$TEMP/en.xml")" ]]; then
    printf "  \033[32m✓ le témoin rougit quand une clé manque\033[0m\n"
    exit 0
  fi
  printf "  \033[31m✗ le témoin est resté vert sur un catalogue amputé : il ne mesure rien\033[0m\n"
  exit 1
fi

rapporter "chaque chaîne française a sa jumelle anglaise" \
  "$(comparer "$FR" "$EN")" \
  "ces clés manquent de values-en/ : l'anglais affichera du français, sans erreur."

rapporter "aucune chaîne anglaise n'est orpheline" \
  "$(comm -23 <(noms "$EN") <(noms "$FR"))" \
  "ces clés n'existent pas dans values/ : traduction morte, ou faute de frappe dans un nom."

exit $verdict
