#!/usr/bin/env bash
# Pose l'application **complète** sur un iPhone branché : extension de remplissage
# comprise, avec le groupe d'applications.
#
#   ./tools/ios/appareil.sh
#
# ─── Ce qu'il suppose ───
#
# Une **adhésion payante**. Une équipe personnelle ne peut provisionner ni le groupe
# d'applications ni le fournisseur d'identifiants — Xcode répond « the selected team does
# not have a program membership that is eligible for this feature ».
#
# Il a existé pour cette raison une variante « équipe personnelle », qui posait
# l'application seule sous un identifiant suffixé `.essai`. Elle a été supprimée le
# 14 septembre 2026, le remplissage automatique ayant enfin été éprouvé sur un iPhone.
# Elle laisse deux leçons : c'est son identifiant suffixé qui avait causé le décalage de
# schéma SSO du 31 août, et c'est elle qui avait immobilisé le groupe
# `group.ch.stackops.ghostpass` sous une équipe personnelle — identifiant que le compte
# payant n'a jamais pu récupérer, seulement contourner en le suffixant `.coffre`.
#
# ─── Ce qu'il ne prouve pas ───
#
# Poser l'application n'est pas éprouver le remplissage. Après l'installation, il reste
# **un geste manuel** que rien ici ne remplace : Réglages > Général > Saisie automatique
# et mots de passe > activer GhostPass. Tant qu'il n'est pas fait, l'extension n'est
# jamais appelée — et l'absence de proposition ressemble trait pour trait à un défaut de
# l'extension.
set -euo pipefail

if ! command -v rustup >/dev/null && [[ -x "$HOME/.cargo/bin/rustup" ]]; then
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

say "Bindings et projet"
PREPARE="$(mktemp)"
if ! "$ROOT/tools/ios/build-xcframework.sh" >"$PREPARE" 2>&1; then
  echo "La construction de l'XCFramework a échoué :" >&2
  tail -20 "$PREPARE" >&2
  rm -f "$PREPARE"
  exit 1
fi
rm -f "$PREPARE"
(cd "$IOS" && xcodegen generate --spec project.yml >/dev/null)

say "Construction pour l'appareil"
JOURNAL="$(mktemp)"
trap 'rm -f "$JOURNAL"' EXIT
if ! xcodebuild -project "$IOS/Ghostpass.xcodeproj" -scheme Ghostpass \
  -destination "platform=iOS,id=$DEVICE" -derivedDataPath "$IOS/.build-appareil" \
  DEVELOPMENT_TEAM="$EQUIPE" -allowProvisioningUpdates build >"$JOURNAL" 2>&1; then
  echo "La construction a échoué :" >&2
  grep -aE "error:|Signing for" "$JOURNAL" | head -10 >&2
  # Le message d'Apple est explicite mais noyé : on le remonte avec sa traduction.
  if grep -qa "program membership that is eligible" "$JOURNAL"; then
    echo >&2
    echo "L'équipe $EQUIPE n'a pas d'adhésion payante : elle ne peut provisionner ni le" >&2
    echo "groupe d'applications ni le fournisseur d'identifiants. Précisez l'équipe" >&2
    echo "d'entreprise :" >&2
    echo >&2
    echo "  DEVELOPMENT_TEAM=XXXXXXXXXX $0" >&2
  fi
  exit 1
fi

APP="$(find "$IOS/.build-appareil/Build/Products" -name "Ghostpass.app" -maxdepth 3 | head -1)"
[[ -n "$APP" ]] || { echo "Application introuvable après construction." >&2; exit 1; }

# L'extension voyage **dans** l'application ; si elle manque, l'installation réussira et
# le remplissage n'apparaîtra jamais dans les réglages d'iOS, sans un mot d'explication.
# On regarde donc avant de poser, plutôt que de chercher ensuite pourquoi rien ne vient.
if [[ ! -d "$APP/PlugIns/GhostpassAutoFill.appex" ]]; then
  echo "L'extension de remplissage n'est pas dans le paquet construit." >&2
  echo "La cible GhostpassAutoFill est-elle bien dans project.yml et embarquée ?" >&2
  exit 1
fi

say "Installation"
xcrun devicectl device install app --device "$DEVICE" "$APP" 2>&1 |
  grep -E "App installed|bundleID|error" >&2

cat >&2 <<'FIN'

Reste un geste que ce script ne peut pas faire, et sans lequel l'extension ne sera
jamais appelée :

  Réglages > Général > Saisie automatique et mots de passe
  → activer GhostPass, et décocher « Trousseau iCloud » si les deux se disputent le champ.

Si l'application refuse de se lancer, le certificat n'est pas encore approuvé :
Réglages > Général > VPN et gestion de l'appareil > votre compte > Se fier.
FIN
