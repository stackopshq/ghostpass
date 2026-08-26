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

## Tests

```sh
./tools/ios/run-ios-tests.sh              # tout : contrat + parcours de bout en bout
./tools/ios/run-ios-tests.sh --unit-only  # contrat seulement, quelques secondes
```

**En intégration continue, ces tests dépendent d'un runner macOS** : Xcode et le
simulateur n'existent pas ailleurs. Le job vit dans `.gitea/workflows/ci.yml` et attend un
runner étiqueté `macos` — `tools/ci/README.md` explique comment en brancher un, ce que cela
engage, et ce qui distingue un poste prêté en dépannage d'une machine dédiée. Il est piloté par la variable de dépôt `MACOS_RUNNER` : tant qu'elle n'est pas
à `true`, le job est ignoré et **les tests se lancent à la main avant toute pull request
touchant à l'application**.

Le script se suffit à lui-même : il construit l'XCFramework, crée un **simulateur
éphémère** (le trousseau d'un simulateur survit à la désinstallation — sans cela un run
hériterait des choix du précédent), démarre un serveur GhostPass sur SQLite jetable,
amorce un compte de test, puis nettoie tout. En cas d'échec, les rapports restent dans
`apps/ios/TestResults/` ; la CI les publie en artefact.

| Cible | Ce qu'elle couvre |
|---|---|
| `Tests/` | **Contrat** : décodage des réponses du serveur, aller-retour d'un `VaultItem` à travers le vrai binding Rust, filtrage du registre `gp:folders`, refus d'activer la biométrie sur un mot de passe faux. Ni réseau ni interface, moins d'une seconde. |
| `UITests/` | **Parcours réel** : connexion, liste, création, modification, suppression, verrouillage, réouverture au seul mot de passe maître — et l'absence de ligne fantôme à chaque étape. Puis, serveur éteint, la réouverture hors ligne ; enfin un remplissage dans Safari, de la page de connexion au formulaire rempli. |

Les deux régressions qui rendaient l'application inutilisable (paramètres KDF pris pour un
objet JSON, horodatages pris pour des chaînes) sont des divergences de contrat : elles sont
tenues par `Tests/`, qui les rattraperait en une seconde et sans simulateur.

Elles le sont **aussi côté serveur**, par `apps/server/test/api-shape.test.ts`, qui vérifie
la forme des réponses — types, pas valeurs. C'est l'autre bout de la même couture, et le
seul qui tourne en intégration continue : ces tests-là n'ont besoin ni de Xcode ni de
simulateur. Un changement de serveur qui casserait le contrat serait donc arrêté avant
d'atteindre l'application, même sans runner macOS.

**Limite connue** : le déverrouillage biométrique de bout en bout n'est pas exerçable de
façon fiable dans le simulateur — l'inscription simulée (`BiometricKit.enrollmentChanged`)
ne survit pas toujours au recyclage que fait `xcodebuild`. Quand l'application ne voit pas
de biométrie, `test02Biometrie` **s'ignore explicitement** plutôt que de passer au vert
sans rien avoir exercé. Ce qui reste couvert sans elle : le refus d'activer sur un mot de
passe faux, et le fait qu'aucune session n'autorise l'activation.

## Structure

