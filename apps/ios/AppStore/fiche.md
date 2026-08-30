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
| Appareils | iPhone **et** iPad (`TARGETED_DEVICE_FAMILY = "1,2"`) |
| Prix | [à trancher] |

Le sous-titre fait 27 caractères. Deux variantes de repli, si celle-ci déplaît :
« Coffre-fort de mots de passe » (28), « Chiffré de bout en bout » (23).

## Description (français)

GhostPass garde vos mots de passe, vos notes et vos cartes dans un coffre que vous seul
pouvez ouvrir.

Le chiffrement a lieu sur votre appareil, avec une clé dérivée de votre mot de passe
maître. Ce mot de passe ne quitte jamais votre appareil, et nous ne le connaissons pas. Le
serveur héberge des données qu'il ne sait pas lire — ce n'est pas une politique interne,
c'est une impossibilité technique.

REMPLISSAGE AUTOMATIQUE
Vos identifiants s'insèrent depuis le clavier, dans Safari comme dans vos applications.
Les codes à usage unique aussi : GhostPass les calcule sur l'appareil et les propose au
bon champ. Pour en ajouter un, scannez le QR code affiché par le site — plutôt que de
recopier trente-deux caractères sans se tromper.

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
password never leaves your device, and we do not know it. The server holds data it cannot
read — not as a matter of policy, but as a technical impossibility.

AUTOFILL
Your credentials are inserted straight from the keyboard, in Safari and in your apps.
One-time codes too: GhostPass computes them on device and offers them to the right field.
To add one, scan the QR code the site shows you — rather than copying thirty-two
characters without a slip.

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

**Deux jeux**, produits par `tools/ios/captures-appstore.sh`. App Store Connect les
réclame tous les deux dès lors que l'application se déclare universelle — un seul jeu
laisse la fiche incomplète.

