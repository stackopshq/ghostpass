#!/usr/bin/env bash
# Monte un banc d'essai pour vérifier le remplissage automatique **à la main**, et le laisse
# en place.
#
# `test04Remplissage` ne peut pas le faire : sous `xcodebuild`, iOS n'affiche aucun clavier
# logiciel, et la barre de remplissage vit dans ce clavier. Six réglages ont été essayés
# sans succès (voir le commentaire du test). Quelqu'un qui pilote le simulateur à la souris,
# lui, obtient ce clavier sans difficulté — d'où ce banc, qui prépare tout et rend la main.
#
#   ./tools/ios/autofill-manuel.sh
#
# À la fin, tout reste allumé : simulateur, serveur, page de test. Ctrl-C pour tout couper.
set -euo pipefail

if ! command -v rustup >/dev/null && [[ -x "$HOME/.cargo/bin/rustup" ]]; then
  PATH="$HOME/.cargo/bin:$PATH"
  export PATH
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
IOS="$ROOT/apps/ios"
DERIVED="$IOS/.build"
PORT=3111
PAGE=8099
EMAIL="clara@ghostpass.test"
PASSWORD="correct horse battery staple"
NOM="ghostpass-manuel"

say() { printf "\n\033[1m▸ %s\033[0m\n" "$*" >&2; }

if lsof -ti "tcp:$PORT" >/dev/null 2>&1; then
  echo "Le port $PORT est occupé — une suite de tests tourne-t-elle ?" >&2
  exit 1
fi

# ── Le simulateur, persistant celui-là ────────────────────────────────────────
# Le harnais de test en crée un jetable et le détruit en partant ; ici on veut le retrouver
# d'une session à l'autre, avec ses réglages et son coffre.
DEVICE="$(xcrun simctl list devices | awk -v n="$NOM" '$0 ~ n {print $0}' |
  grep -oE "[0-9A-F-]{36}" | head -1 || true)"
if [[ -z "$DEVICE" ]]; then
  lu=$(xcrun simctl list -j devicetypes runtimes | python3 -c '
import json, sys
cat = json.load(sys.stdin)
runtimes = [r for r in cat["runtimes"] if r["isAvailable"] and "iOS" in r["name"]]
runtime = sorted(runtimes, key=lambda r: r["version"])[-1]
supported = {d["identifier"] for d in runtime.get("supportedDeviceTypes", [])}
phones = [d for d in cat["devicetypes"]
          if "iPhone" in d["name"] and (not supported or d["identifier"] in supported)]
print(phones[-1]["identifier"], runtime["identifier"])
')
  DEVICE="$(xcrun simctl create "$NOM" $lu)"
  say "Simulateur créé : $DEVICE"
else
  say "Simulateur retrouvé : $DEVICE"
fi

xcrun simctl boot "$DEVICE" >/dev/null 2>&1 || true
xcrun simctl spawn "$DEVICE" defaults write .GlobalPreferences AppleLanguages -array fr || true
open -a Simulator --args -CurrentDeviceUDID "$DEVICE"
sleep 8

# ── L'application ─────────────────────────────────────────────────────────────
say "Construction de l'XCFramework et des bindings"
"$ROOT/tools/ios/build-xcframework.sh" >/dev/null 2>&1

say "Construction de l'application"
(cd "$IOS" && xcodegen generate >/dev/null)
xcodebuild -project "$IOS/Ghostpass.xcodeproj" -scheme Ghostpass \
  -sdk iphonesimulator -destination "platform=iOS Simulator,id=$DEVICE" \
  -derivedDataPath "$DERIVED" build >/dev/null

APP="$DERIVED/Build/Products/Debug-iphonesimulator/Ghostpass.app"
[[ -d "$APP" ]] || { echo "Application introuvable : $APP" >&2; exit 1; }
xcrun simctl install "$DEVICE" "$APP"

# L'extension doit être connue du système avant d'apparaître dans les Réglages.
xcrun simctl spawn "$DEVICE" pluginkit -a "$APP/PlugIns/GhostpassAutoFill.appex" 2>/dev/null || true
xcrun simctl spawn "$DEVICE" pluginkit -e use -i ch.stackops.ghostpass.autofill 2>/dev/null || true

# ── Le serveur et son coffre ──────────────────────────────────────────────────
TRAVAIL="$(mktemp -d)"
trap 'kill $(jobs -p) 2>/dev/null || true; rm -rf "$TRAVAIL"' EXIT INT TERM

say "Serveur GhostPass (SQLite jetable, port $PORT)"
[[ -d "$ROOT/apps/server/node_modules" ]] || (cd "$ROOT/apps/server" && npm ci >/dev/null)
(cd "$ROOT/apps/server" && DB_PATH="$TRAVAIL/ghostpass.db" PORT="$PORT" npm start \
  >"$TRAVAIL/server.log" 2>&1) &
for _ in $(seq 1 40); do
  curl -sS -o /dev/null --max-time 2 "http://127.0.0.1:$PORT/api/auth/prelogin" \
    -X POST -H 'content-type: application/json' -d '{"email":"x@y.z"}' && break
  sleep 0.5
done

say "Amorçage du coffre"
cargo run -q -p ghostpass-crypto-ffi --example seed-vault -- "$EMAIL" "$PASSWORD" \
  >"$TRAVAIL/seed.json"
SERVER_URL="http://127.0.0.1:$PORT" python3 - "$TRAVAIL/seed.json" <<'PYTHON'
import json, os, sys, urllib.request
base = os.environ["SERVER_URL"]
seed = json.load(open(sys.argv[1]))
def post(path, body, token=None):
    h = {"Content-Type": "application/json"}
    if token: h["Authorization"] = "Bearer " + token
    req = urllib.request.Request(base + path, data=json.dumps(body).encode(), headers=h)
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read() or b"{}")
token = post("/api/auth/register", seed["registration"])["token"]
for item in seed["items"]:
    post("/api/vault/items", item, token)