| Chemin | Rôle |
|---|---|
| `Ghostpass/Model/` | Miroirs Swift du JSON que parle le cœur Rust (`VaultItem`, `ItemData`) |
| `Ghostpass/Services/APIClient.swift` | Routes du serveur : prelogin, login, CRUD du coffre |
| `Ghostpass/Services/Keychain.swift` | Jeton de session et blobs chiffrés, non exportables |
| `Ghostpass/Services/Biometrics.swift` | Disponibilité et nom de la biométrie (Face ID / Touch ID) |
| `Ghostpass/Services/VaultCache.swift` | Copie locale du coffre, déjà chiffrée : le coffre s'ouvre sans réseau |
| `Ghostpass/Services/PasswordGenerator.swift` | Générateur, transposition de `apps/web/src/lib/generator.ts` |
| `Ghostpass/Services/Totp.swift` | Codes TOTP (RFC 6238), transposition de `apps/web/src/lib/totp.ts` |
| `Ghostpass/Services/Clipboard.swift` | Copie de secrets, toujours avec expiration |
| `Ghostpass/Services/SharedStore.swift` | Ce que l'app dépose pour l'extension : session et blobs |
| `Ghostpass/Services/SiteMatching.swift` | Rapprochement site ↔ adresses d'un item |
| `Ghostpass/Services/CredentialIdentities.swift` | Inscription des identifiants auprès d'iOS |
| `GhostpassAutoFill/` | L'extension de remplissage : écran, état, point d'entrée |
| `Ghostpass/Assets.xcassets` | Icône : la marque de GhostPass, cadenas et dégradé d'accent |
| `Ghostpass/Services/VaultStore.swift` | État de l'app, passage de frontière chiffré/clair |
| `Ghostpass/Theme/` | Le système visuel de la suite : palette, surfaces, composants |
| `Ghostpass/Views/` | SwiftUI : déverrouillage, liste, détail, édition, corbeille, générateur |

## Hors ligne

Le coffre s'ouvre sans réseau. `VaultCache` conserve sur l'appareil les blobs **tels que
le serveur les stocke** — déjà chiffrés, inutilisables sans l'USK — sous
`.completeFileProtection`. Au déverrouillage, la copie locale s'affiche d'abord ; le
serveur reprend la main dès qu'il répond, et un bandeau signale l'écart.

En revanche **écrire suppose le serveur** : il n'y a pas de file d'attente hors ligne.
Une création ou une suppression sans réseau est refusée avec un message explicite, plutôt
que d'être acceptée en apparence puis perdue.

## Remplissage automatique

L'extension `GhostpassAutoFill` fournit les identifiants aux autres applications et à
Safari. C'est un **processus séparé**, lancé par iOS au moment où un champ réclame un
identifiant : elle ne voit de GhostPass que ce qui a été déposé dans le groupe
d'applications `group.ch.stackops.ghostpass` — le coffre chiffré et les blobs
d'ouverture. Elle ne parle jamais au serveur : un remplissage doit aboutir en quelques
secondes, réseau ou pas.

Elle réclame le mot de passe maître (ou Face ID), déchiffre la copie locale, et présente
d'abord les identifiants du site en cours. Le rapprochement entre le site et les adresses
d'un item vit dans `SiteMatching`, partagé avec l'application : une seule règle, pour que
les suggestions ne dépendent pas de l'endroit d'où l'on regarde.

Pour l'activer sur un appareil : Réglages > Apps > Mots de passe > Remplissage
automatique > GhostPass.

**Sur appareil réel**, deux points restent à régler et n'ont pas pu être vérifiés ici :
le groupe d'applications et l'entitlement AutoFill demandent une équipe de développement
(`DEVELOPMENT_TEAM`), et le trousseau n'est **pas** partagé entre l'application et son
extension — il faudra un `keychain-access-groups` commun pour que Face ID fonctionne
aussi côté remplissage. Sans lui, l'extension demandera le mot de passe maître.

## Ce qui n'y est pas encore

- **Passkey (WebAuthn PRF)** : le binding l'expose (`Account.withPasskey`), l'app ne
  l'utilise pas encore. À ne pas confondre avec Face ID ci-dessous : la passkey déverrouille
  *sans* mot de passe maître, Face ID ne fait qu'en autoriser la relecture.
- **Organisations et accès d'urgence** : absents du binding tant qu'aucun écran n'en a besoin.
- **Corbeille** : la suppression est douce côté serveur, mais l'app n'affiche pas la corbeille.
- **Modifications hors ligne** : lecture oui, écriture non — pas de file de synchronisation.
- **Santé du coffre** (mots de passe faibles, réutilisés, compromis) : le web a `breach.ts`, pas l'iOS.
- **Localisation** : l'interface est en français, sans catalogue de traductions.

