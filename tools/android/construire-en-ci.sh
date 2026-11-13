#!/usr/bin/env bash
# Construit l'application Android comme le fait le job `android` de la CI, depuis une image
# Debian nue : JDK 21, SDK et NDK Android, le cœur Rust pour trois ABI, les tests de
# contrat sur la JVM, puis un APK et un AAB de diffusion **non signés**, et les contrôles
# qui lisent le paquet construit.
#
#   GHOSTSUITE=/chemin/vers/ghostsuite ./tools/android/construire-en-ci.sh
#
# Un script plutôt que du YAML : les mêmes étapes tournent sur un poste dans `podman run`,
# avant que quiconque attende un pipeline.
#
# ─── Pourquoi la diffusion sort non signée ici ───
#
# La clé d'envoi vit sur un seul poste, hors du dépôt (voir
# `apps/android/key.properties.example`). La CI ne la voit jamais : `signingConfig` vaut
# null, et AGP produit `app-release-unsigned.apk` et un AAB non signé. C'est voulu : un
# pipeline qui saurait signer saurait aussi publier une fausse mise à jour. Signer et
# déposer sur Play restent un geste manuel, décrit au §14 de `docs/android.md`.
set -euo pipefail

PRODUIT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
: "${GHOSTSUITE:?GHOSTSUITE doit désigner un clone du dépôt ghostsuite}"

# Épinglés, avec leur somme : un SDK téléchargé sans version est une cible mouvante, et la
# somme fait de « téléchargé » « téléchargé le fichier qu'on a relu ».
CMDLINE_TOOLS_BUILD="${CMDLINE_TOOLS_BUILD:-13114758}"
CMDLINE_TOOLS_SHA256="${CMDLINE_TOOLS_SHA256:-7ec965280a073311c339e571cd5de778b9975026cfcbe79f2b1cdcb1e15317ee}"
# Le NDK que nomme le message d'erreur de build-jni.sh, pour que les deux ne divergent pas.
NDK_VERSION="${NDK_VERSION:-28.2.13676358}"
# compileSdk / targetSdk de apps/android/app/build.gradle.kts.
ANDROID_PLATFORM="${ANDROID_PLATFORM:-android-36}"
BUILD_TOOLS="${BUILD_TOOLS:-36.0.0}"

export ANDROID_HOME="${ANDROID_HOME:-$PRODUIT/.android-sdk}"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export ANDROID_NDK_HOME="$ANDROID_HOME/ndk/$NDK_VERSION"

# ─── Paquets système ─────────────────────────────────────────────────────────
#
# JDK 21 exactement : gradle.properties dit pourquoi le 26 casse `jlink`. `binutils`
# apporte le `strings` avec lequel verifier-l-autonomie.sh lit le paquet.
if ! command -v javac >/dev/null || ! javac -version 2>&1 | grep -q ' 21\.'; then
  apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends \
    openjdk-21-jdk-headless unzip binutils >/dev/null
fi
export JAVA_HOME="${JAVA_HOME:-$(dirname "$(dirname "$(readlink -f "$(command -v javac)")")")}"
echo "JDK : $("$JAVA_HOME/bin/javac" -version 2>&1)"

# ─── SDK Android ─────────────────────────────────────────────────────────────
SDKMANAGER="$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager"
if [[ ! -x "$SDKMANAGER" ]]; then
  archive="$(mktemp)"
  curl -fsSL -o "$archive" \
    "https://dl.google.com/android/repository/commandlinetools-linux-${CMDLINE_TOOLS_BUILD}_latest.zip"
  echo "${CMDLINE_TOOLS_SHA256}  ${archive}" | sha256sum -c -
  mkdir -p "$ANDROID_HOME/cmdline-tools"
  unzip -q "$archive" -d "$ANDROID_HOME/cmdline-tools"
  mv "$ANDROID_HOME/cmdline-tools/cmdline-tools" "$ANDROID_HOME/cmdline-tools/latest"
  rm -f "$archive"
fi
# `yes` sort en SIGPIPE dès que sdkmanager cesse de lire ; sous `pipefail`, ce 141 ferait
# échouer le job après que toutes les licences ont été acceptées.
(yes || true) | "$SDKMANAGER" --licenses >/dev/null
"$SDKMANAGER" --install \
  "platforms;$ANDROID_PLATFORM" "build-tools;$BUILD_TOOLS" "ndk;$NDK_VERSION" >/dev/null
echo "NDK : $ANDROID_NDK_HOME"

# ─── Cœur Rust → .so pour trois ABI, liaisons Kotlin, bibliothèque hôte ─────
"$PRODUIT/tools/android/build-jni.sh"

# ─── Gradle ──────────────────────────────────────────────────────────────────
#
# `:coeur-hote:test` exécute les tests de contrat partagés sur la JVM, contre la
# compilation hôte du cœur. `assembleRelease` donne l'APK que lit le contrôle
# d'autonomie ; `bundleRelease` l'AAB que prend Play. Les deux non signés — voir l'en-tête.
cd "$PRODUIT/apps/android"
./gradlew --no-daemon --console=plain \
  :coeur-hote:test :app:assembleRelease :app:bundleRelease

APK="$PRODUIT/apps/android/app/build/outputs/apk/release/app-release-unsigned.apk"
AAB="$PRODUIT/apps/android/app/build/outputs/bundle/release/app-release.aab"
for f in "$APK" "$AAB"; do
  [[ -f "$f" ]] || { echo "Sortie attendue absente : $f" >&2; exit 1; }
done

# ─── Contrôles sur le paquet construit ───────────────────────────────────────
#
# Sur l'APK de diffusion, nommément : sans argument, le contrôle prend le premier APK
# trouvé, et celui que reçoit Play est celui-ci.
"$PRODUIT/tools/android/verifier-l-autonomie.sh" "$APK"
"$PRODUIT/tools/android/temoin-des-traductions.sh"

echo
echo "AAB (non signé) : ${AAB#"$PRODUIT"/} — $(du -h "$AAB" | cut -f1)"
