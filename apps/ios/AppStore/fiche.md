# Fiche App Store — GhostPass

Textes prêts à coller dans App Store Connect. **Rien ici n'est une promesse commerciale
que le code ne tiendrait pas** : chaque affirmation renvoie à une fonctionnalité livrée.

> Les mentions entre crochets restent à trancher : elles engagent l'entreprise, pas le
> dépôt.

## Identité

| Champ | Valeur |
|---|---|
| Nom | GhostPass |
| Sous-titre (30 car. max) | Vos mots de passe, chiffrés |
| Catégorie principale | Utilitaires |
| Catégorie secondaire | Productivité |
| Classification d'âge | 4+ |
| Prix | [à trancher] |

Le sous-titre fait 27 caractères. Deux variantes de repli, si celle-ci déplaît :
« Coffre-fort de mots de passe » (28), « Chiffré de bout en bout » (23).

## Description (français)

GhostPass garde vos mots de passe, vos notes et vos cartes dans un coffre que vous seul
pouvez ouvrir.

Le chiffrement a lieu sur votre appareil, avec une clé dérivée de votre mot de passe
maître. Ce mot de passe ne quitte jamais l'iPhone, et nous ne le connaissons pas. Le
serveur héberge des données qu'il ne sait pas lire — ce n'est pas une politique interne,
c'est une impossibilité technique.

REMPLISSAGE AUTOMATIQUE
Vos identifiants s'insèrent depuis le clavier, dans Safari comme dans vos applications.
Les codes à usage unique aussi : GhostPass les calcule sur l'appareil et les propose au
bon champ.

SANTÉ DU COFFRE
Mots de passe trop courts, réutilisés, sans second facteur : le coffre se relit et vous
dit quoi reprendre. La vérification des fuites connues n'envoie jamais votre mot de
passe — seuls les cinq premiers caractères de son empreinte partent, et la comparaison se
fait sur l'appareil.

PARTAGE PONCTUEL
Un lien qui expire, à la date que vous fixez ou après le nombre de consultations que vous
choisissez. La clé voyage après le dièse : elle n'est jamais transmise au serveur.

COFFRES D'ÉQUIPE
Des collections partagées, des groupes, et la possibilité de voir qui a accès à quoi —
puis de le reprendre. Retirer quelqu'un renouvelle la clé de l'équipe.

ACCÈS D'URGENCE
Confiez à un proche la possibilité d'ouvrir votre coffre après un délai que vous fixez, et
pendant lequel vous pouvez refuser.

HORS LIGNE
Le coffre s'ouvre sans réseau. Une copie chiffrée reste sur l'appareil.

Face ID ou Touch ID déverrouillent le coffre. Import depuis Bitwarden, Dashlane, 1Password,
LastPass, Chrome. Export de vos données, à tout moment, en clair et sans condition.

Aucun traceur. Aucune publicité. Aucune analyse comportementale.

## Description (anglais)

GhostPass keeps your passwords, notes and cards in a vault only you can open.

Encryption happens on your device, with a key derived from your master password. That
password never leaves your iPhone, and we do not know it. The server holds data it cannot
read — not as a matter of policy, but as a technical impossibility.

AUTOFILL
Your credentials are inserted straight from the keyboard, in Safari and in your apps.
One-time codes too: GhostPass computes them on device and offers them to the right field.

VAULT HEALTH
Passwords that are too short, reused, or lack a second factor: the vault reviews itself
and tells you what to fix. The breach check never sends your password — only the first
five characters of its hash leave the device, and the comparison happens locally.

ONE-TIME SHARING
A link that expires, on the date you set or after the number of views you choose. The key
travels after the hash sign: it is never sent to the server.

TEAM VAULTS
Shared collections, groups, and a clear view of who has access to what — and how to take
it back. Removing someone rotates the team key.

EMERGENCY ACCESS
Entrust someone with the ability to open your vault after a delay you set, during which
you can refuse.

OFFLINE
The vault opens without a network. An encrypted copy stays on the device.

Face ID or Touch ID unlock the vault. Import from Bitwarden, Dashlane, 1Password,
LastPass, Chrome. Export your data, at any time, in the clear and without conditions.

No trackers. No ads. No behavioural analytics.

## Mots-clés (100 caractères, virgules comprises)

```
mot de passe,coffre,chiffrement,2FA,TOTP,sécurité,vie privée,gestionnaire,import
```

81 caractères. Le nom de l'app et les catégories sont déjà indexés : les répéter ici
gaspillerait la limite. Les marques concurrentes n'y figurent pas — Apple les refuse.

« passkey » a été retiré : le serveur journalise bien `passkey.add`, mais **l'application
iOS n'en propose pas**. Un mot-clé qui promet une fonctionnalité absente se paie à la
revue, et déçoit celui qui installe pour ça.

## Nouveautés de cette version

```
Première version.
```

## URL

- Politique de confidentialité : **[à héberger]** — brouillon dans `docs/confidentialite.md`.
- Assistance : **[à trancher]**.
- Marketing : **[facultatif]**.

## Captures d'écran

Cinq captures en 1320 × 2868 (6,9 pouces), produites par
`tools/ios/captures-appstore.sh` :

| Ordre | Écran | Ce qu'elle montre |
|---|---|---|
| 01 | Coffre | La liste, ses icônes de sites, les types d'entrées |
| 02 | Fiche | Le contenu d'un identifiant |
| 03 | Santé du coffre | Le diagnostic et la vérification de fuites |
| 04 | Partager un secret | Durée de vie et nombre de consultations |
| 05 | Générer | Longueur, jeux de caractères, force estimée |

Apple accepte les captures 6,9 pouces pour toutes les tailles d'iPhone : un seul jeu
suffit. Le script fige la barre d'état à 9 h 41, batterie pleine, réseau au maximum.

**Ce que ces captures ne montrent pas** : le remplissage automatique, qui est pourtant
l'argument principal. Il ne se photographie pas sous `xcodebuild` — la barre de
remplissage vit dans le clavier logiciel, absent en test automatisé. Une capture prise à
la main sur appareil réel serait ici le meilleur ajout.
