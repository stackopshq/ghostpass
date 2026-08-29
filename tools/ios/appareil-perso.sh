#!/usr/bin/env bash
# Pose l'application sur un iPhone branché, signée avec une **équipe personnelle**.
#
# Une équipe personnelle — un simple identifiant Apple, sans adhésion payante — ne peut
# pas provisionner le groupe d'applications ni le fournisseur d'identifiants : Xcode
# répond « the selected team does not have a program membership that is eligible for this
# feature ». `project-perso.yml` retire donc ces deux habilitations et suffixe les
# identifiants ; l'application fonctionne sans elles, `SharedStore` retombant sur son
# conteneur privé. Seul le remplissage automatique reste hors de portée.
#
#   ./tools/ios/appareil-perso.sh
#
# La signature vaut **sept jours**. Passé ce délai l'application refuse de se lancer :
# relancer ce script suffit, il n'y a rien à désinstaller.
set -euo pipefail

# rustup n'est pas dans le PATH d'un shell non interactif : `build-xcframework.sh` en a
# besoin, et sans cette ligne il sortait en 127 — « commande introuvable » — que le
# masquage de sa sortie rendait indéchiffrable.
if ! command -v cargo >/dev/null && [[ -x "$HOME/.cargo/bin/cargo" ]]; then
  PATH="$HOME/.cargo/bin:$PATH"
  export PATH
fi

for outil in xcodebuild xcrun xcodegen cargo; do
  command -v "$outil" >/dev/null || { echo "$outil introuvable dans le PATH." >&2; exit 1; }
done

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
IOS="$ROOT/apps/ios"

say() { printf "\n\033[1m▸ %s\033[0m\n" "$*" >&2; }

# ── L'appareil ────────────────────────────────────────────────────────────────
# Découvert, pas codé en dur : le script doit servir à quelqu'un d'autre, avec un autre
# téléphone.
DEVICE="$(xcrun devicectl list devices 2>/dev/null |
  awk '/connected/ && !/no DDI/ {print $3; exit}')"
if [[ -z "$DEVICE" ]]; then
  echo "Aucun iPhone utilisable n'est branché." >&2
  echo >&2
  echo "  1. Brancher le téléphone en USB — avec un câble de données, pas d'alimentation." >&2
  echo "  2. Le déverrouiller et répondre « Se fier » à l'alerte." >&2
  echo "  3. Activer Réglages > Confidentialité et sécurité > Mode développeur." >&2
  echo "     Ce menu n'apparaît qu'après une première tentative depuis Xcode." >&2
  echo >&2
  echo "État vu par le Mac :" >&2
  xcrun devicectl list devices 2>&1 | sed -n '1,6p' >&2
  exit 1
fi
say "Appareil : $DEVICE"

# ── L'équipe ──────────────────────────────────────────────────────────────────
# Lue depuis le certificat de développement, dont le champ OU porte l'identifiant
# d'équipe. Xcode le crée au premier build vers un appareil ; s'il manque, c'est que ce
# premier build n'a jamais eu lieu.
EQUIPE="${DEVELOPMENT_TEAM:-}"
if [[ -z "$EQUIPE" ]]; then
  EQUIPE="$(security find-certificate -c "Apple Development" -p 2>/dev/null |
    openssl x509 -noout -subject 2>/dev/null |
    tr ',' '\n' | awk -F= '/OU/ {gsub(/ /, "", $2); print $2; exit}')"
fi
if [[ -z "$EQUIPE" ]]; then
  echo "Aucun certificat « Apple Development » dans le trousseau." >&2
  echo "Xcode le crée au premier build vers un appareil : ouvrez" >&2
  echo "apps/ios/Ghostpass.xcodeproj, choisissez votre équipe personnelle sur les deux" >&2
  echo "cibles, lancez une fois, puis revenez ici." >&2
  exit 1
fi
say "Équipe : $EQUIPE"

# ── Construction et pose ──────────────────────────────────────────────────────
say "Bindings et projet"
PREPARE="$(mktemp)"
if ! "$ROOT/tools/ios/build-xcframework.sh" >"$PREPARE" 2>&1; then
  echo "La construction de l'XCFramework a échoué :" >&2
  tail -20 "$PREPARE" >&2
  rm -f "$PREPARE"
  exit 1
fi
rm -f "$PREPARE"
(cd "$IOS" && xcodegen generate --spec project-perso.yml >/dev/null)

say "Construction pour l'appareil"
JOURNAL="$(mktemp)"
trap 'rm -f "$JOURNAL"' EXIT
if ! xcodebuild -project "$IOS/GhostpassPerso.xcodeproj" -scheme Ghostpass \
  -destination "platform=iOS,id=$DEVICE" -derivedDataPath "$IOS/.build-perso" \
  DEVELOPMENT_TEAM="$EQUIPE" -allowProvisioningUpdates build >"$JOURNAL" 2>&1; then
  echo "La construction a échoué :" >&2
  grep -aE "error:|Signing for" "$JOURNAL" | head -10 >&2
  exit 1
fi

APP="$(find "$IOS/.build-perso/Build/Products" -name "Ghostpass.app" -maxdepth 3 | head -1)"
[[ -n "$APP" ]] || { echo "Application introuvable après construction." >&2; exit 1; }

say "Installation"
xcrun devicectl device install app --device "$DEVICE" "$APP" 2>&1 |
  grep -E "App installed|bundleID|error" >&2

cat >&2 <<'FIN'

Si l'application refuse de se lancer, le certificat n'est pas encore approuvé :
Réglages > Général > VPN et gestion de l'appareil > votre compte > Se fier.

Le remplissage automatique ne fonctionnera pas — cette variante n'a pas le groupe
d'applications, et l'extension le dit désormais au lieu de proposer d'ouvrir GhostPass.
FIN
