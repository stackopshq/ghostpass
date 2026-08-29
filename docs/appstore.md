# Publier GhostPass sur l'App Store

Ce qui est fait dans le dépôt, ce qui reste à faire ailleurs, et pourquoi.

## Fait dans le dépôt

**Manifestes de confidentialité** — `apps/ios/Ghostpass/PrivacyInfo.xcprivacy` et
`apps/ios/GhostpassAutoFill/PrivacyInfo.xcprivacy`. Exigés depuis mai 2024 ; sans eux,
l'envoi est refusé. Un manifeste par binaire : celui de l'application ne couvre pas son
extension.

Ils déclarent l'usage de `UserDefaults` (raison CA92.1 — groupe d'applications partagé) et
rien d'autre : les appels à `FileManager` créent et suppriment, ils ne lisent aucun
horodatage, et l'application ne touche ni au temps de démarrage, ni à l'espace disque, ni
aux claviers actifs. Ce relevé vient du code, pas d'une estimation.

**Numéros de version** — `MARKETING_VERSION` 1.0, `CURRENT_PROJECT_VERSION` 1. Le second
doit monter à chaque envoi : App Store Connect refuse deux fois le même.

**Déclaration de chiffrement** — `ITSAppUsesNonExemptEncryption` à `YES`. Voir plus bas.

## À faire hors du dépôt

### Compte et identifiants

- Compte développeur Apple *(en cours de validation)*.
- Enregistrer les deux identifiants : `ch.stackops.ghostpass` et
  `ch.stackops.ghostpass.autofill`.
- Enregistrer le groupe d'applications `group.ch.stackops.ghostpass` — l'extension de
  remplissage lit le coffre par lui ; sans ce groupe, elle ne trouve rien.
- Renseigner `DEVELOPMENT_TEAM` (variable d'environnement, injectée à la compilation).

### Chiffrement : deux démarches, pas une

Le chiffrement de GhostPass — Argon2id, XChaCha20-Poly1305 — n'entre dans aucune exemption
d'Apple. Ce n'est ni du HTTPS d'appoint ni de l'authentification seule : c'est la fonction
du produit. D'où `ITSAppUsesNonExemptEncryption: YES`, et deux conséquences.

**BIS (États-Unis)** — la distribution passe par l'App Store, donc par les États-Unis. Un
rapport d'auto-classification annuel est en principe attendu, sauf exemption applicable.

**ANSSI (France)** — la fourniture d'un moyen de cryptologie assurant la confidentialité
relève d'une déclaration. Ce qui ne fait que de l'authentification en est dispensé ; ce
n'est pas notre cas.

Ces deux points sont juridiques. Ils sont mentionnés ici parce qu'ils conditionnent la
publication, pas parce que ce document sait y répondre.

### Fiche App Store Connect

- Politique de confidentialité : une URL est **obligatoire**. Brouillon dans
  [`confidentialite.md`](confidentialite.md), à relire et à héberger.
- Questionnaire « Confidentialité des données ». Les réponses exactes, cohérentes avec les
  manifestes :

  | Donnée | Collectée | Liée à l'utilisateur | Suivi publicitaire |
  |---|---|---|---|
  | Adresse e-mail | oui | oui | non |
  | Autre contenu utilisateur (coffre chiffré) | oui | oui | non |

  La tentation est de répondre « aucune donnée collectée » au motif que tout est chiffré.
  Ce serait faux : le serveur stocke bien une adresse e-mail et des blobs. Qu'ils soient
  illisibles ne les rend pas inexistants, et une déclaration inexacte se paie au contrôle.

- Captures d'écran, description, mots-clés, classification d'âge : **prêts dans le dépôt**,
  voir [`apps/ios/AppStore/fiche.md`](../apps/ios/AppStore/fiche.md) et
  `apps/ios/AppStore/captures/`. Il reste à les coller et à trancher les mentions entre
  crochets — prix, URL d'assistance, raison sociale.

### iPhone seulement, ou iPad aussi ? — à trancher

L'application se déclare **universelle**. `TARGETED_DEVICE_FAMILY` n'est fixé nulle part,
et Xcode retient alors iPhone *et* iPad : le binaire construit porte bien
`UIDeviceFamily = [1, 2]`, ce qui n'est pas une supposition mais ce qu'on lit dans son
Info.plist.

Deux conséquences, l'une administrative et l'autre plus sérieuse :

- App Store Connect **réclamera un second jeu de captures**, au format iPad 13 pouces.
- On publierait une plateforme sur laquelle **rien n'a jamais été éprouvé** : ni la suite
  de tests, ni le remplissage automatique, ni la mise en page.

L'application a été ouverte sur un iPad Pro 13 pouces pour en avoir le cœur net, et les
captures sont dans `apps/ios/AppStore/captures-ipad/`. Le verdict est nuancé : **elle
fonctionne**, la connexion, la liste et la navigation répondent. Mais elle n'est
visiblement pas dessinée pour cet écran :

- la liste s'étire sur toute la largeur, une ligne de 2 064 points pour deux lignes de
  texte ;
- les feuilles deviennent des cartes centrées de hauteur fixe, et **le contenu y est
  tronqué** : sur « Santé du coffre », la dernière ligne est coupée net par le bord de la
  carte.

Ce n'est pas rédhibitoire — rien n'est cassé — mais cela se verra, et un examinateur
d'Apple regarde les captures iPad avec les mêmes yeux que le reste.

Deux issues, au choix :

1. **S'en tenir à l'iPhone** — poser `TARGETED_DEVICE_FAMILY = 1` dans `project.yml`. Un
   seul jeu de captures, rien d'invérifié à la vente. C'est le choix prudent tant que
   personne n'a ouvert l'application sur un iPad.
2. **Assumer l'iPad** — le vérifier écran par écran, puis produire son jeu :
   `GHOSTPASS_APPAREIL="iPad Pro 13-inch (M5)" ./tools/ios/captures-appstore.sh`, qui range
   ses images dans `apps/ios/AppStore/captures-ipad/`.

Ce choix appartient au produit, pas au dépôt. Il conditionne l'envoi.

## À éprouver avant d'envoyer

**Le remplissage automatique, sur un appareil réel.** C'est la fonctionnalité qui justifie
une application native.

*Vérifiée à la main le 28 août 2026 sur simulateur* : l'extension apparaît et s'active dans
les réglages système, le clavier propose l'identifiant du bon site parmi les trois du
coffre, et les champs se remplissent. L'appariement par domaine et le déchiffrement hors
ligne de l'extension sont donc éprouvés.

Reste l'appareil réel, que rien ne remplace : `test04Remplissage` continue de se sauter
sous `xcodebuild` faute de clavier logiciel — six réglages essayés sans succès, voir le
commentaire du test. On sait maintenant que le produit n'est pas en cause.

En attendant l'appareil, `tools/ios/autofill-manuel.sh` monte un banc d'essai sur
simulateur et le laisse en place, avec la marche à suivre. Il reste un geste que rien
n'automatise : cocher GhostPass dans *Réglages > Général > Saisie automatique*. Ce réglage
vit dans un magasin système que `defaults` n'atteint pas.

**Le reste aussi.** Rien n'a jamais tourné ailleurs que sur simulateur : ni la biométrie
réelle, ni les passkeys, ni le comportement sous mémoire contrainte.

## Ce qui n'est pas prêt et qu'il vaut mieux savoir

- `GET /api/mfa` doit être déployé avant que l'écran de second facteur ne fonctionne
  contre un serveur en production.
- Le journal du compte suppose que `/api/account/audit` et `/api/account/activity` soient
  servis par la version déployée.
