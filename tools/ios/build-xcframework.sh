#!/usr/bin/env bash
# Construit le cœur crypto en XCFramework consommable par Xcode, bindings Swift compris.
#
# Sortie : apps/ios/GhostpassCrypto.xcframework + apps/ios/Generated/*.swift
# Prérequis : macOS avec Xcode (pour `xcodebuild -create-xcframework` et `lipo`).
#
# Les bindings Swift sont générés à partir de la bibliothèque *déjà compilée*
# (`--library`) et non d'un fichier UDL : c'est ce qui garantit que la surface Swift
# décrit le binaire réellement embarqué, et pas une déclaration qui aurait divergé.
set -euo pipefail

CRATE=ghostpass-crypto-ffi
LIB=libghostpass_crypto_ffi.a
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT="$ROOT/apps/ios"
BUILD="$ROOT/target"

cd "$ROOT"

for target in aarch64-apple-ios aarch64-apple-ios-sim x86_64-apple-ios; do
  rustup target add "$target" >/dev/null
  # `--lib` seulement : le binaire `uniffi-bindgen` est un outil d'hôte, il n'a
  # rien à faire dans une compilation croisée vers iOS.
  cargo build --release --lib -p "$CRATE" --target "$target"
done

# Le simulateur doit accepter les deux architectures (Apple Silicon et Intel),
# et un XCFramework n'admet qu'une tranche par plateforme : d'où le `lipo`.
SIM="$BUILD/ios-simulator"
mkdir -p "$SIM"
lipo -create \
  "$BUILD/aarch64-apple-ios-sim/release/$LIB" \
  "$BUILD/x86_64-apple-ios/release/$LIB" \
  -output "$SIM/$LIB"

rm -rf "$OUT/Generated" "$OUT/Headers" "$OUT/GhostpassCrypto.xcframework"
mkdir -p "$OUT/Generated" "$OUT/Headers"

cargo run --release --bin uniffi-bindgen -- generate \
  --library "$BUILD/aarch64-apple-ios/release/$LIB" \
  --language swift \
  --out-dir "$OUT/Generated"

# Xcode exige que la carte de modules s'appelle `module.modulemap` et voisine les en-têtes.
mv "$OUT/Generated"/*.h "$OUT/Headers/"
mv "$OUT/Generated"/*.modulemap "$OUT/Headers/module.modulemap"

xcodebuild -create-xcframework \
  -library "$BUILD/aarch64-apple-ios/release/$LIB" -headers "$OUT/Headers" \
  -library "$SIM/$LIB" -headers "$OUT/Headers" \
  -output "$OUT/GhostpassCrypto.xcframework"

echo "XCFramework : $OUT/GhostpassCrypto.xcframework"
echo "Bindings Swift : $OUT/Generated"
