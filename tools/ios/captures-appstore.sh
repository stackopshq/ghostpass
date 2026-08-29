#!/usr/bin/env bash
# Produit les captures d'écran de la fiche App Store.
#
# Apple exige des dimensions exactes : un fichier redimensionné après coup est refusé. Le
# simulateur 6,9 pouces rend nativement 1320 × 2868, la taille attendue pour l'iPhone.
# C'est pourquoi les vues sont prises dans le simulateur plutôt que fabriquées.
#
#   ./tools/ios/captures-appstore.sh
#
# Les fichiers atterrissent dans apps/ios/AppStore/captures/, numérotés dans l'ordre où ils
# doivent être déposés.
set -euo pipefail

if ! command -v rustup >/dev/null && [[ -x "$HOME/.cargo/bin/rustup" ]]; then
  PATH="$HOME/.cargo/bin:$PATH"
  export PATH
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
IOS="$ROOT/apps/ios"
# Un répertoire par appareil : le jeu iPad ne doit pas écraser le jeu iPhone, App Store
# Connect les réclamant tous les deux quand l'application se déclare universelle.
SORTIE="$IOS/AppStore/captures"
# Un port distinct de celui de la suite de tests : les deux doivent pouvoir tourner sans
# se marcher dessus, et un run qui échoue faute de port libre ne dit rien d'utile.
PORT=3122
EMAIL="clara@ghostpass.test"
PASSWORD="correct horse battery staple"
APPAREIL="${GHOSTPASS_APPAREIL:-iPhone 17 Pro Max}"
# Exporté : le fragment Python ci-dessous le lit dans son environnement.
export APPAREIL
case "$APPAREIL" in
  iPad*) SORTIE="$IOS/AppStore/captures-ipad" ;;
esac

say() { printf "\n\033[1m▸ %s\033[0m\n" "$*" >&2; }

if lsof -ti "tcp:$PORT" >/dev/null 2>&1; then
  echo "Le port $PORT est occupé — une autre prise de vue tourne-t-elle ?" >&2
  exit 1
fi

TRAVAIL="$(mktemp -d)"
DEVICE=""
SERVER_PID=""

# On n'arrête que ce qu'on a lancé : jamais un balayage du port, qui tuerait le serveur
# d'un autre run (voir tools/ci/README.md).
nettoyer() {
  local code=$?
  [[ -n "$SERVER_PID" ]] && { kill -TERM -- "-$SERVER_PID" 2>/dev/null || true; }
  if [[ -n "$DEVICE" ]]; then
    xcrun simctl shutdown "$DEVICE" >/dev/null 2>&1 || true
    xcrun simctl delete "$DEVICE" >/dev/null 2>&1 || true
  fi
  rm -rf "$TRAVAIL"
  exit $code
}
trap nettoyer EXIT INT TERM

# ── Simulateur à la bonne taille ──────────────────────────────────────────────
say "Simulateur « $APPAREIL »"
TYPE="$(xcrun simctl list devicetypes -j | python3 -c '
import json, sys, os
nom = os.environ["APPAREIL"]
for d in json.load(sys.stdin)["devicetypes"]:
    if d["name"] == nom:
        print(d["identifier"]); break
else:
    sys.exit(f"appareil « {nom} » inconnu de ce Xcode")
' )"
RUNTIME="$(xcrun simctl list runtimes -j | python3 -c '
import json, sys
r = [x for x in json.load(sys.stdin)["runtimes"] if x["isAvailable"] and "iOS" in x["name"]]
print(sorted(r, key=lambda x: [int(n) for n in x["version"].split(".")])[-1]["identifier"])
')"
DEVICE="$(xcrun simctl create "captures-appstore" "$TYPE" "$RUNTIME")"
xcrun simctl boot "$DEVICE" >/dev/null 2>&1 || true
xcrun simctl spawn "$DEVICE" defaults write .GlobalPreferences AppleLanguages -array fr || true
xcrun simctl bootstatus "$DEVICE" -b >/dev/null 2>&1 || true

# Barre d'état figée : c'est l'usage pour une fiche App Store, et cela évite qu'une heure
# ou un niveau de batterie différents à chaque prise fassent croire à des captures
# hétérogènes. 9 h 41 est l'heure des présentations d'Apple.
xcrun simctl status_bar "$DEVICE" override \
  --time "09:41" --batteryState charged --batteryLevel 100 \
  --cellularMode active --cellularBars 4 --wifiMode active --wifiBars 3 \
  >/dev/null 2>&1 || true

# ── Application ───────────────────────────────────────────────────────────────
say "Construction"
"$ROOT/tools/ios/build-xcframework.sh" >/dev/null 2>&1
(cd "$IOS" && xcodegen generate >/dev/null)

# ── Serveur et coffre ─────────────────────────────────────────────────────────
say "Serveur (SQLite jetable, port $PORT)"
[[ -d "$ROOT/apps/server/node_modules" ]] || (cd "$ROOT/apps/server" && npm ci >/dev/null)
set -m
(cd "$ROOT/apps/server" && DB_PATH="$TRAVAIL/ghostpass.db" PORT="$PORT" npm start \
  >"$TRAVAIL/server.log" 2>&1) &
SERVER_PID=$!
set +m
for _ in $(seq 1 60); do
  curl -sS -o /dev/null --max-time 2 "http://127.0.0.1:$PORT/api/auth/prelogin" \
    -X POST -H 'content-type: application/json' -d '{"email":"x@y.z"}' && break
  sleep 0.5
done

