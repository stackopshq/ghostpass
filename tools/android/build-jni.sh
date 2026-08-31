#!/usr/bin/env bash
# Construit le cœur crypto en bibliothèques natives Android, liaisons Kotlin comprises.
#
# Sortie : apps/android/generated/jniLibs/<abi>/libghost_crypto_ffi.so
#          apps/android/generated/kotlin/uniffi/ghost_crypto_ffi/*.kt
#          apps/android/generated/jvmLibs/libghost_crypto_ffi.dylib  (voir plus bas)
# Prérequis : NDK Android (découvert plus bas) et les trois cibles Rust `*-linux-android`.
#
# C'est le pendant de tools/ios/build-xcframework.sh, et il fait les mêmes choix pour les
# mêmes raisons. Les liaisons Kotlin sont générées à partir de la bibliothèque *déjà
# compilée* (`--library`) et non d'un fichier UDL : la surface Kotlin décrit alors le
# binaire réellement embarqué, et pas une déclaration qui aurait divergé.
set -euo pipefail

# Le cœur cryptographique vit dans le dépôt de la suite, pas ici — une seule
# implémentation pour tous les produits, décision consignée dans son ADR 0001. Ce dépôt
# n'en garde donc aucune copie.
#
# `GHOSTSUITE` dit où le trouver ; par défaut, un clone voisin.
CRATE=ghost-crypto-ffi
LIB=libghost_crypto_ffi.so
PRODUIT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ROOT="${GHOSTSUITE:-$(cd "$PRODUIT/.." && pwd)/suite}"
if [[ ! -d "$ROOT/crates/$CRATE" ]]; then
  echo "Cœur commun introuvable : $ROOT/crates/$CRATE" >&2
  echo "Clonez git@git.stackops.ch:stackops/ghostsuite.git à côté de ce dépôt," >&2
  echo "ou indiquez son chemin :  GHOSTSUITE=/chemin/vers/ghostsuite $0" >&2
  exit 1
fi
# Tout ce que ce script produit tient dans un seul répertoire, ignoré par git : rien de
# ce qui suit n'est à versionner, exactement comme apps/ios/Generated.
OUT="$PRODUIT/apps/android/generated"
BUILD="$ROOT/target"

# `~/.cargo/bin` n'est pas dans le PATH d'un shell non interactif (Gradle, CI) : sans
# cette ligne, le script échoue sur « cargo: command not found » alors que cargo est bien
# installé.
export PATH="$HOME/.cargo/bin:$PATH"

# ─── Le NDK ───────────────────────────────────────────────────────────────────
#
# `cargo-ndk` est l'outil habituel pour cette compilation croisée. On s'en passe
# volontairement : tout ce qu'il apporte ici est le réglage des trois variables
# d'environnement ci-dessous, et l'exiger ajouterait un `cargo install` à la mise en route
# de chaque poste et de la CI. Le NDK seul suffit, à condition de connaître son piège —
# voir le nom des compilateurs plus bas.
SDK="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-$HOME/Library/Android/sdk}}"
if [[ -n "${ANDROID_NDK_HOME:-}" ]]; then
  NDK="$ANDROID_NDK_HOME"
else
  # Le plus récent des NDK installés. `sort -V` ordonne 9 avant 27, contrairement à `sort`.
  NDK="$(ls -d "$SDK"/ndk/*/ 2>/dev/null | sort -V | tail -1 || true)"
  NDK="${NDK%/}"
fi
if [[ -z "$NDK" || ! -d "$NDK/toolchains/llvm/prebuilt" ]]; then
  echo "NDK Android introuvable sous $SDK/ndk" >&2
  echo "Installez-le depuis Android Studio, ou indiquez son chemin :" >&2
  echo "  ANDROID_NDK_HOME=/chemin/vers/ndk/28.2.13676358 $0" >&2
  exit 1
fi
# Le NDK ne publie qu'une seule tranche par système hôte. Sur Apple Silicon elle
# s'appelle toujours `darwin-x86_64` et tourne sous Rosetta : ne pas la chercher sous
# `darwin-aarch64`, elle n'existe pas.
HOTE="$(ls "$NDK/toolchains/llvm/prebuilt" | head -1)"
BIN="$NDK/toolchains/llvm/prebuilt/$HOTE/bin"

# API 24 : le `minSdk` de l'application. Le compilateur du NDK porte ce numéro dans son
# nom — c'est lui qui fixe la version de la libc contre laquelle on lie.
API=24

# ─── Les trois architectures ──────────────────────────────────────────────────
#
# Trois colonnes, et la deuxième est le piège : le préfixe du compilateur NDK n'est pas
# le triplet Rust. `armv7-linux-androideabi` côté Rust se compile avec
# `armv7a-linux-androideabi24-clang` — un « a » en plus, et l'API collée au nom.
# S'y tromper donne un « linker not found » qui ne dit pas lequel manque.
CIBLES=(
  "aarch64-linux-android      aarch64-linux-android      arm64-v8a"
  "armv7-linux-androideabi    armv7a-linux-androideabi   armeabi-v7a"
  "x86_64-linux-android       x86_64-linux-android       x86_64"
)

