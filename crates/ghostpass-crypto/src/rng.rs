//! Source unique d'aléa : le CSPRNG du système d'exploitation (`OsRng`),
//! ré-exporté par la couche AEAD pour rester compatible entre toutes les crates.

use chacha20poly1305::aead::rand_core::RngCore;
pub(crate) use chacha20poly1305::aead::OsRng;

/// Génère un tableau de `N` octets cryptographiquement aléatoires.
pub(crate) fn random_array<const N: usize>() -> [u8; N] {
    let mut buf = [0u8; N];
    OsRng.fill_bytes(&mut buf);
    buf
}
