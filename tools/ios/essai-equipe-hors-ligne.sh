#!/usr/bin/env bash
# Éprouve les coffres d'équipe hors ligne et le retour du réseau (EquipeHorsLigneTests).
#
# Le serveur est allumé et éteint par un portier HTTP (`portier-de-serveur.py`) plutôt
# que par ce script seul : c'est le test qui sait à quelle seconde le bandeau « Hors
# ligne » est à l'écran, et donc quand le réseau peut revenir sans fausser la mesure.
#
# Tout ce que le script démarre, il l'arrête : portier, serveur, simulateur, base
# temporaire. Il ne touche à aucun simulateur ni à aucun serveur qu'il n'a pas lancé.
#
# Usage : ./tools/ios/essai-equipe-hors-ligne.sh
#   GHOSTPASS_SKIP_CORE=1     ne pas reconstruire l'XCFramework (déjà à jour)
#   GHOSTPASS_KEEP_RESULTS=1  conserver les rapports même en cas de succès
set -euo pipefail

if ! command -v rustup >/dev/null && [[ -x "$HOME/.cargo/bin/rustup" ]]; then
  PATH="$HOME/.cargo/bin:$PATH"
  export PATH
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
IOS="$ROOT/apps/ios"
# Figés : le test porte les mêmes valeurs par défaut — `xcodebuild` ne transmet aucun
# environnement au processus de test.
PORT=3111
PORTIER=3199
EMAIL="clara@ghostpass.test"
PASSWORD="correct horse battery staple"
WORK="$(mktemp -d)"
RESULTS="$IOS/TestResults/equipe-hors-ligne"
DERIVED="$IOS/.build"
PORTIER_PID=""
DEVICE=""

cleanup() {
  local code=$?
  if [[ -n "$PORTIER_PID" ]]; then
    kill "$PORTIER_PID" 2>/dev/null || true
    wait "$PORTIER_PID" 2>/dev/null || true
  fi
  if [[ $code -ne 0 || "${GHOSTPASS_KEEP_RESULTS:-}" == "1" ]]; then
    mkdir -p "$RESULTS"
    for bundle in "$WORK"/*.xcresult; do
      [[ -e "$bundle" ]] || continue
      rm -rf "$RESULTS/$(basename "$bundle")"
      cp -R "$bundle" "$RESULTS/" 2>/dev/null || true
    done
    [[ -e "$WORK/serveur.log" ]] && cp "$WORK/serveur.log" "$RESULTS/" 2>/dev/null || true
    echo "Rapports conservés dans apps/ios/TestResults/equipe-hors-ligne/" >&2
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

for p in "$PORT" "$PORTIER"; do
  if lsof -ti "tcp:$p" >/dev/null 2>&1; then
    echo "Le port $p est déjà occupé — un run précédent a-t-il survécu ?" >&2
    exit 1
  fi
done

# ── Portier et serveur ────────────────────────────────────────────────────────
say "Portier sur $PORTIER, serveur GhostPass sur $PORT (SQLite jetable)"
[[ -d "$ROOT/apps/server/node_modules" ]] || (cd "$ROOT/apps/server" && npm ci >/dev/null)
python3 "$ROOT/tools/ios/portier-de-serveur.py" \
  --racine "$ROOT" --db "$WORK/ghostpass.db" --journal "$WORK/serveur.log" \
  --port "$PORTIER" --port-serveur "$PORT" >"$WORK/portier.log" 2>&1 &
PORTIER_PID=$!

for _ in $(seq 1 30); do
  curl -sS -o /dev/null --max-time 2 "http://127.0.0.1:$PORTIER/etat" && break
  sleep 1
done

allumer() {
  curl -fsS --max-time 90 "http://127.0.0.1:$PORTIER/allumer" >/dev/null ||
    { echo "le portier n'a pas allumé le serveur" >&2; exit 1; }
}
eteindre() {
  curl -fsS --max-time 60 "http://127.0.0.1:$PORTIER/eteindre" >/dev/null ||
    { echo "le portier n'a pas éteint le serveur" >&2; exit 1; }
}

allumer

say "Amorçage du compte de test"
cargo run -q -p ghostpass-crypto-ffi --example seed-vault -- "$EMAIL" "$PASSWORD" \
  >"$WORK/seed.json"
SERVER_URL="http://127.0.0.1:$PORT" python3 - "$WORK/seed.json" <<'PY'
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

# ── Simulateur ────────────────────────────────────────────────────────────────
# Neuf, donc trousseau vierge : une session laissée par un autre run masquerait
# l'écran de connexion que le premier test attend.
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
DEVICE="$(xcrun simctl create "ghostpass-equipe-$$" "$DEVTYPE" "$RUNTIME")"
say "Simulateur éphémère $DEVICE"
xcrun simctl boot "$DEVICE" >/dev/null 2>&1 || true
booted=false
for _ in $(seq 1 90); do
  xcrun simctl list devices | grep -q "$DEVICE.*Booted" && { booted=true; break; }
  sleep 1
done
$booted || { echo "Le simulateur n'a pas démarré en 90 s." >&2; exit 1; }

defaults write com.apple.iphonesimulator PasteboardAutomaticSync -bool false
xcrun simctl spawn "$DEVICE" defaults write .GlobalPreferences AppleLanguages -array fr
xcrun simctl spawn "$DEVICE" defaults write .GlobalPreferences AppleLocale -string fr_CH

# ── Cœur crypto + projet ──────────────────────────────────────────────────────
if [[ "${GHOSTPASS_SKIP_CORE:-0}" != "1" ]]; then
  say "Construction de l'XCFramework"
  "$ROOT/tools/ios/build-xcframework.sh" >"$WORK/xcframework.log" 2>&1 ||
    { echo "Échec du build XCFramework :" >&2; tail -30 "$WORK/xcframework.log" >&2; exit 1; }
fi
say "Génération du projet Xcode"
(cd "$IOS" && xcodegen generate >/dev/null)

essai() {
  local nom="$1"
  xcodebuild -project "$IOS/Ghostpass.xcodeproj" -scheme Ghostpass \
    -sdk iphonesimulator -destination "platform=iOS Simulator,id=$DEVICE" \
    -derivedDataPath "$DERIVED" -resultBundlePath "$WORK/$nom.xcresult" \
    -only-testing:"GhostpassUITests/EquipeHorsLigneTests/$nom" test
}

# ── Les quatre moments ────────────────────────────────────────────────────────
say "1/4 — équipe créée, serveur debout"
essai test01EnLigne

say "2/4 — serveur coupé : le coffre d'équipe doit rester lisible"
eteindre
essai test02HorsLigne

say "3/4 — le réseau revient de lui-même"
essai test03LeReseauRevient

say "4/4 — le bandeau touché réessaie tout de suite"
eteindre
essai test04ToucherLeBandeau

say "Les quatre moments sont vérifiés."
