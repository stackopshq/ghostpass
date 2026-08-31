#!/usr/bin/env bash
# **La rotation de clé d'organisation, provoquée** — le seul chemin d'`exigerLaCleCourante`
# qu'aucun autre témoin ne déclenche.
#
#   tools/android/temoin-de-la-rotation.sh
#
# ─── Le défaut, et pourquoi il ne se voit pas ───
#
# Un administrateur retire un membre : l'Org Key tourne, les éléments sont ré-enveloppés
# vers la nouvelle. Une session ouverte **avant** la rotation détient encore l'ancienne. Si
# elle enregistre, elle scelle sous une génération retirée. Le serveur ne lit rien, donc il
# accepte. L'écran affiche « enregistré ». Et l'élément est illisible pour tous les membres
# — y compris son auteur, à sa prochaine ouverture.
#
# Aucune erreur nulle part. C'est la forme la plus coûteuse de défaut : celui qui rend le
# produit d'accord avec lui-même pendant qu'il perd des données.
#
# ─── Ce que les autres témoins ne couvrent pas ───
#
#   — `OrganisationsTest` montre la **conséquence** : un élément scellé sous une autre Org
#     Key ressort en `SceauRefuse`. Il ne touche jamais la garde ;
#   — le parcours de bout en bout traverse bien `exigerLaCleCourante`, mais avec une clé qui
#     n'a **pas** tourné : seule la branche « les clés concordent » y est éprouvée.
#
# Une `exigerLaCleCourante` vidée de son contenu laisse donc tous ces témoins verts. C'est
# le trou que ce script ferme, en faisant tourner la clé pour de vrai, par la route
# `POST /api/orgs/:id/rotate`, depuis une seconde session.
#
# ─── Et il doit savoir rougir ───
#
# Deux scénarios, aux issues opposées, sur le **même** chemin de code :
#
#   1. sans rotation → l'écriture doit RÉUSSIR
#   2. avec rotation → l'écriture doit être REFUSÉE
#
# Le premier n'est pas décoratif. Sans lui, une garde qui refuserait *toujours* — ou une
# écriture d'équipe qui ne marcherait jamais — rendrait ce témoin vert sans rien prouver.
# Un zéro d'accord et un zéro d'aveuglement se ressemblent ; deux issues opposées les
# séparent.
#
# Le cas 3 mesure la conséquence dans une session **neuve**, ce qui est le seul point de vue
# d'où le défaut se voit : la session qui a écrit détient encore l'ancienne clé et relirait
# très bien ce qu'elle vient de rendre illisible pour les autres.
set -euo pipefail

PRODUIT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
GRADLE="$PRODUIT/apps/android"
SERVEUR="$PRODUIT/apps/server"
: "${JAVA_HOME:=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home}"
export JAVA_HOME

EMAIL="clara@ghostpass.test"
MOTDEPASSE="correct horse battery staple"
echec=0

command -v node >/dev/null || { echo "node introuvable." >&2; exit 1; }
[[ -d "$SERVEUR/node_modules" ]] || { echo "apps/server : npm install d'abord." >&2; exit 1; }

# ─── Un port libre, choisi par le système ───
#
# **Jamais un port fixe.** Le 3111 sert à la suite iOS et à la CI ; un témoin qui le prend
# abat une suite qu'il n'a pas lancée. On laisse le noyau en attribuer un, ce qui rend la
# collision impossible par construction plutôt que par convention.
PORT="$(python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1]);s.close()')"
BASE="$(mktemp -d)"
DB="$BASE/rotation.db"
JOURNAL="$BASE/serveur.log"
ADRESSE="http://127.0.0.1:$PORT"

ranger() {
  local code=$?
  # On ne tue que ce qu'on a lancé soi-même, et par son PID — jamais par le port.
  [[ -n "${SERVEUR_PID:-}" ]] && kill "$SERVEUR_PID" 2>/dev/null || true
  [[ $code -ne 0 && -f "$JOURNAL" ]] && { echo; echo "Journal du serveur :" >&2; tail -12 "$JOURNAL" >&2; }
  rm -rf "$BASE"
  exit $code
}
trap ranger EXIT

# `--args` est une seule chaîne que Gradle redécoupe aux espaces : le mot de passe en porte.
client() {
  local assemble=""
  for a in "$@"; do assemble+="'${a//\'/\'\\\'\'}' "; done
  (cd "$GRADLE" && ./gradlew :coeur-hote:rotationClient --console=plain -q "--args=$assemble")
}

echo "== 0. Un serveur neuf, sur un port que le système attribue =="
( cd "$SERVEUR" && PORT="$PORT" DB_PATH="$DB" LOG_LEVEL=warn npm start >"$JOURNAL" 2>&1 ) &
SERVEUR_PID=$!
for _ in $(seq 1 60); do
  curl -s -o /dev/null "$ADRESSE/api/auth/prelogin" -X POST \
    -H 'content-type: application/json' -d '{"email":"x@y.z"}' && break
  sleep 0.5
