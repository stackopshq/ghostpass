#!/usr/bin/env bash
# Le SSO **du bouton jusqu'au coffre**, sur appareil, navigateur compris.
#
#   tools/android/temoin-du-sso-a-l-ecran.sh
#
# ─── Ce qu'aucun autre témoin ne couvre ───
#
#   — `temoin-du-sso-mobile.sh` éprouve le client (PKCE, état, échange, rejeu) mais mène
#     lui-même le flux en ligne de commande : le navigateur n'y entre jamais ;
#   — `SsoMobileTest` éprouve le calcul et la lecture du retour, hors de tout appareil.
#
# Reste le chaînon qui les relie : l'onglet de navigateur s'ouvre-t-il, la chaîne de
# redirections revient-elle **dans l'application** par son schéma d'URL, et l'application en
# fait-elle une session ? C'est précisément là que vit le défaut qu'iOS a connu — un schéma
# écrit à côté de l'identifiant du paquet, une variante suffixée, et le navigateur se
# referme sur une page morte sans que rien ne l'explique.
#
# ─── Les deux points de vue sur la machine, et pourquoi ils comptent ───
#
# Le serveur lit la découverte OIDC depuis la **boucle locale** ; le navigateur de
# l'émulateur ne connaît la machine que par **10.0.2.2**. Le banc annonce donc un
# `authorization_endpoint` pour le navigateur et garde le reste en boucle locale — la
# découverte OIDC permet précisément de les dissocier. Une seule adresse pour les deux
# échouerait chez l'un ou chez l'autre, et le message serait « fournisseur SSO
# indisponible » dans les deux cas.
set -euo pipefail

PRODUIT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
GRADLE="$PRODUIT/apps/android"
ARBRE="${ARBRE_SERVEUR:-/tmp/gp-sso-main}"
SDK="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
ADB="$SDK/platform-tools/adb"
: "${JAVA_HOME:=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home}"
export JAVA_HOME

PAQUET="ch.stackops.ghostpass"
RUNNER="$PAQUET.test/androidx.test.runner.AndroidJUnitRunner"
EMAIL="clara@ghostpass.test"
MOTDEPASSE="correct horse battery staple"

"$ADB" shell true >/dev/null 2>&1 || { echo "Aucun appareil." >&2; exit 1; }
command -v node >/dev/null || { echo "node introuvable." >&2; exit 1; }

if [[ ! -d "$ARBRE/apps/server/src" ]]; then
  git -C "$PRODUIT" worktree add --detach "$ARBRE" origin/main >/dev/null 2>&1 \
    || { echo "impossible de monter l'arbre de travail du serveur." >&2; exit 1; }
fi
[[ -e "$ARBRE/apps/server/node_modules" ]] \
  || ln -sfn "$PRODUIT/apps/server/node_modules" "$ARBRE/apps/server/node_modules"
cp "$PRODUIT/tools/android/sso-banc-idp.ts" "$ARBRE/apps/server/scripts/"

BASE="$(mktemp -d)"
BANC="$BASE/banc.log"
TUYAU="$BASE/tuyau"
mkfifo "$TUYAU"
TAILLE_INITIALE="$("$ADB" shell wm size | sed -n 's/^Override size: //p' | tr -d '\r')"

ranger() {
  local code=$?
  [[ -n "${BANC_PID:-}" ]] && kill "$BANC_PID" 2>/dev/null || true
  exec 9>&- 2>/dev/null || true
  if [[ -n "$TAILLE_INITIALE" ]]; then
    "$ADB" shell wm size "$TAILLE_INITIALE" >/dev/null 2>&1 || true
  else
    "$ADB" shell wm size reset >/dev/null 2>&1 || true
  fi
  [[ $code -ne 0 && -f "$BANC" ]] && { echo; echo "Journal du banc :" >&2; tail -10 "$BANC" >&2; }
  rm -rf "$BASE"
  exit $code
}
trap ranger EXIT

