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

# `rustup` et `cargo` vivent dans ~/.cargo/bin, ajouté au PATH par le profil du shell — que
# ni un daemon lancé par nohup ni certains shells non interactifs ne chargent. Plutôt que de
# demander à chacun d'exporter le PATH avant d'appeler ce script, on le complète ici.
if ! command -v rustup >/dev/null && [[ -x "$HOME/.cargo/bin/rustup" ]]; then
  PATH="$HOME/.cargo/bin:$PATH"
  export PATH
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
IOS="$ROOT/apps/ios"
# Figé : les tests portent la même valeur par défaut (voir VaultFlowTests).
PORT=3111
EMAIL="clara@ghostpass.test"
PASSWORD="correct horse battery staple"
# Un second compte, sans coffre : c'est le contact de confiance de l'accès d'urgence.
# Sceller une clé vers quelqu'un suppose que ce quelqu'un existe déjà côté serveur — sa
# clé publique est la seule chose qui protège la nôtre.
CONTACT_EMAIL="kevin@ghostpass.test"
CONTACT_PASSWORD="un tout autre mot de passe de test"
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

# Arrête le serveur de *ce* run, et lui seul.
#
# `npm start` lance tsx dans un processus fils : tuer le sous-shell le laisserait orphelin
# à écouter le port. On le lance donc dans son propre groupe de processus (`set -m`) et on
# arrête le groupe entier — ce qui emporte le fils sans jamais toucher à autre chose.
#
# Ce qu'on ne fait plus : balayer le port au `lsof` pour tuer ce qui l'occupe. Un run qui
# refusait de démarrer *parce que* le port appartenait à quelqu'un d'autre abattait ensuite
# ce quelqu'un dans son nettoyage. Le 28 août 2026, un job de CI a ainsi détruit le serveur
# d'une suite locale en cours, qui a fini par quatre « serveur injoignable » accusant le
# code. Ne jamais tuer ce qu'on n'a pas lancé.
arreter_le_serveur() {
  [[ -n "$SERVER_PID" ]] || return 0
  kill -TERM -- "-$SERVER_PID" 2>/dev/null || kill "$SERVER_PID" 2>/dev/null || true
  SERVER_PID=""
}

