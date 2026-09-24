# Fiche App Store — GhostPass

Textes prêts à coller dans App Store Connect. **Rien ici n'est une promesse commerciale
que le code ne tiendrait pas** : chaque affirmation renvoie à une fonctionnalité livrée.

> Les mentions entre crochets restent à trancher : elles engagent l'entreprise, pas le
> dépôt.

## Ce qui manque avant l'envoi

Relevé le 24 septembre 2026. Ce qui n'y figure pas est prêt.

| Ce qu'il reste | Pourquoi ça ne peut pas se faire ici |
|---|---|
| Fusionner la page d'assistance, **puis vérifier que l'URL répond** | L'API de la forge exige un jeton ; une clé SSH n'y donne pas accès |
| Créer le **compte de démonstration** sur une instance joignable depuis l'extérieur | Sans lui, l'examinateur ne voit rien et refuse pour « fonctionnalité incomplète » |
| Trancher la **note 3 du §740.17(b)** et mener les démarches BIS et ANSSI | Questions de droit ; l'annexe technique qu'elles réclament est écrite |
| Coller la fiche dans App Store Connect et répondre au questionnaire de confidentialité | Les réponses exactes sont plus bas, mot pour mot |
| Construire une **archive de diffusion signée** et l'envoyer | Jamais fait : seules des versions de développement ont été posées sur appareil |

Ce qui est prêt : les deux jeux de captures, refaits le 24 septembre ; les textes des deux
langues ; les mots-clés ; les manifestes de confidentialité ; le remplissage automatique,
éprouvé sur iPhone ; et l'annexe technique du dossier de cryptologie.

**Une réserve sur le jeu iPad.** Les cinq images du jeu iPhone ont été ouvertes et
regardées ; du jeu iPad, seules `01-coffre`, `03-sante` et `04-partage` l'ont été.
`03-sante` montre une feuille **coupée à mi-ligne** — la dernière entrée et la phrase
explicative sortent du cadre modal, plus court sur iPad que le contenu. Ce n'est pas un
défaut du produit, où la feuille défile ; c'en est un en vitrine. À trancher : la
recadrer, choisir un autre écran pour la troisième image iPad, ou l'accepter.

## Identité

| Champ | Valeur |
|---|---|
| Nom | GhostPass |
| Sous-titre (30 car. max) | Vos mots de passe, chiffrés |
| Catégorie principale | Utilitaires |
| Catégorie secondaire | Productivité |
| Classification d'âge | 4+ |
| Appareils | iPhone **et** iPad (`TARGETED_DEVICE_FAMILY = "1,2"`) |
| Prix | **Gratuit** |

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

80 caractères. Le nom de l'app et les catégories sont déjà indexés : les répéter ici
gaspillerait la limite. Les marques concurrentes n'y figurent pas — Apple les refuse.

« passkey » a été retiré : le serveur journalise bien `passkey.add`, mais **l'application
iOS n'en propose pas**. Un mot-clé qui promet une fonctionnalité absente se paie à la
revue, et déçoit celui qui installe pour ça.

## Nouveautés de cette version

```
Première version.
```

## URL

| Champ | Valeur | État |
|---|---|---|
| Politique de confidentialité | `https://ghostsuite.cloud/confidentialite/` | **en ligne** |
| Assistance | `https://ghostsuite.cloud/ghostpass/` | **404 au 24/09** — attend la fusion |
| Marketing | `https://ghostsuite.cloud/` | en ligne, facultatif |

Les deux premières sont **obligatoires** chez Apple. La politique couvre GhostPass
nommément, par produit : il n'y a rien à dupliquer, on la lie telle quelle.

La page d'assistance existe sur la branche `feat/page-ghostpass` du dépôt `ghostsuite`
et **n'est pas encore en ligne**. La fusion demande d'ouvrir la demande à la main —
l'API de la forge réclame un jeton, une clé SSH n'y donne pas accès :

    https://git.stackops.ch/stackops/ghostsuite/pulls/new/feat/page-ghostpass

**Vérifier que l'URL répond avant de l'inscrire dans App Store Connect.** Une URL
d'assistance morte est un motif de refus, et elle ne se voit pas depuis le dépôt.

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
la main sur appareil réel serait ici le meilleur ajout, et elle est désormais **possible** :
la fonctionnalité a été éprouvée sur iPhone le 14 septembre 2026.

**Deux réglages de prise de vue à connaître**, tous deux sous un drapeau compilé hors des
versions de diffusion (`-captures-de-fiche`) :

- La **protection des captures** est levée. Elle vide aussi `XCUIScreen.main.screenshot()` :
  cinq images blanches, de la bonne taille et du bon nom, sont parties dans le dépôt avant
  qu'on ne les ouvre.
- Le **bandeau « Remplissage automatique désactivé »** est masqué. Il est juste dans le
  produit et faux en vitrine : le banc ne peut pas cocher la case — ce réglage vit dans un
  magasin système que `defaults` n'atteint pas —, et la première image de la boutique
  aurait annoncé que la fonction principale est éteinte. C'est une décision de
  présentation, pas une correction.

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
> Pour éprouver le remplissage automatique : ouvrez GhostPass, déverrouillez le coffre et
> touchez « Ouvrir les réglages » dans le bandeau en tête de liste — il mène directement à
> l'écran où autoriser GhostPass. Ouvrez ensuite une page de connexion dans Safari : la
> proposition apparaît au-dessus du clavier.
>
> (Le chemin manuel équivalent dépend de la version d'iOS : Réglages > Général > Saisie
> automatique et mots de passe sur les versions récentes, Réglages > Mots de passe sur les
> plus anciennes.)
>
> L'application ne collecte aucune donnée d'usage et ne contient aucun traceur.

