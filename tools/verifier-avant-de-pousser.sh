#!/usr/bin/env bash
# Rejoue localement les contrôles rapides de la CI, pour ne pas les découvrir sur la forge.
#
#   ./tools/verifier-avant-de-pousser.sh
#
# Né d'un aller-retour perdu le 2026-08-31 : la tâche iOS est tombée sur six erreurs de
# `swift-format`, pas sur un test. Le formateur était installé, la commande tenait en une
# ligne, et **rien ne me la rappelait**. Un contrôle qu'on ne peut lancer qu'à distance est
# un contrôle qu'on découvre trop tard.
#
# ─── Ce que ce script N'EST PAS ───
#
# Ce n'est pas la CI, et il ne faut pas le lire comme telle. Il ne lance ni les tests
# d'interface iOS (une vingtaine de minutes, un simulateur), ni les tests sur émulateur
# Android, ni le parcours de bout en bout, ni les témoins d'outillage. Il attrape ce qui
# est **rapide et bête** — précisément la catégorie qui ne mérite pas un aller-retour.
#
# Vert ici ne veut donc pas dire vert là-bas. Rouge ici veut dire rouge là-bas.
set -uo pipefail

# Cargo et rustup vivent souvent hors du chemin d'un script non interactif.
[[ -d "$HOME/.cargo/bin" ]] && PATH="$HOME/.cargo/bin:$PATH" && export PATH

RACINE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$RACINE"
fautes=0

titre() { printf "\n\033[1m▸ %s\033[0m\n" "$*"; }
verdict() {
  if [[ $1 -eq 0 ]]; then printf "  \033[32m✓ %s\033[0m\n" "$2"
  else printf "  \033[31m✗ %s\033[0m\n" "$2"; fautes=$((fautes + 1)); fi
}

titre "Formatage Swift"
if outil="$(xcrun --find swift-format 2>/dev/null)" && [[ -n "$outil" ]]; then
  sortie="$("$outil" lint --strict -r --configuration apps/ios/.swift-format \
    apps/ios/Ghostpass apps/ios/GhostpassAutoFill apps/ios/UITests apps/ios/Tests 2>&1)"
  if [[ -n "$sortie" ]]; then
    echo "$sortie" | head -12
    echo "  Réparable d'une commande :"
    echo "    \"$outil\" format --in-place -r --configuration apps/ios/.swift-format apps/ios/Ghostpass apps/ios/GhostpassAutoFill apps/ios/UITests apps/ios/Tests"
    verdict 1 "swift-format lint"
  else
    verdict 0 "swift-format lint"
  fi
else
  # Sans Xcode, on ne peut pas le dire — et « pas pu regarder » n'est pas « conforme ».
  printf "  \033[33m? swift-format introuvable — contrôle non effectué\033[0m\n"
fi

titre "Cœur commun (le dépôt voisin)"
SUITE="${GHOSTSUITE:-$RACINE/../suite}"
# **Trois états, jamais deux.** Un outil absent n'est pas un test qui échoue : le dire
# ainsi enverrait chercher un défaut dans le cœur là où il manque `cargo` au chemin.
# Constaté au premier lancement de ce script, sur lui-même.
if ! command -v cargo >/dev/null; then
  printf "  \033[33m? cargo introuvable — contrôle non effectué\033[0m\n"
elif [[ -d "$SUITE/crates" ]]; then
  (cd "$SUITE" && cargo test --quiet --workspace >/dev/null 2>&1)
  verdict $? "tests du cœur"
else
  printf "  \033[33m? cœur commun introuvable sous %s — contrôle non effectué\033[0m\n" "$SUITE"
fi

titre "Android, sur la JVM du poste"
if [[ -x "$RACINE/apps/android/gradlew" ]]; then
  # Le JDK le plus récent casse `jlink` d'AGP, et un poste peut porter les deux.
  JH="${JAVA_HOME:-}"
  [[ -x "${JH:-/nulle/part}/bin/javac" ]] || JH="$(/usr/libexec/java_home -v 21 2>/dev/null || echo /opt/homebrew/opt/openjdk@21)"
  if [[ -x "$JH/bin/javac" ]]; then
    (cd apps/android && JAVA_HOME="$JH" ./gradlew --no-daemon --quiet :coeur-hote:test >/dev/null 2>&1)
    verdict $? "tests Android (JDK $("$JH/bin/javac" -version 2>&1 | sed 's/javac //;s/\..*//'))"
  else
    printf "  \033[33m? JDK 21 introuvable — contrôle non effectué\033[0m\n"
  fi
fi

titre "Le contrat vendoré est-il à jour ?"
if [[ -f "$SUITE/assets/vecteurs/contrat.json" ]]; then
  # Une copie vendorée **et fausse** est la pire des deux situations : les tests passent,
  # et ils mesurent autre chose que ce que mesurent les autres clients.
  cmp -s assets/vecteurs/contrat.json "$SUITE/assets/vecteurs/contrat.json"
  verdict $? "identique au canonique"
fi

if (( fautes > 0 )); then
  printf "\n\033[31m%d contrôle(s) en échec.\033[0m La CI dira la même chose, en vingt minutes de plus.\n" "$fautes"
  exit 1
fi
printf "\n\033[32mLes contrôles rapides passent.\033[0m Les longs — interface, émulateur, parcours — restent à la CI.\n"