cd "$ROOT"

for ligne in "${CIBLES[@]}"; do
  read -r triplet prefixe abi <<<"$ligne"
  rustup target add "$triplet" >/dev/null
  clang="$BIN/${prefixe}${API}-clang"
  if [[ ! -x "$clang" ]]; then
    echo "Compilateur NDK absent : $clang" >&2
    echo "Le NDK $NDK ne couvre peut-être pas l'API $API." >&2
    exit 1
  fi
  # Cargo lit le linker dans une variable dont le nom est le triplet en majuscules, tirets
  # remplacés par des soulignés. La crate `cc` accepte la même forme à soulignés — et il
  # faut la lui donner : `export CC_aarch64-linux-android=…` est refusé par le shell,
  # « identifiant non valable », un tiret n'ayant rien à faire dans un nom de variable.
  majuscule="$(echo "$triplet" | tr 'a-z-' 'A-Z_')"
  souligne="$(echo "$triplet" | tr '-' '_')"
  export "CARGO_TARGET_${majuscule}_LINKER=$clang"
  export "CC_${souligne}=$clang"
  export "AR_${souligne}=$BIN/llvm-ar"

  # `--lib` seulement : le binaire `uniffi-bindgen` est un outil d'hôte, il n'a rien à
  # faire dans une compilation croisée vers Android.
  cargo build --release --lib -p "$CRATE" --target "$triplet"

  mkdir -p "$OUT/jniLibs/$abi"
  cp "$BUILD/$triplet/release/$LIB" "$OUT/jniLibs/$abi/$LIB"
done

# ─── Les liaisons Kotlin ──────────────────────────────────────────────────────
#
# `--library` prend l'une des bibliothèques qu'on vient de produire : les métadonnées
# UniFFI sont les mêmes dans les trois, c'est le code machine qui diffère.
KOTLIN="$OUT/kotlin"
rm -rf "$KOTLIN"
mkdir -p "$KOTLIN"
cargo run --release --bin uniffi-bindgen -- generate \
  --library "$BUILD/aarch64-linux-android/release/$LIB" \
  --language kotlin \
  --out-dir "$KOTLIN"

# ─── La collision Kotlin, corrigée en amont le 2026-08-31 ─────────────────────
#
# Il y avait ici un rattrapage : `GhostCryptoError` portait un champ nommé `message`, et
# le générateur Kotlin produisait une classe étendant `Exception` avec un `val message`
# **et** un `override val message` — que le compilateur refuse. Côté Swift, le même code
# compilait parfaitement.
#
# C'est la classe d'erreur qui vaut d'être retenue : **un contrôle qui ne regarde qu'une
# plateforme est vert pendant que l'autre est cassée.** Les noms pris par `Throwable` —
# `message`, `cause`, `stackTrace`, `suppressed` — sont à éviter dans les types d'erreur
# du cœur, et rien du côté Swift ne le signalera.
#
# La correction est allée là où elle devait : le champ s'appelle `raison` dans le cœur
# commun (ghostsuite, 327581d). Le rattrapage local a donc disparu — et il a disparu
# parce qu'il **échouait bruyamment** quand son motif s'évanouissait, au lieu de
# s'appliquer à vide. Sans ce garde, il serait encore là, inutile et invisible.

# ─── La même bibliothèque, pour l'hôte ────────────────────────────────────────
#
# Une quatrième compilation, vers la machine de développement cette fois. Elle ne part
# dans aucun APK : elle permet d'exécuter les tests de contrat sur la JVM du poste, sans
# appareil ni émulateur. Les liaisons Kotlin sont les mêmes — JNA charge un `.dylib` là où
# il chargerait un `.so` — donc le test éprouve réellement la traversée Rust → Kotlin.
#
# Ce n'est pas un substitut au test instrumenté : il ne dit rien de l'empaquetage des
# `.so` dans l'APK ni du chargeur d'Android. Il dit que le cœur et les liaisons
# s'accordent, et c'est ce qui casse en silence.
HOTE_TRIPLET="$(rustc -vV | awk '/^host:/ {print $2}')"
case "$(uname -s)" in
  Darwin) HOTE_LIB=libghost_crypto_ffi.dylib ;;
  *)      HOTE_LIB=libghost_crypto_ffi.so ;;
esac
cargo build --release --lib -p "$CRATE"
mkdir -p "$OUT/jvmLibs"
cp "$BUILD/release/$HOTE_LIB" "$OUT/jvmLibs/$HOTE_LIB"

echo
echo "Bibliothèques natives : $OUT/jniLibs"
ls "$OUT/jniLibs"
echo "Bibliothèque hôte ($HOTE_TRIPLET) : $OUT/jvmLibs/$HOTE_LIB"
echo "Liaisons Kotlin : $KOTLIN"
find "$KOTLIN" -name '*.kt' | sed "s|^|  |"
