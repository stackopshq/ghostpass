//! Générateur des bindings Swift/Kotlin. Appelé par `tools/ios/build-xcframework.sh`.
fn main() {
    uniffi::uniffi_bindgen_main()
}
