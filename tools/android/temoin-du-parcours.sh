#!/usr/bin/env bash
# Prouve que `parcours-de-bout-en-bout.sh` sait rougir, et pour les bonnes raisons.
#
# Un parcours de six étapes qui passe est rassurant ; il ne prouve rien tant qu'on n'a pas
# vu ce qui le fait tomber. Deux perturbations, choisies pour être celles qui rendraient le
# parcours **vide de sens** sans le faire échouer :
#
#   1. **un mot de passe maître faux.** Si le parcours restait vert, c'est qu'il ne lit pas
#      vraiment le coffre — qu'il se contente de retrouver des libellés d'interface ;
#   2. **le service de remplissage remis à celui du système.** Si le parcours restait vert,
#      c'est que sa dernière étape — la fonction principale du produit — ne mesure rien.
#
# Chaque perturbation nomme l'étape qui doit tomber. Une perturbation qui laisse le parcours
# vert signale une étape qui ne regarde pas ce qu'elle prétend regarder.
set -euo pipefail

PRODUIT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PARCOURS="$PRODUIT/tools/android/parcours-de-bout-en-bout.sh"
: "${JAVA_HOME:=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home}"
export JAVA_HOME

echec=0

echo "0. Au départ, le parcours doit être vert."
if "$PARCOURS" >/tmp/temoin-parcours-0.log 2>&1; then
  echo "  ✓ vert"
else
  echo "  ✗ déjà rouge sans perturbation — corrigez cela d'abord." >&2
  sed -n '/Error in/,/^$/p' /tmp/temoin-parcours-0.log | head -8 >&2 || true
  exit 1
fi

echo
echo "1. Un mot de passe maître faux — le coffre ne doit pas s'ouvrir."
# Le compte est semé avec un mot de passe ; l'application en reçoit un autre. Rien d'autre
# ne change : même serveur, même compte, même appareil.
if MOTDEPASSE_SAISI="mauvais mot de passe maitre" "$PARCOURS" \
    >/tmp/temoin-parcours-1.log 2>&1; then
  echo "  ✗ le parcours reste VERT avec un mot de passe faux."
  echo "    Il ne lit donc pas le coffre : il reconnaît des libellés d'interface."
  echec=1
else
  echo "  ✓ le parcours tombe, comme il le doit"
  echo "    Ce qu'il rapporte :"
  sed -n '/Error in/,/^$/p' /tmp/temoin-parcours-1.log \
    | grep -m1 "AssertionError" | sed 's/^/      /' || true
fi

echo
echo "2. Le service de remplissage rendu au système — la dernière étape doit tomber."
# `SANS_REMPLISSAGE` fait sauter le réglage du service ; tout le reste est identique. Les
# cinq premières étapes doivent passer, et la sixième échouer : c'est ce qui montre que la
# sixième mesure quelque chose de propre.
if SANS_REMPLISSAGE=1 "$PARCOURS" >/tmp/temoin-parcours-2.log 2>&1; then
  echo "  ✗ le parcours reste VERT sans que GhostPass soit le service de remplissage."
  echo "    Sa dernière étape ne mesure donc pas la fonction principale du produit."
  echec=1
else
  echo "  ✓ le parcours tombe, comme il le doit"
  ligne="$(sed -n '/Error in/,/^$/p' /tmp/temoin-parcours-2.log | grep -m1 "AssertionError" || true)"
  echo "    Ce qu'il rapporte :"
  echo "      ${ligne}"
  # Et il doit tomber **à la bonne étape**. Un parcours qui échouerait dès la connexion
  # prouverait seulement qu'on a cassé l'environnement.
  # On reconnaît l'étape par son **nom**, pas par son numéro.
  #
  # Le numéro a dérivé le jour où une étape a été insérée avant celle-ci (le lien `otpauth`
  # arrivant coffre fermé), et ce contrôle a échoué en annonçant que la perturbation avait
  # « cassé autre chose ». Elle n'avait rien cassé : c'est le contrôleur qui lisait un
  # numéro périmé. Un identifiant qui bouge à chaque insertion n'est pas un identifiant.
  if echo "$ligne" | grep -q "Le remplissage automatique"; then
    echo "    ✓ et il tombe bien à l'étape du remplissage, pas avant"
  else
    echo "    ✗ mais il tombe ailleurs qu'à l'étape du remplissage : la perturbation a" >&2
    echo "      cassé autre chose, et ce témoin ne prouve pas ce qu'il annonce." >&2
    echec=1
  fi
fi

echo
if [[ $echec -ne 0 ]]; then
  echo "Témoin en échec : le parcours ne mesure pas tout ce qu'il annonce." >&2
  exit 1
fi
echo "Témoin concluant : le parcours tombe sur un coffre qu'on n'ouvre pas, et sur un"
echo "remplissage qui n'est pas le nôtre."
