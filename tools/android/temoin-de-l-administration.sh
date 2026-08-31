#!/usr/bin/env bash
# **Inviter un membre, et lui accorder une permission** — contre un vrai serveur, avec deux
# comptes qui existent pour de bon.
#
#   tools/android/temoin-de-l-administration.sh
#
# ─── Ce que « 201 Created » ne prouve pas ───
#
# Le serveur ne scelle rien et ne vérifie rien : il range un blob opaque et un rôle. Il
# répond donc `201` avec le même entrain à une Org Key correctement scellée qu'à des octets
# scellés vers la mauvaise clé publique. Compter les invitations réussies mesurerait la
# politesse du serveur, pas la nôtre.
#
# La preuve est de l'autre côté : **l'invité ouvre l'organisation avec sa propre clé privée
# et lit ce que l'équipe y a mis**. C'est pourquoi ce témoin tient deux comptes plutôt qu'un.
#
# ─── Et pour la permission, deux issues opposées ───
#
#   4. invité en lecture seule → l'écriture est REFUSÉE (403)
#   6. après l'octroi d'écriture par groupe → l'écriture RÉUSSIT
#
# Un seul des deux ne prouverait rien : « refusé » tout le temps est aussi vert que « refusé
# au bon moment », et un compte à zéro d'écritures refusées peut vouloir dire « la
# permission marche » comme « on n'a jamais essayé d'écrire ».
set -euo pipefail

PRODUIT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
GRADLE="$PRODUIT/apps/android"
SERVEUR="$PRODUIT/apps/server"
: "${JAVA_HOME:=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home}"
export JAVA_HOME

ADMIN="clara@ghostpass.test"
MDP_ADMIN="correct horse battery staple"
INVITE="kevin.invite@ghostpass.test"
MDP_INVITE="une autre phrase de passe entiere"
echec=0

[[ -d "$SERVEUR/node_modules" ]] || { echo "apps/server : npm install d'abord." >&2; exit 1; }

# Un port libre attribué par le noyau : le 3111 sert à la suite iOS et à la CI.
PORT="$(python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1]);s.close()')"
BASE="$(mktemp -d)"
JOURNAL="$BASE/serveur.log"
ADRESSE="http://127.0.0.1:$PORT"

ranger() {
  local code=$?
  # On ne tue que le processus qu'on a lancé, par son PID. Jamais par le port.
  [[ -n "${SERVEUR_PID:-}" ]] && kill "$SERVEUR_PID" 2>/dev/null || true
  [[ $code -ne 0 && -f "$JOURNAL" ]] && { echo; echo "Journal du serveur :" >&2; tail -12 "$JOURNAL" >&2; }
  rm -rf "$BASE"
  exit $code
}
trap ranger EXIT

client() {
  local assemble=""
  for a in "$@"; do assemble+="'${a//\'/\'\\\'\'}' "; done
  (cd "$GRADLE" && ./gradlew :coeur-hote:administrationClient --console=plain -q "--args=$assemble")
}

verifier() { # <attendu-motif> <obtenu> <explication>
  if [[ "$2" == $1 ]]; then echo "  ✓ $2"; else
    echo "  ✗ attendu « $1 », obtenu « $2 »" >&2; echo "    $3" >&2; echec=1; fi
}

echo "== 0. Un serveur neuf, et deux comptes =="
( cd "$SERVEUR" && PORT="$PORT" DB_PATH="$BASE/admin.db" LOG_LEVEL=warn npm start >"$JOURNAL" 2>&1 ) &
SERVEUR_PID=$!
for _ in $(seq 1 60); do
  curl -s -o /dev/null "$ADRESSE/api/auth/prelogin" -X POST \
    -H 'content-type: application/json' -d '{"email":"x@y.z"}' && break
  sleep 0.5
done
( cd "$GRADLE" && ./gradlew :coeur-hote:semerLeServeur --console=plain -q \
    -Pserveur="$ADRESSE" -Pemail="$ADMIN" -Pmotdepasse="$MDP_ADMIN" ) >/dev/null \
  || { echo "  ✗ le semis a échoué." >&2; exit 1; }
client inscrire "$ADRESSE" "$INVITE" "$MDP_INVITE" >/dev/null
echo "  · $ADMIN (admin, avec une organisation) et $INVITE"