say "Amorçage du coffre"
# `--vitrine` ajoute des entrées plausibles : un coffre à deux lignes ne montre pas ce que
# fait le produit. Les tests, eux, gardent le compte exact sans ce drapeau.
cargo run -q -p ghostpass-crypto-ffi --example seed-vault -- "$EMAIL" "$PASSWORD" --vitrine \
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

# ── Prise de vue ──────────────────────────────────────────────────────────────
say "Prise de vue"
XCRESULT="$TRAVAIL/captures.xcresult"
# `TEST_RUNNER_<VAR>` doit être dans l'*environnement* de xcodebuild, qui le transmet au
# processus de test en retirant le préfixe. Placé après la commande, `NOM=valeur` serait
# lu comme un réglage de compilation et n'atteindrait jamais le test — c'est ce qui l'a
# fait viser le port par défaut au premier essai, silencieusement.
TEST_RUNNER_GHOSTPASS_SERVER="http://127.0.0.1:$PORT" \
xcodebuild test \
  -project "$IOS/Ghostpass.xcodeproj" -scheme Ghostpass \
  -destination "platform=iOS Simulator,id=$DEVICE" \
  -derivedDataPath "$IOS/.build" -resultBundlePath "$XCRESULT" \
  -only-testing:GhostpassUITests/AppStoreShots \
  >"$TRAVAIL/xcodebuild.log" 2>&1 || {
    # Le journal complet survit : quarante lignes de queue ne contiennent presque jamais
    # la cause, et le répertoire de travail disparaît avec le script.
    mkdir -p "$IOS/AppStore"
    cp "$TRAVAIL/xcodebuild.log" "$IOS/AppStore/derniere-prise-de-vue.log" 2>/dev/null || true
    # Le rapport aussi : le test joint une capture de l'écran fautif, et la regarder répond
    # en une seconde à ce que le texte laisse deviner pendant des heures.
    rm -rf "$IOS/AppStore/derniere-prise-de-vue.xcresult"
    cp -R "$XCRESULT" "$IOS/AppStore/derniere-prise-de-vue.xcresult" 2>/dev/null || true
    echo "La prise de vue a échoué." >&2
    echo "--- ce que le test a visé ---" >&2
    grep -a "GP-SHOTS" "$TRAVAIL/xcodebuild.log" | head -3 >&2 || echo "  (aucune trace)" >&2
    echo "--- erreurs ---" >&2
    grep -aE "error:|failed" "$TRAVAIL/xcodebuild.log" | head -10 >&2 || true
    echo "Journal complet : apps/ios/AppStore/derniere-prise-de-vue.log" >&2
    exit 1
  }

# ── Extraction ────────────────────────────────────────────────────────────────
say "Extraction"
rm -rf "$SORTIE"
mkdir -p "$SORTIE"
BRUT="$TRAVAIL/attachments"
xcrun xcresulttool export attachments --path "$XCRESULT" --output-path "$BRUT" >/dev/null

# Le manifeste donne le nom d'origine de chaque pièce jointe ; sur le disque elles portent
# un identifiant. Sans lui, on ne saurait pas quelle image est quel écran.
SORTIE="$SORTIE" python3 - "$BRUT" <<'PYTHON'
import json, os, re, shutil, sys
brut = sys.argv[1]
sortie = os.environ["SORTIE"]
manifeste = json.load(open(os.path.join(brut, "manifest.json")))
n = 0
for test in manifeste:
    for a in test.get("attachments", []):
        nom = a.get("suggestedHumanReadableName") or a.get("exportedFileName")
        src = os.path.join(brut, a["exportedFileName"])
        # XCTest accole « _0_<UUID> » au nom donné : sans ce nettoyage, les fichiers
        # arrivent illisibles alors qu'ils ont été nommés pour être triés.
        nom = re.sub(r"_\d+_[0-9A-F-]{36}", "", nom)
        if not nom.endswith(".png"):
            nom += ".png"
        shutil.copy(src, os.path.join(sortie, nom))
        n += 1
print(f"  {n} capture(s)")
PYTHON

say "Vérification des dimensions"
# La taille attendue est celle que rend *cet* appareil, relevée sur une capture du
# simulateur — pas une constante. Figée, elle aurait interdit de photographier un iPad,
# dont App Store Connect réclame son propre jeu.
xcrun simctl io "$DEVICE" screenshot "$TRAVAIL/reference.png" >/dev/null 2>&1
attendu_l=$(sips -g pixelWidth "$TRAVAIL/reference.png" | awk '/pixelWidth/{print $2}')
attendu_h=$(sips -g pixelHeight "$TRAVAIL/reference.png" | awk '/pixelHeight/{print $2}')
echo "  taille native de « $APPAREIL » : ${attendu_l}×${attendu_h}" >&2
ok=true
for f in "$SORTIE"/*.png; do
  [[ -e "$f" ]] || continue
  l=$(sips -g pixelWidth "$f" | awk '/pixelWidth/{print $2}')
  h=$(sips -g pixelHeight "$f" | awk '/pixelHeight/{print $2}')
  if [[ "$l" == "$attendu_l" && "$h" == "$attendu_h" ]]; then
    printf "  %-28s %s×%s\n" "$(basename "$f")" "$l" "$h" >&2
  else
    printf "  %-28s %s×%s  ← ATTENDU %s×%s\n" \
      "$(basename "$f")" "$l" "$h" "$attendu_l" "$attendu_h" >&2
    ok=false
  fi
done
$ok || { echo "Des captures n'ont pas la taille exigée." >&2; exit 1; }

say "Captures dans ${SORTIE#"$ROOT/"}/"
