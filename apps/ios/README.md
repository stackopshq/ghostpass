# GhostPass iOS

Application native. Le chiffrement n'est pas réimplémenté en Swift : elle appelle le
même cœur Rust que la web app, à travers le binding UniFFI `ghostpass-crypto-ffi`.
Les clés restent côté Rust ; Swift ne détient qu'un `Account` opaque et du chiffré.

## Prérequis (macOS)

```sh
xcode-select --install
brew install xcodegen
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

## Construire

```sh
# 1. Le cœur en XCFramework + les bindings Swift (ajoute les cibles iOS au passage).
./tools/ios/build-xcframework.sh

# 2. Le projet Xcode, régénéré depuis project.yml.
cd apps/ios && xcodegen generate

# 3. Ouvrir, choisir un simulateur, lancer.
open Ghostpass.xcodeproj
```

Rien de ce que produisent ces trois commandes n'est versionné : `Ghostpass.xcodeproj`,
`Generated/`, `Headers/` et `GhostpassCrypto.xcframework/` sont ignorés. La description
du projet vit dans `project.yml`, qui se relit et se fusionne — contrairement à un
`.xcodeproj`, que deux personnes ne peuvent pas modifier sans conflit.

## Structure

| Chemin | Rôle |
|---|---|
| `Ghostpass/Model/` | Miroirs Swift du JSON que parle le cœur Rust (`VaultItem`, `ItemData`) |
| `Ghostpass/Services/APIClient.swift` | Routes du serveur : prelogin, login, CRUD du coffre |
| `Ghostpass/Services/Keychain.swift` | Jeton de session et blobs chiffrés, non exportables |
| `Ghostpass/Services/Biometrics.swift` | Disponibilité et nom de la biométrie (Face ID / Touch ID) |
| `Ghostpass/Assets.xcassets` | Icône, dérivée de `assets/logo/ghostpass.svg` |
| `Ghostpass/Services/VaultStore.swift` | État de l'app, passage de frontière chiffré/clair |
| `Ghostpass/Views/` | SwiftUI : déverrouillage, liste, détail, édition |

## Ce qui n'y est pas encore

- **Extension AutoFill** : cible séparée, à ajouter une fois l'app validée sur appareil.
- **Passkey (WebAuthn PRF)** : le binding l'expose (`Account.withPasskey`), l'app ne
  l'utilise pas encore. À ne pas confondre avec Face ID ci-dessous : la passkey déverrouille
  *sans* mot de passe maître, Face ID ne fait qu'en autoriser la relecture.
- **Organisations et accès d'urgence** : absents du binding tant qu'aucun écran n'en a besoin.
- **Corbeille** : la suppression est douce côté serveur, mais l'app n'affiche pas la corbeille.

## Points de vigilance

- L'item nommé `"\0gp:folders"` est un **registre interne** partagé avec la web app.
  Il est filtré de la liste ; l'afficher serait une régression visible.
- Passer l'app en arrière-plan **relâche les clés** (`VaultStore.lock()`). C'est
  volontaire : un coffre ouvert dans un téléphone qui circule n'est plus un coffre.
- **Face ID ne remplace pas le mot de passe maître.** Activé sur proposition explicite, il
  dépose le mot de passe maître dans le trousseau sous `.biometryCurrentSet` +
  `WhenPasscodeSetThisDeviceOnly` : rien ne sort par sauvegarde, et **enrôler un nouveau
  visage invalide l'entrée** — sans quoi qui connaît le code de l'appareil ouvrirait le
  coffre. Le déverrouillage reste une dérivation Argon2id faite par le cœur Rust ; la
  biométrie n'ouvre que le tiroir où dort le mot de passe. Un refus n'enferme personne :
  la saisie manuelle reste disponible.
- Les paramètres KDF transitent **verbatim** du serveur au cœur Rust. Le serveur les
  stocke en colonne TEXT : `kdfParams` est une *chaîne* contenant du JSON, jamais un
  objet JSON. La décoder pour la ré-encoder donnerait une chaîne doublement échappée,
  que `serde` rejette — d'où le `String` brut, comme dans la web app.
