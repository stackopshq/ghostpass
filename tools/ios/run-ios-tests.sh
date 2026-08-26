#!/usr/bin/env bash
# Fait tourner les tests iOS : contrat (rapides, hermétiques) puis parcours de bout en
# bout contre un vrai serveur GhostPass, amorcé ici même.
#
# Tout ce que le script démarre, il l'arrête : serveur, simulateur, base temporaire.
# Le coffre de test contient délibérément l'item de registre "\0gp:folders", que
# l'application doit masquer — c'est la régression que ce parcours sert à détecter.
#
# Effet de bord assumé : désactive la synchronisation du presse-papiers du Simulator
# (réglage global, non restauré). Sans cela, chaque prise de focus dans un champ texte
# fige l'application une minute. Pour revenir en arrière :
#   defaults write com.apple.iphonesimulator PasteboardAutomaticSync -bool true
#
# Usage : ./tools/ios/run-ios-tests.sh [--unit-only]
#   GHOSTPASS_KEEP_RESULTS=1  conserve aussi les rapports d'un run réussi (captures
#                             d'écran comprises), pour inspecter ce qu'a vu le test.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
IOS="$ROOT/apps/ios"
# Figé : les tests portent la même valeur par défaut (voir VaultFlowTests).
PORT=3111
EMAIL="clara@ghostpass.test"
PASSWORD="correct horse battery staple"
SERVER_URL="http://127.0.0.1:$PORT"
UNIT_ONLY=false
[[ "${1:-}" == "--unit-only" ]] && UNIT_ONLY=true

WORK="$(mktemp -d)"
# Les rapports d'un run raté survivent au nettoyage : sans eux, il ne reste qu'un nom de
# test et aucune trace de ce que montrait l'écran. La CI les publie en artefact.
RESULTS="$ROOT/apps/ios/TestResults"
# Les produits de compilation, eux, survivent d'un run à l'autre : les remettre dans un
# répertoire temporaire ferait tout recompiler à chaque fois — quatre minutes pour rien
# en local. La CI part d'une machine neuve, cela ne change rien pour elle.
DERIVED="$ROOT/apps/ios/.build"
SERVER_PID=""
BIO_PID=""
PAGE_PID=""
DEVICE=""