print(f"  compte créé, {len(seed['items'])} items déposés")
PYTHON

say "Page de connexion de test (port $PAGE)"
(cd "$ROOT/tools/ios/testpage" && python3 -m http.server "$PAGE" --bind 127.0.0.1 \
  >/dev/null 2>&1) &

# ── À vous de jouer ───────────────────────────────────────────────────────────
cat >&2 <<INSTRUCTIONS

$(printf "\033[1m")Tout est prêt. Dans le simulateur :$(printf "\033[0m")

  1. Menu I/O > Keyboard > Toggle Software Keyboard (Cmd-K) si le clavier
     n'apparaît pas quand vous touchez un champ.

  2. Ouvrir GhostPass et se connecter :
       serveur         127.0.0.1:$PORT
       adresse         $EMAIL
       mot de passe    $PASSWORD

  3. Réglages > Général > Saisie automatique : activer, et cocher GhostPass.
     (Ce réglage ne s'écrit pas par script — c'est ce qui empêche test04 de
     l'automatiser complètement.)

  4. Safari > 127.0.0.1:$PAGE > toucher le champ « Identifiant ».
     Le clavier doit proposer « Mots de passe », puis GhostPass, puis remplir.

  5. Codes à usage unique (iOS 18 ou plus) :
     Réglages > Général > Saisie automatique > « Configurer les codes dans »
     doit maintenant proposer GhostPass. Le cocher, puis dans Safari toucher
     le champ « Code à 6 chiffres » de la même page.
     Le compte « Site local » porte un secret TOTP ; son code doit apparaître
     dans la liste et remplir le champ.

$(printf "\033[1m")Ce qu'on vérifie$(printf "\033[0m") : que l'extension s'ouvre, déchiffre le coffre local,
propose l'identifiant du site, que le formulaire finit rempli — et, pour les codes,
que GhostPass figure bien sous « Configurer les codes dans » et livre un code valide.

Ctrl-C pour tout couper.
INSTRUCTIONS

wait
