#!/usr/bin/env bash
# Le SSO mobile, éprouvé **contre le vrai serveur** et pas contre sa description.
#
#   tools/android/temoin-du-sso-mobile.sh
#
# ─── Ce que ce témoin mesure, et pourquoi il faut un serveur ───
#
# Les tests de `SsoMobileTest` couvrent ce que le client décide seul : le calcul PKCE et la
# lecture du retour. Ils ne peuvent rien dire de trois écarts qui ne produisent aucune
# erreur de compilation et se manifestent seulement au contact :
#
#   — le défi calculé ici est-il celui que le `start` accepte (43 caractères base64url) ;
#   — le `redirect_uri` est-il dans la liste blanche du serveur ;
#   — le corps de l'échange porte-t-il les noms que le serveur attend (`code`,
#     `codeVerifier`) — un `code_verifier` en serpent passerait la compilation et rendrait
#     « requête invalide ».
#
# Le client exécuté ici est **celui de l'application** : `SsoMobile` et `Coffre`, dans
# `:noyau`, appelés par `SsoDeBoutEnBout`. Rien n'est réécrit pour le banc.
#
# ─── Où vivent les routes ───
#
# Le SSO mobile est sur `origin/main` du serveur ; la branche de travail de l'application en
# est loin. On monte donc un **arbre de travail** de `main` pour le seul serveur, plutôt que
# de fusionner cent commits pour lancer un banc d'essai. Le client, lui, reste celui de la
# branche de travail — ce qui est exactement le couple à éprouver.
set -euo pipefail

PRODUIT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
GRADLE="$PRODUIT/apps/android"
ARBRE="${ARBRE_SERVEUR:-/tmp/gp-sso-main}"
: "${JAVA_HOME:=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home}"
export JAVA_HOME

EMAIL="${EMAIL_DESSAI:-clara@ghostpass.test}"
echec=0

command -v node >/dev/null || { echo "node introuvable." >&2; exit 1; }

# ─── L'arbre de travail du serveur ───
if [[ ! -d "$ARBRE/apps/server/src" ]]; then
  echo "== 0. Arbre de travail du serveur (origin/main) =="
  git -C "$PRODUIT" worktree add --detach "$ARBRE" origin/main >/dev/null 2>&1 \
    || { echo "  ✗ impossible de monter l'arbre de travail." >&2; exit 1; }
  echo "  · $ARBRE"
fi
# Les dépendances sont celles de la branche de travail : le serveur de `main` n'introduit
# aucune dépendance nouvelle, et réinstaller cent mégaoctets pour un banc serait absurde.
[[ -e "$ARBRE/apps/server/node_modules" ]] \
  || ln -sfn "$PRODUIT/apps/server/node_modules" "$ARBRE/apps/server/node_modules"
if [[ ! -d "$PRODUIT/apps/server/node_modules" ]]; then
  echo "  ✗ apps/server : npm install d'abord." >&2; exit 1
fi
cp "$PRODUIT/tools/android/sso-banc-idp.ts" "$ARBRE/apps/server/scripts/"

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

client() { (cd "$GRADLE" && ./gradlew :coeur-hote:ssoClient --console=plain -q "--args=$*"); }

echo
echo "== 1. Le client tire son PKCE =="
# Le vérificateur ne quitte jamais le client : le banc ne reçoit que le défi.
mapfile -t PKCE < <(client pkce)
VERIFICATEUR="${PKCE[0]}"; DEFI="${PKCE[1]}"; ETAT="${PKCE[2]}"
echo "  · défi de ${#DEFI} caractères, état de ${#ETAT}"
if [[ ${#DEFI} -ne 43 ]]; then
  echo "  ✗ le serveur exige 43 caractères base64url et refusera au start." >&2
  exit 1
fi

echo
echo "== 2. Le banc mène le flux jusqu'au retour =="
( cd "$ARBRE/apps/server" && EMAIL_DESSAI="$EMAIL" \
    node --import tsx scripts/sso-banc-idp.ts --challenge "$DEFI" --state "$ETAT" \
    > "$BANC" 2>&1 < "$TUYAU" ) &
BANC_PID=$!
# On garde le tuyau ouvert de notre côté : sa fermeture arrête le banc.
exec 9>"$TUYAU"

SERVEUR=""; RETOUR=""
for _ in $(seq 1 60); do
  SERVEUR="$(sed -n 's/^SERVEUR //p' "$BANC" | head -1)"
  RETOUR="$(sed -n 's/^RETOUR //p' "$BANC" | head -1)"
  [[ -n "$SERVEUR" && -n "$RETOUR" ]] && break
  sleep 1
done
if [[ -z "$RETOUR" ]]; then
  echo "  ✗ le banc n'a pas produit de retour." >&2
  exit 1
fi
echo "  · serveur : $SERVEUR"
echo "  · retour  : ${RETOUR%%\?*}?code=…&state=…"

echo
echo "== 3. Le client vérifie l'état, lit le code, et échange =="
if OBTENU="$(client terminer "$SERVEUR" "$RETOUR" "$ETAT" "$VERIFICATEUR" 2>"$BASE/err")"; then
  if [[ "$OBTENU" == "$EMAIL" ]]; then
    echo "  ✓ session ouverte pour « $OBTENU » — le SSO authentifie"
  else
    echo "  ✗ le serveur a rendu « $OBTENU » au lieu de « $EMAIL »." >&2
    echec=1
  fi
else
  echo "  ✗ l'échange a échoué :" >&2
  tail -4 "$BASE/err" >&2
  echec=1
fi

echo
echo "== 4. Le contrôle : un état étranger doit être refusé =="
# Le retour est authentique, le code aussi — seul l'état attendu change. Si le client
# acceptait, il ouvrirait une session qu'un tiers a lancée.
if client terminer "$SERVEUR" "$RETOUR" "un-autre-etat" "$VERIFICATEUR" >/dev/null 2>&1; then
  echo "  ✗ le client a accepté un retour dont l'état n'est pas le sien." >&2
  echec=1
else
  echo "  ✓ refusé : le retour ne répond pas à notre demande"
fi

echo
echo "== 5. Le contrôle : le code est à usage unique =="
# L'étape 3 a échangé ce code ; l'étape 4 ne l'a **pas** présenté au serveur, puisque le
# client s'est arrêté sur l'état avant d'appeler. C'est donc bien un second usage qu'on
# tente ici, et il doit échouer — le serveur consomme le code à la première présentation,
# atomiquement, y compris quand l'échange échoue ensuite pour une autre raison.
if client terminer "$SERVEUR" "$RETOUR" "$ETAT" "$VERIFICATEUR" >/dev/null 2>&1; then
  echo "  ✗ le code a été accepté deux fois — le rejeu est possible." >&2
  echec=1
else
  echo "  ✓ refusé : un code déjà présenté ne vaut plus rien"
fi

echo
if [[ $echec -ne 0 ]]; then
  echo "Témoin en échec : le client et le serveur ne s'accordent pas." >&2
  exit 1
fi
echo "Témoin concluant : le client Android mène le PKCE, vérifie l'état, et obtient une"
echo "session du vrai serveur — sans que le vérificateur ne quitte jamais le client."