**Deux pièges connus, à traiter avant l'envoi et non pendant l'examen :**

1. Le compte de démonstration doit vivre sur une instance **joignable depuis l'extérieur**.
   Un examinateur ne peut pas atteindre un serveur de développement.
2. Le remplissage automatique exige le **groupe d'applications** et l'habilitation de
   fournisseur d'identifiants, tous deux hors de portée d'une équipe personnelle. La
   version envoyée doit être signée par l'équipe de l'entreprise `9WHCJ5W7S6`, sans quoi
   la fonctionnalité mise en avant dans la description sera absente du binaire examiné.

   Le groupe est **`group.ch.stackops.ghostpass.coffre`**, et le suffixe n'est pas
   décoratif : `group.ch.stackops.ghostpass` est immobilisé sous une équipe personnelle
   d'un essai antérieur, et les identifiants de groupe sont uniques chez Apple toutes
   équipes confondues. Il n'est pas récupérable.

   Un certificat d'équipe personnelle vit encore dans le trousseau de la machine de
   construction : `DEVELOPMENT_TEAM` doit être **imposée**, jamais découverte. Signer avec
   l'autre produit une application qui s'installe, se lance, et dont le remplissage ne voit
   rien — le symptôme serait « aucun identifiant proposé », à mille lieues de la cause.

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
| Exempté au titre de la note 3 du §740.17(b) ? | **[à trancher avec un juriste]** — trois faits vérifiés ci-dessous |

Le chiffrement n'est pas accessoire ici, c'est la fonction même du produit : déclarer
« non » serait faux. Conséquences à traiter **avant** l'envoi, pas après :

- un rapport d'auto-classification annuel auprès du **BIS** américain, la distribution
  passant par l'App Store ;
- côté français, une **déclaration ANSSI** de fourniture d'un moyen de cryptologie.

Ces deux démarches engagent l'entreprise et ne se règlent pas dans le dépôt. Ce qui, lui,
se tire du code est rédigé : [`docs/anssi-dossier-technique.md`](../../../docs/anssi-dossier-technique.md)
donne les primitives, leurs paramètres, la gestion des clés et ce que le serveur détient.
Les deux dossiers réclament cette annexe.

**Trois faits utiles au juriste, vérifiés et non supposés :**

1. Le code est sous **Elastic License 2.0**, qui n'est pas une licence libre au sens OSI
   mais laisse copier, modifier et redistribuer. Elle restreint un **usage** — fournir le
   logiciel en service géré — et non la diffusion.
2. La note 3 du §740.17(b) suppose un logiciel **publiquement disponible**. Le critère est
   l'accessibilité réelle du code source, pas le nom de la licence.
3. Or cette accessibilité **n'est pas établie** : au 24 septembre 2026, le miroir public
   répond 404. Tant qu'il en est ainsi, l'argument tombe quelle que soit la licence.

Rendre le code publiquement accessible pourrait donc changer la nature de la démarche
américaine — sans rien changer à la française, où la déclaration tient à la fonction de
confidentialité, pas au régime de diffusion.

## Le modèle économique, et ce qu'Apple en pensera

L'application est **gratuite**. Deux façons de s'en servir :

- **auto-hébergement**, le serveur étant libre ;
- **abonnement**, qui provisionne à l'abonné **sa propre instance**.

**Le point à préparer plutôt qu'à découvrir au refus.** L'app ne fonctionne qu'avec un
compte, et l'abonnement se souscrit hors de l'App Store. Apple refuse régulièrement les
applications dont la fonction principale exige un compte payant acquis ailleurs, au titre
de la règle 3.1.1 sur les achats intégrés. Deux éléments jouent en faveur de GhostPass, et
il faut les énoncer explicitement dans les notes d'examen plutôt que d'espérer qu'ils
soient devinés :

1. **L'auto-hébergement est gratuit et suffisant.** L'application est pleinement
   utilisable sans rien payer à qui que ce soit : ce n'est pas une démonstration bridée.
   C'est l'argument le plus fort — il n'y a pas de fonctionnalité déverrouillée par un
   paiement.
2. **L'abonnement n'achète pas une fonctionnalité de l'app, mais un hébergement** —
   l'exemption « services multiplateformes » (3.1.3(b)) vise ce cas : un service acquis
   ailleurs, consommé par un client gratuit.

Ce qui reste risqué et doit être décidé : l'application ne doit **ni mentionner
l'abonnement, ni y renvoyer par un lien**, faute de quoi la règle 3.1.3(a) s'applique.
L'utilisateur arrive avec l'adresse de son serveur, quelle qu'en soit l'origine.

## Ce qui reste à trancher

Rien de ce qui suit n'est technique — tout engage l'entreprise :

- le prix ;
- l'hébergement de la politique de confidentialité (brouillon dans `docs/confidentialite.md`) ;
- l'adresse d'assistance ;
- le compte de démonstration et l'instance publique qui le porte ;
- les déclarations BIS et ANSSI.