cleanup() {
  local code=$?
  [[ -n "$BIO_PID" ]] && kill "$BIO_PID" 2>/dev/null || true
  [[ -n "$PAGE_PID" ]] && kill "$PAGE_PID" 2>/dev/null || true
  [[ -n "$SERVER_PID" ]] && kill "$SERVER_PID" 2>/dev/null || true
  # `npm start` lance tsx dans un processus fils : tuer le sous-shell le laisserait
  # orphelin, à écouter le port, et le run suivant se heurterait à son compte déjà créé.
  local lingering
  lingering="$(lsof -ti "tcp:$PORT" 2>/dev/null || true)"
  [[ -n "$lingering" ]] && kill $lingering 2>/dev/null || true
  if [[ $code -ne 0 || "${GHOSTPASS_KEEP_RESULTS:-}" == "1" ]]; then
    mkdir -p "$RESULTS"
    for bundle in "$WORK"/*.xcresult; do
      # `cp -R` sur une destination qui existe déjà copie *dedans* : le rapport du run
      # précédent avalerait le nouveau, qu'on chercherait ensuite en vain.
      [[ -e "$bundle" ]] || continue
      rm -rf "$RESULTS/$(basename "$bundle")"
      cp -R "$bundle" "$RESULTS/" 2>/dev/null || true
    done
    [[ -e "$WORK/server.log" ]] && cp "$WORK/server.log" "$RESULTS/" 2>/dev/null || true
    echo "Rapports conservés dans apps/ios/TestResults/" >&2
  fi
  if [[ -n "$DEVICE" ]]; then
    xcrun simctl shutdown "$DEVICE" >/dev/null 2>&1 || true
    xcrun simctl delete "$DEVICE" >/dev/null 2>&1 || true
  fi
  rm -rf "$WORK"
  exit $code
}
trap cleanup EXIT INT TERM

say() { printf '\n\033[1m▸ %s\033[0m\n' "$*"; }

# ── Simulateur ────────────────────────────────────────────────────────────────
# Un simulateur neuf, créé pour ce run et détruit à la fin. C'est le seul moyen
# d'obtenir un trousseau vierge : `simctl uninstall` laisse les éléments Keychain
# derrière lui, et l'app hériterait du choix biométrique du run précédent. Au passage,
# on ne touche à aucun simulateur existant.
read -r DEVTYPE RUNTIME < <(xcrun simctl list -j devicetypes runtimes | python3 -c '
import json, sys
cat = json.load(sys.stdin)
runtimes = [r for r in cat["runtimes"] if r.get("isAvailable") and r["platform"] == "iOS"]
if not runtimes:
    sys.exit("aucun runtime iOS installé")
runtime = sorted(runtimes, key=lambda r: r["version"])[-1]
supported = set(runtime.get("supportedDeviceTypes", []) and
                [d["identifier"] for d in runtime["supportedDeviceTypes"]])
phones = [d for d in cat["devicetypes"]
          if "iPhone" in d["name"] and (not supported or d["identifier"] in supported)]
if not phones:
    sys.exit("aucun type iPhone disponible")
print(phones[-1]["identifier"], runtime["identifier"])
')
[[ -n "${DEVTYPE:-}" && -n "${RUNTIME:-}" ]] || {
  echo "Impossible de choisir un simulateur. Installez un runtime iOS : xcodebuild -downloadPlatform iOS" >&2
  exit 1
}

DEVICE="$(xcrun simctl create "ghostpass-tests-$$" "$DEVTYPE" "$RUNTIME")"
say "Simulateur éphémère $DEVICE ($DEVTYPE)"
xcrun simctl boot "$DEVICE" >/dev/null 2>&1 || true
# `simctl bootstatus -b` peut ne jamais rendre la main sur un simulateur qu'on vient de
# créer — en intégration continue, le job tournerait alors jusqu'à son propre délai.
# On interroge nous-mêmes, avec une borne.
booted=false
for _ in $(seq 1 90); do
  if xcrun simctl list devices | grep -q "$DEVICE.*Booted"; then
    booted=true
    break
  fi
  sleep 1
done
$booted || { echo "Le simulateur n'a pas démarré en 90 s." >&2; exit 1; }

# La saisie de texte gèle une minute si le simulateur tente de synchroniser son
# presse-papiers avec l'hôte : le clavier interroge le pasteboard à chaque prise de focus.
defaults write com.apple.iphonesimulator PasteboardAutomaticSync -bool false

# L'application existe en français et en anglais, et suit la langue de l'appareil tant
# que l'utilisateur n'en choisit pas une. Les tests, eux, attendent des libellés précis :
# on fixe donc la langue du simulateur plutôt que d'hériter de celle du poste, sur lequel
# la même suite passerait ou échouerait selon les réglages de son propriétaire. Le
# réglage vaut aussi pour Safari, qui héberge l'extension de remplissage.
xcrun simctl spawn "$DEVICE" defaults write .GlobalPreferences AppleLanguages -array fr
xcrun simctl spawn "$DEVICE" defaults write .GlobalPreferences AppleLocale -string fr_CH

# ── Biométrie simulée ─────────────────────────────────────────────────────────
# Sans inscription, `test02Biometrie` se met en skip plutôt que de passer par hasard.
BIOMETRICS=0
if xcrun simctl spawn "$DEVICE" notifyutil -s com.apple.BiometricKit.enrollmentChanged 1 2>>"$WORK/bio.log" &&
  xcrun simctl spawn "$DEVICE" notifyutil -p com.apple.BiometricKit.enrollmentChanged 2>>"$WORK/bio.log"; then
  BIOMETRICS=1
  # Le panneau Face ID attend une correspondance à chaque demande : on en envoie en
  # continu. L'inscription, elle, n'est posée qu'une fois — la reposter en boucle fait
  # osciller l'état que lit l'application.
  (while true; do
    xcrun simctl spawn "$DEVICE" notifyutil -p com.apple.BiometricKit_Sim.pearl.match >/dev/null 2>&1 || true
    sleep 2
  done) &
  BIO_PID=$!
  say "Biométrie simulée : active"
else
  say "Biométrie simulée : indisponible ($(tail -1 "$WORK/bio.log" 2>/dev/null)), test ignoré"
fi


# ── Cœur crypto + projet ──────────────────────────────────────────────────────
say "Construction de l'XCFramework et des bindings"
"$ROOT/tools/ios/build-xcframework.sh" >"$WORK/xcframework.log" 2>&1 ||
  { echo "Échec du build XCFramework :" >&2; tail -30 "$WORK/xcframework.log" >&2; exit 1; }

say "Génération du projet Xcode"
(cd "$IOS" && xcodegen generate >/dev/null)

run_tests() {
  local only="$1"; shift
  # Un identifiant de test contient des « / » : tels quels, ils feraient du rapport un
  # sous-dossier, que la conservation en cas d'échec ne ramasserait pas.
  local nom="${only//\//-}"
  xcodebuild -project "$IOS/Ghostpass.xcodeproj" -scheme Ghostpass \
    -sdk iphonesimulator -destination "platform=iOS Simulator,id=$DEVICE" \
    -derivedDataPath "$DERIVED" -resultBundlePath "$WORK/$nom.xcresult" \
    -only-testing:"$only" "$@" test
}

# ── Tests de contrat ──────────────────────────────────────────────────────────
say "Tests de contrat"
run_tests GhostpassTests

if $UNIT_ONLY; then
  say "Tests de contrat : OK (parcours de bout en bout ignoré)"
  exit 0
fi

# ── Serveur de test ───────────────────────────────────────────────────────────
if lsof -ti "tcp:$PORT" >/dev/null 2>&1; then
  echo "Le port $PORT est déjà occupé — un run précédent a-t-il survécu ?" >&2
  exit 1
fi

say "Démarrage du serveur GhostPass (SQLite jetable, port $PORT)"
[[ -d "$ROOT/apps/server/node_modules" ]] || (cd "$ROOT/apps/server" && npm ci >/dev/null)
(cd "$ROOT/apps/server" && DB_PATH="$WORK/ghostpass.db" PORT="$PORT" npm start >"$WORK/server.log" 2>&1) &
SERVER_PID=$!

ready=false
for _ in $(seq 1 60); do
  if curl -sS -o /dev/null --max-time 2 "$SERVER_URL/api/auth/prelogin" -X POST \
    -H 'Content-Type: application/json' -d '{"email":"probe@example.com"}'; then
    ready=true
    break
  fi
  sleep 1
done
$ready || { echo "Le serveur n'a pas démarré :" >&2; tail -20 "$WORK/server.log" >&2; exit 1; }

say "Amorçage du coffre de test (compte + item de registre gp:folders)"
cargo run -q -p ghostpass-crypto-ffi --example seed-vault -- "$EMAIL" "$PASSWORD" >"$WORK/seed.json"
SERVER_URL="$SERVER_URL" python3 - "$WORK/seed.json" <<'PY'
import json, os, sys, urllib.request
base = os.environ["SERVER_URL"]
seed = json.load(open(sys.argv[1]))

def post(path, body, token=None):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = "Bearer " + token
    req = urllib.request.Request(base + path, data=json.dumps(body).encode(), headers=headers)
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read() or b"{}")

token = post("/api/auth/register", seed["registration"])["token"]
for item in seed["items"]:
    post("/api/vault/items", item, token)
print(f"  compte créé, {len(seed['items'])} items déposés")
PY

# ── Parcours de bout en bout ──────────────────────────────────────────────────
say "Parcours de bout en bout"
# Pas d'environnement à passer : `xcodebuild` n'en propage aucun jusqu'au processus de
# test. Les tests connaissent ces valeurs par défaut ; c'est le contrat entre eux et ce
# script — d'où le port et le compte figés plus haut.
if ! run_tests GhostpassUITests/VaultFlowTests/test01ParcoursComplet \
  -only-testing:GhostpassUITests/VaultFlowTests/test02Biometrie \
  -only-testing:GhostpassUITests/VaultFlowTests/test05Preferences \
  -only-testing:GhostpassUITests/VaultFlowTests/test06Recuperation; then
  echo "--- journal de l'application ---" >&2
  xcrun simctl spawn "$DEVICE" log show --last 15m --style compact \
    --predicate 'process == "Ghostpass"' 2>/dev/null | grep -a "GP-" | tail -25 >&2 ||
    echo "(journal indisponible)" >&2
  exit 1
fi

# ── Hors ligne ────────────────────────────────────────────────────────────────
# Le coffre doit s'ouvrir sans serveur. On coupe pour de bon : simuler l'absence de
# réseau autrement reviendrait à éprouver le simulacre plutôt que l'application.
say "Coupure du serveur, puis réouverture hors ligne"
kill "$SERVER_PID" 2>/dev/null || true
lingering="$(lsof -ti "tcp:$PORT" 2>/dev/null || true)"
[[ -n "$lingering" ]] && kill $lingering 2>/dev/null || true
SERVER_PID=""
sleep 2

if ! run_tests GhostpassUITests/VaultFlowTests/test03HorsLigne; then
  echo "--- journal du serveur ---" >&2
  tail -20 "$WORK/server.log" >&2 || true
  exit 1
fi

# ── Remplissage automatique ───────────────────────────────────────────────────
# L'extension n'est joignable que depuis un vrai champ de saisie : on sert une page de
# connexion, on l'active auprès du système, et Safari fait le reste. Le coffre déposé par
# le parcours précédent contient un identifiant pour cette page.
say "Remplissage automatique dans Safari"
(cd "$ROOT/tools/ios/testpage" && python3 -m http.server 8099 --bind 127.0.0.1 >/dev/null 2>&1) &
PAGE_PID=$!

if xcrun simctl spawn "$DEVICE" pluginkit -e use -i ch.stackops.ghostpass.autofill 2>/dev/null; then
  if ! run_tests GhostpassUITests/AutoFillSafariTests/test04Remplissage; then
    kill "$PAGE_PID" 2>/dev/null || true
    exit 1
  fi
else
  say "Extension non activable sur ce simulateur : remplissage non vérifié"
fi
kill "$PAGE_PID" 2>/dev/null || true

say "Tous les tests iOS sont passés"