# ─── 1. Un email sans compte ne s'invite pas ───
#
# Le serveur rend 404. Le traduire en « invitation posée » créerait une équipe où l'on
# croit avoir invité quelqu'un qui n'y est pas.
echo
echo "== 1. Un email inconnu est rapporté comme tel, pas avalé =="
RETOUR="$(client inviter "$ADRESSE" "$ADMIN" "$MDP_ADMIN" "personne@nulle.part" member 2>/dev/null)"
verifier "INCONNU*" "$RETOUR" "un email sans compte doit être distingué d'une invitation posée"

# ─── 2. L'invitation ───
echo
echo "== 2. L'administrateur invite, en lecture seule =="
RETOUR="$(client inviter "$ADRESSE" "$ADMIN" "$MDP_ADMIN" "$INVITE" readonly 2>"$BASE/e2")"
verifier "INVITE*" "$RETOUR" "l'invitation n'a pas été posée"
echo "  · clé publique annoncée par le serveur, telle qu'un écran devrait la montrer :"
sed -n 's/^clé publique annoncée[^:]*: /    /p' "$BASE/e2" | cut -c1-64

# ─── 3. La seule preuve qui compte ───
#
# L'invité ouvre l'organisation avec SA clé privée. Si l'Org Key avait été scellée vers une
# autre clé publique, le cœur refuserait — il vérifie la provenance — et rien ne serait
# lisible. Le semis dépose deux éléments : un lisible, un scellé sous une autre Org Key.
echo
echo "== 3. L'invité accepte, ouvre l'organisation et LIT =="
client accepter "$ADRESSE" "$INVITE" "$MDP_INVITE" >/dev/null 2>&1 \
  || { echo "  ✗ l'invité n'a pas pu accepter." >&2; echec=1; }
if RETOUR="$(client lire "$ADRESSE" "$INVITE" "$MDP_INVITE" 2>"$BASE/e3")"; then
  verifier "LISIBLES 1 ILLISIBLES 1 PERMISSION Lecture" "$RETOUR" \
    "l'Org Key n'a pas été scellée vers la vraie clé publique de l'invité, ou la permission n'est pas celle du rôle"
else
  echo "  ✗ l'invité ne peut pas ouvrir l'organisation :" >&2; tail -4 "$BASE/e3" >&2; echec=1
fi

# ─── 4. Lecture seule veut dire seule ───
echo
echo "== 4. En lecture seule, l'écriture d'équipe est refusée =="
RETOUR="$(client ecrire "$ADRESSE" "$INVITE" "$MDP_INVITE" 2>/dev/null || true)"
verifier "REFUSE 403" "$RETOUR" \
  "un membre en lecture seule a pu écrire : la permission ne protège rien"

# ─── 5. L'octroi ───
echo
echo "== 5. L'administrateur accorde l'écriture, par un groupe =="
RETOUR="$(client accorder "$ADRESSE" "$ADMIN" "$MDP_ADMIN" "$INVITE" write 2>"$BASE/e5")"
verifier "ACCORDE*" "$RETOUR" "l'octroi n'a pas abouti"

# ─── 6. La même action, l'issue opposée ───
echo
echo "== 6. La même écriture, désormais acceptée =="
if RETOUR="$(client ecrire "$ADRESSE" "$INVITE" "$MDP_INVITE" 2>"$BASE/e6")"; then
  verifier "ECRIT*" "$RETOUR" \
    "l'octroi n'a rien changé : soit il n'est pas appliqué, soit l'étape 4 refusait pour une autre raison"
else
  echo "  ✗ le client a échoué :" >&2; tail -4 "$BASE/e6" >&2; echec=1
fi

# ─── 7. Et la permission effective a suivi ───
echo
echo "== 7. La permission effective rendue par le serveur a changé =="
RETOUR="$(client lire "$ADRESSE" "$INVITE" "$MDP_INVITE" 2>/dev/null)"
verifier "LISIBLES 2 ILLISIBLES 1 PERMISSION Ecriture" "$RETOUR" \
  "la permission effective n'a pas suivi l'octroi, ou l'élément écrit à l'étape 6 n'est pas relisible"

echo
if (( echec )); then
  echo "Témoin en échec : l'administration d'organisation ne tient pas ses promesses." >&2
  exit 1
fi
echo "Un membre a été invité, a ouvert l'organisation avec sa propre clé, s'est vu refuser"
echo "l'écriture, puis l'a obtenue par un octroi — et la même action a changé d'issue."
