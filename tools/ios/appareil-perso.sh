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

# shellcheck source=tools/ios/lib-appareil.sh
source "$ROOT/tools/ios/lib-appareil.sh"

trouver_l_appareil
trouver_l_equipe

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