| Jeu | Appareil | Taille | Dossier |
|---|---|---|---|
| iPhone | iPhone 17 Pro Max (6,9 ") | 1320 × 2868 | `captures/` |
| iPad | iPad Pro 13 " (M4) | 2064 × 2752 | `captures-ipad/` |

Le même scénario dans les deux cas :

| Ordre | Écran | Ce qu'elle montre |
|---|---|---|
| 01 | Coffre | La liste, ses icônes de sites, les types d'entrées |
| 02 | Fiche | Le contenu d'un identifiant |
| 03 | Santé du coffre | Le diagnostic et la vérification de fuites |
| 04 | Partager un secret | Durée de vie et nombre de consultations |
| 05 | Générer | Longueur, jeux de caractères, force estimée |

Les dimensions sont celles que rend nativement chaque simulateur, relevées à la prise de
vue et non figées dans le script : une image redimensionnée après coup est refusée. La
barre d'état est figée à 9 h 41, batterie pleine, réseau au maximum.

**Ce que ces captures ne montrent pas** : le remplissage automatique, qui est pourtant
l'argument principal. Il ne se photographie pas sous `xcodebuild` — la barre de
remplissage vit dans le clavier logiciel, absent en test automatisé. Une capture prise à
la main sur appareil réel serait ici le meilleur ajout.

La capture « Partager un secret » montre l'écran, pas un lien réellement produit : la
prise de vue parle à un serveur local jetable, sans service de partage configuré.

## Notes pour l'examen (App Review)

**C'est la section qui décide d'un premier refus.** Tout, dans cette application, est
derrière un compte et un serveur : un examinateur qui l'installe et ne peut pas ouvrir de
coffre ne voit rien à évaluer, et refuse pour « fonctionnalité incomplète ». Il faut donc
lui donner de quoi entrer, et lui dire quoi faire.

À remplir avant l'envoi :

| Champ | Valeur |
|---|---|
| Compte de démonstration | **[à créer]** — un compte réel sur une instance jointe depuis l'extérieur |
| Mot de passe | **[à créer]** |
| Serveur à saisir au premier écran | **[l'adresse publique de l'instance]** |

Texte proposé pour la zone « Notes » :

> GhostPass est un gestionnaire de mots de passe à connaissance nulle. Le chiffrement a
> lieu sur l'appareil ; le serveur n'héberge que des données qu'il ne peut pas déchiffrer.
>
> Le premier écran demande l'adresse du serveur, puis l'adresse e-mail et le mot de passe
> maître. Utilisez le compte fourni ci-dessus. Le coffre contient déjà des entrées de
> démonstration.
>
> Pour éprouver le remplissage automatique : Réglages iOS > Mots de passe > Mots de passe
> et codes > activer GhostPass, puis ouvrir une page de connexion dans Safari. La
> proposition apparaît au-dessus du clavier.
>
> L'application ne collecte aucune donnée d'usage et ne contient aucun traceur.

**Deux pièges connus, à traiter avant l'envoi et non pendant l'examen :**

1. Le compte de démonstration doit vivre sur une instance **joignable depuis l'extérieur**.
   Un examinateur ne peut pas atteindre un serveur de développement.
2. Le remplissage automatique exige le **groupe d'applications** et l'habilitation de
   fournisseur d'identifiants, tous deux hors de portée d'une équipe personnelle. La
   version envoyée doit être signée par l'équipe de l'entreprise, sans quoi la
   fonctionnalité mise en avant dans la description sera absente du binaire examiné.

## Confidentialité (questionnaire App Privacy)

Apple demande de déclarer les données collectées, catégorie par catégorie. La réponse est
la même partout : **aucune collecte**, ce qui donne l'étiquette « Aucune donnée collectée ».

| Catégorie | Collecté ? | Pourquoi |
|---|---|---|
| Coordonnées | Non | L'adresse e-mail sert à ouvrir le compte sur *votre* serveur ; elle n'est ni transmise à un tiers ni liée à un profil |
| Identifiants et mots de passe | Non | Ils ne quittent l'appareil qu'en chiffré, sous une clé que le serveur n'a pas |
| Données d'usage, diagnostic | Non | Aucun SDK d'analyse, aucun rapport de plantage tiers |
| Identifiants d'appareil, publicité | Non | Aucun traceur |

**Une précision à donner si Apple la demande** : les secrets partagés par lien sont
déposés chiffrés sur un service de partage, et la clé de déchiffrement voyage dans le
fragment de l'URL — la partie après le dièse, que les navigateurs n'envoient jamais au
serveur. Le service qui héberge le lien ne peut donc pas lire ce qu'il héberge.

## Conformité à l'export (chiffrement)

À la première version, App Store Connect pose la question du chiffrement. Les réponses,
et la raison de chacune :

| Question | Réponse |
|---|---|
| L'app contient-elle du chiffrement ? | **Oui** |
| Est-il limité aux exemptions d'Apple (HTTPS, authentification seule) ? | **Non** |
| Est-il propriétaire ? | **Non** — Argon2id, XChaCha20-Poly1305, X25519, algorithmes publics |
| Exempté au titre de la note 3 du §740.17(b) ? | **[à trancher avec un juriste]** |

Le chiffrement n'est pas accessoire ici, c'est la fonction même du produit : déclarer
« non » serait faux. Conséquences à traiter **avant** l'envoi, pas après :

- un rapport d'auto-classification annuel auprès du **BIS** américain, la distribution
  passant par l'App Store ;
- côté français, une **déclaration ANSSI** de fourniture d'un moyen de cryptologie.

Ces deux démarches engagent l'entreprise et ne se règlent pas dans le dépôt.

## Ce qui reste à trancher

Rien de ce qui suit n'est technique — tout engage l'entreprise :

- le prix ;
- l'hébergement de la politique de confidentialité (brouillon dans `docs/confidentialite.md`) ;
- l'adresse d'assistance ;
- le compte de démonstration et l'instance publique qui le porte ;
- les déclarations BIS et ANSSI.