cleanup() {
  local code=$?
  [[ -n "$BIO_PID" ]] && kill "$BIO_PID" 2>/dev/null || true
  [[ -n "$PAGE_PID" ]] && kill "$PAGE_PID" 2>/dev/null || true

  # Le remplissage se saute encore sur certaines versions d'iOS ; le test joint alors
  # l'écran qu'il a vu. On le remonte ici, sans quoi il resterait dans un journal que
  # personne n'ouvre.
  #
  # Le `&&` d'un `[[ -n "$PAGE_PID" ]]` traînait devant ce commentaire, ce qui rattachait
  # silencieusement le vidage du journal à la présence de la page de test — sans rapport.
  # Valide pour bash, d'où son passage inaperçu.
  if [[ -n "$DEVICE" ]]; then
    xcrun simctl spawn "$DEVICE" log show --last 5m --style compact \
      --predicate 'process == "GhostpassUITests-Runner"' 2>/dev/null |
      grep -a "GP-AUTOFILL" | head -40 >&2 || true
  fi
  arreter_le_serveur
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

# Ménage des simulateurs orphelins d'anciens runs.
#
# Le nettoyage de fin ne s'exécute pas si le script est tué sans ménagement (`kill -9`,
# machine qui redémarre). Le simulateur reste alors allumé et continue de consommer : trois
# orphelins ont fait monter la charge à 120 et expirer une prise de vue au bout de 180 s.
#
# Le nom porte le PID de son créateur, ce qui permet de ne supprimer que ceux dont le
# processus a disparu. On ne touche jamais à celui d'un run en cours — la règle est la même
# que pour le serveur : ne pas détruire ce qu'on n'a pas lancé.
while read -r nom identifiant; do
  pid="${nom##ghostpass-tests-}"
  [[ "$pid" =~ ^[0-9]+$ ]] || continue
  kill -0 "$pid" 2>/dev/null && continue
  xcrun simctl shutdown "$identifiant" >/dev/null 2>&1 || true
  xcrun simctl delete "$identifiant" >/dev/null 2>&1 &&
    echo "  simulateur orphelin supprimé : $nom" >&2
done < <(xcrun simctl list devices |
  sed -n 's/^ *\(ghostpass-tests-[0-9]*\) (\([0-9A-F-]\{36\}\)).*/\1 \2/p')

DEVICE="$(xcrun simctl create "ghostpass-tests-$$" "$DEVTYPE" "$RUNTIME")"
say "Simulateur éphémère $DEVICE ($DEVTYPE)"
xcrun simctl boot "$DEVICE" >/dev/null 2>&1 || true
# Par défaut le simulateur reste invisible : `xcodebuild` le pilote sans interface, ce qui
# est plus rapide et convient à la CI. Mais aucun clavier logiciel n'y apparaît, et la
# barre de remplissage automatique vit dans ce clavier — `test04Remplissage` s'y saute
# donc toujours. GHOSTPASS_SIMULATOR_VISIBLE=1 demande à Simulator.app d'afficher **cet**
# appareil : ouvrir l'application sans préciser l'identifiant montre le dernier utilisé,
# pas l'éphémère qu'on vient de créer.
if [[ "${GHOSTPASS_SIMULATOR_VISIBLE:-}" == "1" ]]; then
  say "Simulateur visible : $DEVICE"
  open -a Simulator --args -CurrentDeviceUDID "$DEVICE"
  sleep 8
fi
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

# Le remplissage automatique vit dans la barre d'accessoires du clavier : sans clavier
# logiciel, il n'y a pas de barre. Ce réglage demande au simulateur de ne pas se croire
# relié à un clavier matériel — mais il est lu par l'application Simulator, qui ne tourne
# pas dans une exécution sans interface. On le pose quand même, pour les lancements depuis
# Xcode ; `test04Remplissage` se saute en le disant quand aucun clavier ne paraît.
defaults write com.apple.iphonesimulator ConnectHardwareKeyboard -bool false 2>/dev/null || true

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

# GHOSTPASS_AUTOFILL_ONLY=1 : ne garder que ce dont `test04Remplissage` a besoin — le
# parcours complet, qui dépose une session dans le coffre, puis le remplissage lui-même.
# Quatre minutes au lieu de quinze. Les autres tests n'apprennent rien sur ce sujet, et
# attendre pour rien décourage de vérifier.
AUTOFILL_ONLY="${GHOSTPASS_AUTOFILL_ONLY:-0}"

# ── Tests de contrat ──────────────────────────────────────────────────────────
say "Tests de contrat"
[[ "$AUTOFILL_ONLY" == "1" ]] || run_tests GhostpassTests

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
# `set -m` le temps du lancement : le sous-shell devient chef de son propre groupe de
# processus, ce qui permet ensuite de l'arrêter avec sa descendance sans viser le port.
set -m
(cd "$ROOT/apps/server" && DB_PATH="$WORK/ghostpass.db" PORT="$PORT" npm start >"$WORK/server.log" 2>&1) &
SERVER_PID=$!
set +m

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

say "Amorçage du contact de confiance (compte seul, sans coffre)"
cargo run -q -p ghostpass-crypto-ffi --example seed-vault -- \
  "$CONTACT_EMAIL" "$CONTACT_PASSWORD" >"$WORK/contact.json"
SERVER_URL="$SERVER_URL" python3 - "$WORK/contact.json" <<'CONTACT'
import json, os, sys, urllib.request
base = os.environ["SERVER_URL"]
seed = json.load(open(sys.argv[1]))
req = urllib.request.Request(
    base + "/api/auth/register",
    data=json.dumps(seed["registration"]).encode(),
    headers={"Content-Type": "application/json"})
with urllib.request.urlopen(req) as r:
    r.read()
print("  contact créé")
CONTACT

# ── Parcours de bout en bout ──────────────────────────────────────────────────
say "Parcours de bout en bout"
# Pas d'environnement à passer : `xcodebuild` n'en propage aucun jusqu'au processus de
# test. Les tests connaissent ces valeurs par défaut ; c'est le contrat entre eux et ce
# script — d'où le port et le compte figés plus haut.
AUTRES_PARCOURS=(
  -only-testing:GhostpassUITests/VaultFlowTests/test02Biometrie
  -only-testing:GhostpassUITests/VaultFlowTests/test05Preferences
  -only-testing:GhostpassUITests/VaultFlowTests/test06Recuperation
  -only-testing:GhostpassUITests/VaultFlowTests/test07Urgence
)
[[ "$AUTOFILL_ONLY" == "1" ]] && AUTRES_PARCOURS=()

if ! run_tests GhostpassUITests/VaultFlowTests/test01ParcoursComplet \
  "${AUTRES_PARCOURS[@]}"; then
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
arreter_le_serveur
sleep 2

if [[ "$AUTOFILL_ONLY" != "1" ]] && ! run_tests GhostpassUITests/VaultFlowTests/test03HorsLigne; then
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

# `pluginkit -e use` enregistre l'extension, mais iOS exige en plus qu'elle soit cochée
# dans Réglages > Général > Saisie automatique — un geste qui ne se scripte pas. Cette
# pause laisse le faire à la main, simulateur visible, avant que le test ne s'exécute.
# Une pause *minutée*, et non une attente de touche : cette commande finit souvent en
# arrière-plan, où `read </dev/tty` échoue aussitôt et la laisse filer sans que personne
# n'ait eu la main. Le nombre de secondes est la valeur de la variable.
if [[ "${GHOSTPASS_PAUSE_REMPLISSAGE:-0}" -gt 0 ]]; then
  # « Toggle Software Keyboard » (Cmd-K) envoyé au simulateur : sous automatisation, iOS
  # se croit relié à un clavier matériel et n'affiche jamais le clavier logiciel — or la
  # barre de remplissage vit dedans. Le faire ici plutôt que de le demander à quelqu'un :
  # la pause tombe un quart d'heure après le lancement, et personne n'attend devant
  # l'écran pour appuyer sur deux touches.
  if [[ "${GHOSTPASS_SIMULATOR_VISIBLE:-}" == "1" ]]; then
    say "Bascule du clavier logiciel (Cmd-K)"
    # La frappe est adressée **au processus Simulator**, pas à « l'application au premier
    # plan » : envoyée sans cible, elle atteint n'importe quoi — y compris un test en train
    # de saisir un mot de passe, qui échoue alors sur « neither element nor any descendant
    # has keyboard focus ». Payé une fois.
    osascript -e 'tell application "Simulator" to activate' 2>/dev/null || true
    sleep 2
    osascript -e 'tell application "System Events" to tell process "Simulator" to keystroke "k" using command down' \
      2>/dev/null || say "Cmd-K refusé : autoriser le terminal dans Accessibilité"
    sleep 2
  fi

  say "Pause de ${GHOSTPASS_PAUSE_REMPLISSAGE} s avant le remplissage automatique."
  echo "  Deux gestes à faire dans le simulateur, dans cet ordre :" >&2
  echo "" >&2
  echo "  1. Cliquer dans la fenêtre du simulateur, puis Cmd-K — « Toggle Software" >&2
  echo "     Keyboard ». C'est le blocage principal : sous automatisation, iOS croit" >&2
  echo "     qu'un clavier matériel est branché et n'affiche jamais le clavier logiciel." >&2
  echo "     Or la barre de remplissage vit dans ce clavier." >&2
  echo "" >&2
  echo "  2. Réglages > Général > Saisie automatique : activer, et cocher GhostPass." >&2
  echo "     Ce réglage ne s'écrit pas par script — il vit dans un magasin système que" >&2
  echo "     \`defaults\` n'atteint pas. Il n'est utile qu'une fois le clavier obtenu :" >&2
  echo "     le test contrôle le clavier avant le fournisseur." >&2
  sleep "$GHOSTPASS_PAUSE_REMPLISSAGE"
fi

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