done
curl -s -o /dev/null -X POST "$ADRESSE/api/auth/prelogin" \
  -H 'content-type: application/json' -d '{"email":"x@y.z"}' \
  || { echo "  ✗ le serveur n'a pas démarré." >&2; exit 1; }
echo "  · serveur sur $ADRESSE (port attribué, pas choisi)"

( cd "$GRADLE" && ./gradlew :coeur-hote:semerLeServeur --console=plain -q \
    -Pserveur="$ADRESSE" -Pemail="$EMAIL" -Pmotdepasse="$MOTDEPASSE" ) >/dev/null \
  || { echo "  ✗ le semis a échoué." >&2; exit 1; }
echo "  · compte, organisation et collection semés"

# ─── 1. Le contrôle du contrôle ───
#
# Sans rotation, l'écriture d'équipe doit passer. Si elle ne passait pas, le cas 2 serait
# vert pour une raison qui n'a rien à voir avec la garde, et ce script ne mesurerait rien.
echo
echo "== 1. Sans rotation, l'écriture d'équipe réussit =="
if RETOUR="$(client eprouver sans-rotation "$ADRESSE" "$EMAIL" "$MOTDEPASSE" 2>"$BASE/err1")"; then
  case "$RETOUR" in
    ECRIT*) echo "  ✓ $RETOUR" ;;
    REFUSE*)
      echo "  ✗ l'écriture a été refusée alors que la clé n'a pas tourné." >&2
      echo "    La garde refuse toujours : le cas 2 serait vert sans rien prouver." >&2
      echec=1 ;;
    *) echo "  ✗ sortie inattendue : $RETOUR" >&2; echec=1 ;;
  esac
else
  echo "  ✗ le client a échoué :" >&2; tail -5 "$BASE/err1" >&2; echec=1
fi

# ─── 2. Le cas qui n'avait aucun témoin ───
echo
echo "== 2. La clé tourne pendant la session : l'écriture est refusée =="
if RETOUR="$(client eprouver avec-rotation "$ADRESSE" "$EMAIL" "$MOTDEPASSE" 2>"$BASE/err2")"; then
  case "$RETOUR" in
    REFUSE*) echo "  ✓ $RETOUR" ;;
    ECRIT*)
      echo "  ✗ l'écriture a été ACCEPTÉE après une rotation d'Org Key." >&2
      echo "    L'élément vient d'être scellé sous une clé retirée : le serveur l'a pris," >&2
      echo "    l'écran dirait « enregistré », et personne ne pourra plus l'ouvrir." >&2
      echo "    C'est exactement ce qu'\`exigerLaCleCourante\` doit empêcher." >&2
      echec=1 ;;
    *) echo "  ✗ sortie inattendue : $RETOUR" >&2; echec=1 ;;
  esac
else
  echo "  ✗ le client a échoué :" >&2; tail -5 "$BASE/err2" >&2; echec=1
fi

# ─── 3. Rien n'a été écrit, vu d'une session neuve ───
#
# « Refusé » et « refusé mais écrit quand même » se ressemblent depuis la session qui a
# tenté. On rouvre donc tout, avec la clé courante, et l'on compte.
echo
echo "== 3. Vu d'une session neuve, la collection est intacte =="
if RETOUR="$(client relire "$ADRESSE" "$EMAIL" "$MOTDEPASSE" 2>"$BASE/err3")"; then
  LISIBLES="$(echo "$RETOUR" | awk '{print $2}')"
  ILLISIBLES="$(echo "$RETOUR" | awk '{print $4}')"
  # Le semis dépose deux éléments : le routeur, lisible, et un élément scellé sous une
  # **autre** Org Key, illisible par construction (règle §5). Le cas 1 en a ajouté un
  # lisible, ré-enveloppé par la rotation. Le cas 2 ne doit avoir rien ajouté.
  echo "  · $LISIBLES lisible(s), $ILLISIBLES illisible(s)"
  if [[ "$LISIBLES" == "2" && "$ILLISIBLES" == "1" ]]; then
    echo "  ✓ les deux éléments lisibles ont survécu à la rotation, et rien ne s'est ajouté"
  else
    echo "  ✗ attendu 2 lisibles et 1 illisible." >&2
    echo "    Un illisible de plus signifie que l'écriture du cas 2 est passée malgré le" >&2
    echo "    refus annoncé ; un lisible de moins, que la rotation a perdu un élément." >&2
    echec=1
  fi
else
  echo "  ✗ la relecture a échoué :" >&2; tail -5 "$BASE/err3" >&2; echec=1
fi

echo
if (( echec )); then
  echo "Témoin en échec : la garde de rotation ne tient pas." >&2
  exit 1
fi
echo "La clé d'organisation a tourné sous une session ouverte, et l'écriture a été refusée —"
echo "sans que le chemin nominal cesse d'écrire."