echo "== 1. Le banc : fournisseur d'identité simulé, et le vrai serveur =="
( cd "$ARBRE/apps/server" && node --import tsx scripts/sso-banc-idp.ts --navigateur \
    > "$BANC" 2>&1 < "$TUYAU" ) &
BANC_PID=$!
exec 9>"$TUYAU"

SERVEUR=""
for _ in $(seq 1 60); do
  SERVEUR="$(sed -n 's/^SERVEUR //p' "$BANC" | head -1)"
  [[ -n "$SERVEUR" ]] && break
  sleep 1
done
[[ -n "$SERVEUR" ]] || { echo "  ✗ le banc n'a pas démarré." >&2; exit 1; }
echo "  · $SERVEUR (vu de l'émulateur)"

# Le compte est créé **ici**, par le même cœur que l'application, et non par le banc : les
# blobs qu'inscrirait le banc sont factices, le SSO les accepterait — il authentifie
# l'identité — et aucun mot de passe maître ne les ouvrirait. Le parcours irait alors au bout
# du SSO pour buter sur « Mot de passe maître incorrect », en accusant le déverrouillage.
#
# Pas de `|| true` : un semis qui échoue doit se voir tout de suite, pas trois étapes plus
# loin sous un autre nom.
echo "  · semis du compte, par le même cœur que l'application"
( cd "$GRADLE" && ./gradlew :coeur-hote:semerLeServeur --console=plain -q \
    -Pserveur="${SERVEUR/10.0.2.2/127.0.0.1}" -Pemail="$EMAIL" -Pmotdepasse="$MOTDEPASSE" ) \
  >/dev/null

echo
echo "== 2. Un navigateur qui ne bloque pas sur son premier lancement =="
# Sans cela, l'onglet s'ouvre sur l'assistant de bienvenue de Chrome et la chaîne s'arrête
# là. Ce n'est pas un défaut du produit — c'est l'émulateur qui n'a jamais servi.
"$ADB" shell 'echo "_ --disable-fre --no-first-run --no-default-browser-check" > /data/local/tmp/chrome-command-line'
"$ADB" shell am set-debug-app --persistent com.android.chrome >/dev/null 2>&1 || true
"$ADB" shell am force-stop com.android.chrome >/dev/null 2>&1 || true
echo "  · premier lancement de Chrome désactivé"

echo
echo "== 3. Installer, et repartir d'un appareil vierge =="
( cd "$GRADLE" && ./gradlew :app:assembleDebug :app:assembleDebugAndroidTest \
    --console=plain -q ) >/dev/null
"$ADB" install -r -t "$GRADLE/app/build/outputs/apk/debug/app-debug.apk" >/dev/null
"$ADB" install -r -t \
  "$GRADLE/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk" >/dev/null
"$ADB" shell wm size 540x1200 >/dev/null
sleep 3
"$ADB" shell pm clear "$PAQUET" >/dev/null
"$ADB" shell input keyevent KEYCODE_WAKEUP >/dev/null 2>&1 || true
echo "  · application réinitialisée"

echo
echo "== 4. Le parcours, du bouton au coffre =="
SORTIE="$BASE/sso.log"
set +e
"$ADB" shell "am instrument -w \
  -e class ch.stackops.ghostpass.ParcoursDeBoutEnBoutTest#leSsoDepuisLEcran \
  -e serveur '$SERVEUR' -e email '$EMAIL' -e motdepasse '$MOTDEPASSE' \
  $RUNNER" > "$SORTIE" 2>&1
set -e

if grep -q "^OK (" "$SORTIE"; then
  echo "  ✓ le bouton ouvre un onglet, la chaîne revient par le schéma de l'application,"
  echo "    et le mot de passe maître — toujours demandé — ouvre le coffre."
  echo
  echo "Témoin concluant : le SSO fonctionne du bouton jusqu'au coffre, navigateur compris."
else
  echo "  ✗ le parcours a échoué. Ce qu'il rapporte :" >&2
  sed -n '/Error in/,/^$/p' "$SORTIE" | head -20 >&2 || tail -20 "$SORTIE" >&2
  exit 1
fi