## Apparence

L'interface reprend le système visuel de la suite, transposé de
`ghostcal/frontend/src/app/globals.css` : nuit profonde, surfaces de verre fumé, halo
diffusé depuis le haut, intitulés en petites capitales espacées. Les produits partagent
cette structure et ne se distinguent que par leur accent, qui est **la teinte de leur
logo** — ici le violet `#7B4DFF`, avec sa variante claire `#B79CFF` pour ce qui doit
rester lisible sur fond sombre.

Tout vit dans `Ghostpass/Theme/Theme.swift` : couleurs, mesures, et les quelques
composants qui font le vocabulaire commun (`GhostScreen`, `GhostSection`, `GhostRow`,
`GlassCard`, les styles de boutons et de champs). Les deux palettes existent, comme sur
le web ; on suit le réglage du système plutôt que d'imposer l'une des deux — mais le
sombre est la teinte d'origine, et c'est là que l'ensemble prend son sens.

## Points de vigilance

- **L'icône vient du logo officiel**, `assets/logo/favicon.svg` — la variante *remplie*
  du logo de la suite, celle qu'emploie ghostboard. Le logo au trait
  (`assets/logo/ghostpass.svg`) ne convient pas : son trait fait 4 % de la hauteur et
  disparaît aux petites tailles, comme l'explique le fichier lui-même.
  `tools/ios/make-app-icon.sh` la régénère. Il n'écarte de la source que sur deux points,
  documentés dans le script : le cadrage est recentré sur le tracé — aligné en haut, le
  fantôme n'a que 9 px de marge au-dessus contre 52 en dessous et frôlerait le bord sous
  le masque arrondi — et le fond est aplati en blanc, une icône d'application ne pouvant
  pas être transparente.
  Les logos sont **générés** par `tools/brand/ghost_suite.py` et portent la mention « ne
  pas éditer à la main » : ne pas les retoucher ici.
- **Face ID ne remplace pas le mot de passe maître.** Activé sur proposition explicite, il
  dépose le mot de passe maître dans le trousseau sous `.biometryCurrentSet` +
  `WhenPasscodeSetThisDeviceOnly` : rien ne sort par sauvegarde, et **enrôler un nouveau
  visage invalide l'entrée** — sans quoi qui connaît le code de l'appareil ouvrirait le
  coffre. Le déverrouillage reste une dérivation Argon2id faite par le cœur Rust ; la
  biométrie n'ouvre que le tiroir où dort le mot de passe. Un refus n'enferme personne :
  la saisie manuelle reste disponible, et le menu du coffre permet d'activer ou de retirer
  le déverrouillage biométrique à tout moment. Activer à froid **redemande** le mot de
  passe maître et le vérifie en rouvrant réellement le coffre : on ne confie au trousseau
  qu'un secret dont on sait qu'il ouvre.
- **Le presse-papiers expire.** Toute copie de secret porte une date d'expiration
  (`Clipboard.lifetime`, 30 s) : le presse-papiers d'iOS est lisible par n'importe quelle
  application au premier plan et se synchronise entre appareils iCloud. Un mot de passe
  qui y resterait jusqu'à la copie suivante serait un mot de passe posé sur la table.
- **Le générateur et le TOTP n'utilisent pas le cœur Rust** — il n'expose ni l'un ni
  l'autre, et la web app fait de même en TypeScript. Ils s'appuient sur les primitives du
  système (`SecRandomCopyBytes`, CryptoKit), comme la web app s'appuie sur WebCrypto :
  rien de cryptographique n'est réimplémenté ici, et les secrets ne quittent pas l'appareil.
- Les paramètres KDF transitent **verbatim** du serveur au cœur Rust. Le serveur les
  stocke en colonne TEXT : `kdfParams` est une *chaîne* contenant du JSON, jamais un
  objet JSON. La décoder pour la ré-encoder donnerait une chaîne doublement échappée,
  que `serde` rejette — d'où le `String` brut, comme dans la web app.
