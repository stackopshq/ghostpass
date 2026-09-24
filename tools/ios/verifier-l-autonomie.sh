#!/usr/bin/env bash
# Vérifie que l'application livrée ne vend rien et ne dépend de personne.
#
# GhostPass et GhostCal sont **gratuits**. Ce qui se paie, chez ceux qui ne veulent pas
# auto-héberger, est la mise à disposition d'une VM — pas le logiciel. C'est une
# qualification juridique, et le relecteur d'Apple ne juge pas sur la qualification : il
# juge sur ce que **contient l'application**. Trois choses décident, et ce script en mesure
# deux ; la troisième est mesurée ailleurs (voir plus bas).
#
#   ./tools/ios/verifier-l-autonomie.sh [chemin/vers/Ghostpass.app]
#
# ─── Pourquoi on scanne le binaire et pas les sources ───
#
# `apps/ios/AppStore/fiche.md` parle légitimement de tarif, `docs/adr/` d'abonnement, et
# ce fichier-ci écrit les mots qu'il interdit. Un grep sur le dépôt exigerait une liste
# d'exclusions qui pourrit — et c'est exactement ainsi qu'un garde-fou de la suite a
# expédié en production la classe CSS qu'il interdisait : il a scanné son propre texte.
#
# Le relecteur ne lit pas le dépôt. Il lit le paquet. C'est donc le paquet qu'on mesure,
# ce qui rend le contrôle insensible au formatage, à la langue, et à ses propres commentaires.
#
# ─── Ce que ce script ne prouve pas ───
#
# L'absence de vitrine n'est pas l'autonomie. Ce qui prouve qu'on fonctionne sans StackOps,
# c'est un parcours de premier lancement qui aboutit à un coffre utilisable contre une
# instance quelconque : c'est `test01ParcoursComplet`, qui crée un compte, dépose et relit
# un secret contre `127.0.0.1:3111`. Si ce test disparaît, ce script reste vert et ne veut
# plus rien dire.
#
# Et il ne dit rien de l'état des directives d'Apple, qui ont bougé plusieurs fois. Elles
# sont à relire sur le texte en vigueur avant chaque soumission ; celles de Google sont
# voisines, pas identiques.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
APP="${1:-}"
if [[ -z "$APP" ]]; then
  # Le dossier de construction contient aussi le porteur des tests d'interface, qui
  # embarque XCTest — dont un symbole s'appelle `upgradeCapability:`. Examiner ce
  # paquet-là ferait rougir le contrôle sur du code d'Apple qui ne part jamais.
  APP="$(find "$ROOT/apps/ios/.build/Build/Products" -maxdepth 2 -name '*.app' \
    ! -name '*Tests*' ! -name '*-Runner.app' 2>/dev/null | head -1)"
fi
if [[ -z "$APP" || ! -d "$APP" ]]; then
  echo "Aucun paquet .app à examiner. Construisez d'abord, ou passez le chemin en argument." >&2
  exit 2
fi

# Les mots d'une vitrine, dans les deux langues livrées. « premium » et « upgrade » y
# figurent parce qu'ils annoncent un palier payant sans jamais écrire « abonnement ».
VOCABULAIRE='abonnement|subscription|s.abonner|abonnez|tarif|pricing|forfait|essai gratuit|free trial|premium|upgrade|passer .+ la version|acheter|purchase|checkout|in-app'
# Un prix affiché. Le symbole seul est trop fréquent dans un binaire : on exige un chiffre.
#
# Ce contrôle-ci est **sensible à la casse**, et ses codes sont bornés par des limites de
# mot : un montant s'écrit « CHF 9.90 ». Sans cela, le nom Swift décoré de `erreur33`
# contient « eur3 » et fait rougir toute l'application — mesuré, pas supposé.
PRIX='\b(CHF|EUR|USD)\b[[:space:]]*[0-9]|[0-9][[:space:]]*\b(CHF|EUR|USD)\b|[€£][0-9]|\$[0-9]+[.,][0-9]{2}'
# Une dépendance à l'infrastructure de l'éditeur. L'application doit marcher contre
# n'importe quelle instance ; un point de terminaison en dur dirait le contraire.
EDITEUR='stackops\.ch'

# Les bundles de tests ne sont jamais soumis, et portent légitimement des jeux d'essai qui
# nomment l'éditeur. Les inclure ferait rougir un contrôle sur du code qui ne part pas.
#
# ─── Les frameworks de test d'Apple, mesuré le 25 septembre 2026 ───
#
# Le paquet examiné est un build **Debug pour simulateur** : Xcode y injecte ses propres
# frameworks de test, absents de toute archive de diffusion. `XCTestSupport` contient le
# sélecteur `upgradeCapability:toVersion:`, où le motif de vitrine lit « upgrade ». Le
# contrôle rougissait donc sur du code d'Apple, et son message — « l'application soumise
# contiendrait de quoi la faire relire au titre des achats intégrés » — accusait un paquet
# qui ne contient rien de tel.
#
# Vérifié plutôt que supposé : l'archive Release et l'IPA envoyé à Apple ne portent
# **aucun** framework de test. C'est donc le paquet examiné qui diffère de celui qui part,
# pas le produit qui est en faute.
#
# C'est le même piège que sur Android, où le vocabulaire du commerce recoupe celui des
# bibliothèques de plateforme — `SubscriptionCountStateFlow`, `isPremiumVibratorEnabled`.
# Le script Android l'avait appris et écrit ; celui-ci ne l'avait pas.
lister_les_fichiers_livres() {
  find "$APP" -type f \
    ! -name '*.png' ! -name '*.jpg' \
    ! -path '*/_CodeSignature/*' \
    ! -path '*.xctest/*' \
    ! -path '*/Frameworks/XCTest*' \
    ! -path '*/Frameworks/libXCTest*' \
    ! -path '*/Frameworks/Testing.framework/*' \
    -print0
}

fautes=0
controler() {
  local nom="$1" motif="$2" casse="${3:-insensible}" trouve=""
  local drapeaux='-nE'
  [[ "$casse" == insensible ]] && drapeaux='-inE'
  while IFS= read -r -d '' fichier; do
    local lignes
    lignes="$(strings -a "$fichier" 2>/dev/null | grep $drapeaux "$motif" | head -5 || true)"
    if [[ -n "$lignes" ]]; then
      trouve+=$'\n'"  ${fichier#"$APP"/} :"$'\n'"$(echo "$lignes" | sed 's/^/    /')"
    fi
  done < <(lister_les_fichiers_livres)

  if [[ -n "$trouve" ]]; then
    printf '\033[31m✗ %s\033[0m%s\n\n' "$nom" "$trouve"
    fautes=$((fautes + 1))
  else
    printf '\033[32m✓ %s\033[0m\n' "$nom"
  fi
}

echo "Paquet examiné : ${APP#"$ROOT"/}"
echo
controler "aucune vitrine : ni abonnement, ni palier, ni achat" "$VOCABULAIRE"
controler "aucun prix affiché" "$PRIX" sensible
controler "aucun point de terminaison de l'éditeur en dur" "$EDITEUR"
echo
echo "Rappel : l'autonomie réelle est prouvée par test01ParcoursComplet, qui monte un"
echo "coffre complet contre 127.0.0.1:3111. Ce script ne mesure que l'absence de vitrine."

if (( fautes > 0 )); then
  echo
  echo "L'application soumise contiendrait de quoi la faire relire au titre des achats"
  echo "intégrés. Retirez ces chaînes du paquet, ou assumez la soumission en le sachant."
  exit 1
fi
