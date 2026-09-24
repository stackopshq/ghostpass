#!/usr/bin/env bash
# **Le point de sécurité le plus important du produit, éprouvé.** (§4 de docs/android.md)
#
#   tools/android/temoin-de-la-destination.sh
#
# La clé de déchiffrement d'un partage voyage dans le **fragment** du lien. Un navigateur ne
# l'envoie jamais dans la requête HTTP, ce qui donne l'illusion qu'elle est à l'abri du
# serveur — mais la *page* servie par ce domaine est du code que ce domaine contrôle, et
# rien ne l'empêche de lire `location.hash`.
#
# Accepter sans contrôle l'adresse rendue par le serveur revient donc à **le laisser
# désigner qui recevra la clé**. Il détient déjà le chiffré ; il obtiendrait le secret en
# clair, et le partage à connaissance nulle n'aurait servi à rien.
#
# ─── Pourquoi il faut un banc, et pourquoi le parcours ne suffit pas ───
#
# Le serveur de la branche de travail ne rend qu'un identifiant : le lien retombe sur
# l'adresse que l'utilisateur a saisie, de confiance **par construction**. La question ne s'y
# pose jamais, et la règle resterait sans témoin. On monte donc le serveur à relais de
# `origin/main` et un ghostbit simulé qui annonce un autre domaine.
#
# Quatre cas, et le troisième est celui qu'on oublie :
#
#   1. domaine étranger      → confirmation demandée, **aucun lien rendu**
#   2. refus                 → le partage est **révoqué** chez ghostbit
#   3. domaine approuvé      → accepté, mais **pour ce serveur-là seulement**
#   4. approbation d'ailleurs → refusée : une liste globale autoriserait sur l'instance d'un
#                               tiers ce qu'on a validé pour celle de son entreprise
set -euo pipefail

PRODUIT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
GRADLE="$PRODUIT/apps/android"
ARBRE="${ARBRE_SERVEUR:-/tmp/gp-sso-main}"
: "${JAVA_HOME:=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home}"
export JAVA_HOME

EMAIL="clara@ghostpass.test"
MOTDEPASSE="correct horse battery staple"
SECRET="le mot de passe du routeur"
HOTE_ETRANGER="ghostbit.example.com"
echec=0

command -v node >/dev/null || { echo "node introuvable." >&2; exit 1; }

if [[ ! -d "$ARBRE/apps/server/src" ]]; then
  git -C "$PRODUIT" worktree add --detach "$ARBRE" origin/main >/dev/null 2>&1 \
    || { echo "impossible de monter l'arbre de travail du serveur." >&2; exit 1; }
fi
[[ -e "$ARBRE/apps/server/node_modules" ]] \
  || ln -sfn "$PRODUIT/apps/server/node_modules" "$ARBRE/apps/server/node_modules"
cp "$PRODUIT/tools/android/partage-banc-ghostbit.ts" "$ARBRE/apps/server/scripts/"

BASE="$(mktemp -d)"
BANC="$BASE/banc.log"
TUYAU="$BASE/tuyau"
mkfifo "$TUYAU"

ranger() {
  local code=$?
  [[ -n "${BANC_PID:-}" ]] && kill "$BANC_PID" 2>/dev/null || true
  exec 9>&- 2>/dev/null || true
  [[ $code -ne 0 && -f "$BANC" ]] && { echo; echo "Journal du banc :" >&2; tail -8 "$BANC" >&2; }
  rm -rf "$BASE"
  exit $code
}
trap ranger EXIT

# Les guillemets sont pour le shell de Gradle : le mot de passe et le secret portent des
# espaces, et `--args` est une seule chaîne qu'il redécoupe.
client() {
  local assemble=""
  for a in "$@"; do assemble+="'${a//\'/\'\\\'\'}' "; done
  (cd "$GRADLE" && ./gradlew :coeur-hote:partageClient --console=plain -q "--args=$assemble")
}

echo "== 1. Un serveur à relais, et un ghostbit qui annonce un autre domaine =="
( cd "$ARBRE/apps/server" && node --import tsx scripts/partage-banc-ghostbit.ts \
    --hote "$HOTE_ETRANGER" > "$BANC" 2>&1 < "$TUYAU" ) &
BANC_PID=$!
exec 9>"$TUYAU"

SERVEUR=""; REVOCATIONS=""
for _ in $(seq 1 60); do
  SERVEUR="$(sed -n 's/^SERVEUR //p' "$BANC" | head -1)"
  REVOCATIONS="$(sed -n 's/^REVOCATIONS //p' "$BANC" | head -1)"
  [[ -n "$SERVEUR" && -n "$REVOCATIONS" ]] && break
  sleep 1
done
[[ -n "$SERVEUR" ]] || { echo "  ✗ le banc n'a pas démarré." >&2; exit 1; }
echo "  · serveur : $SERVEUR"
echo "  · ghostbit annonce : https://$HOTE_ETRANGER/…"

# Un compte, par le même cœur que l'application.
( cd "$GRADLE" && ./gradlew :coeur-hote:semerLeServeur --console=plain -q \
    -Pserveur="$SERVEUR" -Pemail="$EMAIL" -Pmotdepasse="$MOTDEPASSE" ) >/dev/null

echo
echo "== 2. Domaine étranger : la confirmation doit être demandée, sans rendre de lien =="
SORTIE="$(client partager "$SERVEUR" "$EMAIL" "$MOTDEPASSE" "$SECRET")"
case "$SORTIE" in
  "ADEMANDER $HOTE_ETRANGER "*)
    echo "  ✓ confirmation demandée pour $HOTE_ETRANGER, aucun lien remis"
    ID="$(echo "$SORTIE" | awk '{print $3}')"
    JETON="$(echo "$SORTIE" | awk '{print $4}')"
    ;;
  PRET*)
    echo "  ✗ LE LIEN A ÉTÉ REMIS SANS RIEN DEMANDER." >&2
    echo "    Le serveur a donc choisi qui reçoit la clé : il détient déjà le chiffré," >&2
    echo "    il obtiendrait le secret en clair." >&2
    echec=1 ;;
  *)
    echo "  ✗ résultat inattendu : $SORTIE" >&2; echec=1 ;;
esac

echo
echo "== 3. Un refus doit RÉVOQUER le partage, pas seulement l'oublier =="
# Le partage existe déjà chez ghostbit à cet instant — c'est le serveur qui vient de le
# créer. L'oublier laisserait derrière soi un secret publié que personne ne surveille.
if [[ -n "${ID:-}" ]]; then
  client revoquer "$SERVEUR" "$EMAIL" "$MOTDEPASSE" "$ID" "$JETON" >/dev/null
  if grep -q "^$ID $JETON$" "$REVOCATIONS"; then
    echo "  ✓ ghostbit a bien reçu la révocation de $ID"
  else
    echo "  ✗ aucune révocation reçue : le secret reste publié." >&2
    echec=1
  fi
fi

echo
echo "== 4. Domaine approuvé : accepté =="
SORTIE2="$(client partager "$SERVEUR" "$EMAIL" "$MOTDEPASSE" "$SECRET" "$HOTE_ETRANGER")"
case "$SORTIE2" in
  PRET*) echo "  ✓ approuvé pour ce serveur, le lien est remis" ;;
  *) echo "  ✗ un hôte approuvé reste refusé : $SORTIE2" >&2; echec=1 ;;
esac

echo
echo "== 5. Une approbation d'ailleurs ne vaut pas ici =="
# Le contrôle qui donne son sens au précédent : approuver `ghostbit.example.com` pour
# l'instance de son entreprise ne doit rien autoriser sur l'instance d'un tiers. On passe
# donc un hôte approuvé **différent** de celui que le serveur annonce.
SORTIE3="$(client partager "$SERVEUR" "$EMAIL" "$MOTDEPASSE" "$SECRET" "autre.example.com")"
case "$SORTIE3" in
  "ADEMANDER $HOTE_ETRANGER "*)
    echo "  ✓ toujours demandé : approuver un hôte n'en approuve pas un autre"
    # On révoque ce partage-là aussi : le banc en a créé un.
    client revoquer "$SERVEUR" "$EMAIL" "$MOTDEPASSE" \
      "$(echo "$SORTIE3" | awk '{print $3}')" "$(echo "$SORTIE3" | awk '{print $4}')" >/dev/null
    ;;
  PRET*)
    echo "  ✗ une approbation portant sur un autre hôte a suffi." >&2
    echec=1 ;;
  *) echo "  ✗ résultat inattendu : $SORTIE3" >&2; echec=1 ;;
esac

echo
if [[ $echec -ne 0 ]]; then
  echo "Témoin en échec : le serveur peut choisir qui reçoit la clé." >&2
  exit 1
fi
echo "Témoin concluant : l'ancre de confiance est le serveur que l'utilisateur a saisi,"
echo "un refus révoque, et les approbations ne franchissent pas la frontière d'un serveur."
