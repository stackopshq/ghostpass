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

**Déclaration de chiffrement** — la clé `ITSAppUsesNonExemptEncryption` est
**délibérément absente**, et c'est le contraire d'un renoncement.

Elle valait `YES`, ce qui est vrai. Mais `YES` **sans** `ITSEncryptionExportComplianceCode`
fait refuser l'envoi — « Invalid Export Compliance Code (90592) » —, et ce code n'est
délivré qu'après examen d'une documentation de conformité qu'App Store Connect ne propose
de remplir **qu'une fois un build reçu**. La boucle ne se ferme pas.

Sans la clé, les questions sont posées dans l'interface à chaque soumission. Les réponses
sont dans [`fiche.md`](../apps/ios/AppStore/fiche.md), tirées du code. Répondre là vaut
exactement ce que valait la clé — et les obligations BIS et ANSSI restent entières.

## À faire hors du dépôt

### Compte et identifiants

- Compte développeur Apple — **validé le 14 septembre 2026**, équipe `9WHCJ5W7S6`
  (« Clara Vanacker », type Individual).
- Les deux identifiants `ch.stackops.ghostpass` et `ch.stackops.ghostpass.autofill` sont
  enregistrés — créés par la signature automatique au premier build vers un appareil.
- Le groupe d'applications est **`group.ch.stackops.ghostpass.coffre`**, et le suffixe
  n'est pas décoratif : `group.ch.stackops.ghostpass` est **immobilisé**. Les identifiants
  de groupe sont uniques chez Apple toutes équipes confondues, et celui-là a été pris par
  l'équipe personnelle lors d'un essai antérieur. Une équipe personnelle ne s'administre
  pas sur le portail : il n'est pas récupérable, seulement contournable.
- `DEVELOPMENT_TEAM` doit être **imposée** et non découverte : le certificat de l'équipe
  personnelle vit encore dans le trousseau, et signer avec produit une application qui
  s'installe, se lance, et dont le remplissage ne voit rien.
- **Chaque appareil de test doit être enregistré sur le compte.** `-allowProvisioningUpdates`
  ne suffit pas toujours : le second iPhone a dû être ajouté à la main par son identifiant.

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

L'annexe technique que les deux démarches réclament — primitives, paramètres, gestion des
clés, ce que le serveur détient — est rédigée et vérifiable :
[`anssi-dossier-technique.md`](anssi-dossier-technique.md). Elle décrit le code, pas le
droit, et le dit.

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

### iPad : soutenu, à soigner

`TARGETED_DEVICE_FAMILY` vaut `"1,2"` : l'application se déclare iPhone **et** iPad, et son
Info.plist le confirme.

**Une correction, parce que ce document a affirmé l'inverse.** Il y était écrit que sur
iPad « les feuilles deviennent des cartes de hauteur fixe dont le contenu se coupe », et
qu'on lisait sur « Santé du coffre » une dernière ligne coupée net. **C'est faux.**
`GhostScreen` enveloppe son contenu dans un `ScrollView` : ce qui paraissait tronqué était
sous la ligne de flottaison. Vérifié en photographiant la même feuille après un
glissement — la ligne prétendument coupée apparaît en entier, suivie de celle d'après.

L'erreur venait de la méthode : une capture fixe ne distingue pas un contenu coupé d'un
contenu qui défile. Juger une mise en page sur une image immobile, c'est se condamner à
confondre les deux.

**Ce qui reste vrai**, et qui mérite du soin sans rien empêcher :

- les lignes de la liste s'étirent sur toute la largeur — 2 064 points pour deux lignes de
  texte. Ce n'est pas cassé, c'est vide ;
- la grille annuelle et la vue semaine sont conçues pour de larges écrans, elles y
  gagneront plutôt qu'elles n'y perdront ;
- App Store Connect réclame un jeu de captures iPad, produit par
  `GHOSTPASS_APPAREIL="iPad Pro 13-inch (M5)" ./tools/ios/captures-appstore.sh` et rangé
  dans `apps/ios/AppStore/captures-ipad/`.

Un détail à retenir si la famille d'appareils change à nouveau : poser la clef dans les
réglages *de projet* ne suffit pas. xcodegen écrit sa propre valeur au niveau de chaque
cible, et celle-ci l'emporte. Il faut la poser sur les quatre cibles, et le vérifier dans
l'Info.plist du produit construit :

```sh
/usr/libexec/PlistBuddy -c "Print :UIDeviceFamily" \
  apps/ios/.build/Build/Products/Debug-iphonesimulator/Ghostpass.app/Info.plist
```

## Essayer sur un appareil avant la validation du compte

Xcode sait installer sur *votre* iPhone avec un simple identifiant Apple, sans adhésion
payante : c'est le « Personal Team » du sélecteur d'équipe. La signature est valable sept
jours, après quoi l'application cesse de se lancer et il faut la réinstaller.

Ce qui est certain, parce que c'est dans le code : **l'application fonctionne sans le
groupe d'applications.** `SharedStore.container` retombe sur le conteneur privé quand le
groupe n'est pas accordé. Sont donc éprouvables dès aujourd'hui, sur matériel réel :

- Face ID ou Touch ID — la vraie biométrie, que le simulateur ne fait qu'imiter ;
- la réouverture hors ligne, en coupant le réseau pour de bon ;
- la mise en page à la taille réelle, et la lisibilité au soleil ;
- l'import et l'export sur de vrais fichiers ;
- le comportement sous mémoire contrainte, que rien n'a jamais exercé.

Ce qui ne l'est pas : **le remplissage automatique**. Il réclame les deux habilitations
déclarées dans `Ghostpass.entitlements` — le groupe d'applications et le fournisseur
d'identifiants — et celles-ci passent par le provisionnement. Si un profil personnel ne
peut pas les accorder, Xcode le dit à la compilation, en nommant l'habilitation fautive.
C'est la façon la plus courte de le savoir : brancher le téléphone, choisir le Personal
Team, compiler.

Sans le groupe, l'extension ne verra rien — et le dit désormais. Elle affichait jusqu'ici
« ouvrez GhostPass et connectez-vous une fois », ce qui envoyait refaire ce qui avait déjà
été fait : lisant son propre conteneur privé, vide, elle concluait à l'absence de session.
Elle distingue maintenant les deux cas.

## À éprouver avant d'envoyer

**Le remplissage automatique, sur un appareil réel — fait le 14 septembre 2026.** Sur un
iPhone 17 Pro : l'extension est appelée, Face ID se lance seul, et le champ se remplit
sans geste depuis la suggestion du clavier.

Six défauts en séparaient, **tous invisibles depuis un simulateur**. Ils valent d'être
listés, parce qu'ils disent ce qu'un simulateur ne peut pas prouver :

1. Le groupe d'applications immobilisé (voir plus haut).
2. Le voile de confidentialité couvrait l'extension en permanence : sa condition était
   `scenePhase != .active`, et une extension n'a pas de cycle de vie de scène —
   `scenePhase` n'y vaut jamais `.active`.
3. La cible de l'extension n'embarquait pas `Assets.xcassets` : `Image("LogoMark")` ne
   rendait **rien**, sans erreur ni journal, et le voile réduit à son mot ressemblait à un
   écran vide.
4. Les coffres d'équipe n'étaient jamais déposés dans le conteneur partagé. Pour un compte
   dont tous les mots de passe vivent en organisation, la copie locale était vide et
   l'extension annonçait « Aucun identifiant » sur tous les sites.
5. et 6. Deux fois la même notification manquante — `NSExtensionHostDidBecomeActive`
   n'arrive pas toujours — employée comme une garantie : elle rendait la demande
   biométrique intermittente et laissait la réponse en suspens pour toujours.

`test04Remplissage` continue de se sauter sous `xcodebuild` faute de clavier logiciel, et
`tools/ios/autofill-manuel.sh` reste le banc d'essai sur simulateur. Il reste un geste que
rien n'automatise : cocher GhostPass dans *Réglages > Général > Saisie automatique*. Ce
réglage vit dans un magasin système que `defaults` n'atteint pas.

**Une limite d'outillage, apprise en cherchant ces défauts** : `NSLog` depuis une extension
iOS n'est visible ni par `xcrun devicectl device process launch --console`, ni par
`idevicesyslog`. Pour observer une extension, il faut un affichage à l'écran — c'est ce que
fait la section « Remplissage automatique » des réglages, qui montre l'état du conteneur
partagé et le contenu de la copie locale. C'est elle qui a désigné le quatrième défaut.

**La biométrie réelle est éprouvée** elle aussi, des deux côtés — application et extension.

**Ce qui n'a toujours jamais tourné ailleurs que sur simulateur** : les passkeys, et le
comportement sous mémoire contrainte.

## L'archive de diffusion

Construite pour la première fois le 24 septembre 2026, en `Release`, signée par l'équipe
`9WHCJ5W7S6` :

    tools/ios/build-xcframework.sh
    xcodegen generate --spec project.yml          # depuis apps/ios
    xcodebuild archive -project Ghostpass.xcodeproj -scheme Ghostpass \
      -configuration Release -destination 'generic/platform=iOS' \
      -archivePath …/Ghostpass.xcarchive \
      DEVELOPMENT_TEAM=9WHCJ5W7S6 -allowProvisioningUpdates

**Ce que l'archive prouve, et que rien n'avait prouvé jusque-là :**

| Vérifié sur l'archive | Résultat |
|---|---|
| L'extension de remplissage est dans le paquet | `PlugIns/GhostpassAutoFill.appex` |
| Habilitation de fournisseur d'identifiants | présente |
| Groupe d'applications | `group.ch.stackops.ghostpass.coffre` |
| Équipe de signature | `9WHCJ5W7S6`, pas l'équipe personnelle |
| Version | 1.0 (1) |
| Déclaration de chiffrement | `ITSAppUsesNonExemptEncryption` à `true` |
| **Le drapeau `-captures-de-fiche`** | **absent du binaire — zéro occurrence** |

La dernière ligne compte : ce drapeau lève la protection des captures d'écran, et il est
compilé sous `#if DEBUG`. Qu'il soit **introuvable** dans le binaire de diffusion est la
preuve qu'aucun argument de lancement ne peut désarmer la protection en production. C'était
une affirmation ; c'est maintenant une mesure.

`apps/ios/ExportOptions.plist` décrit l'export. L'équipe y est **écrite**, jamais
découverte, pour la raison donnée dans le fichier.

### Ce qui bloque l'export, et qui n'est pas dans le dépôt

    xcodebuild -exportArchive … → EXPORT FAILED
    error: No profiles for 'ch.stackops.ghostpass' were found
    error: Unable to log in with account 'clara@cyberloutre.fr'

Les cinq profils présents sur la machine sont des profils de **développement** — ceux que
la signature automatique a créés en posant l'application sur les iPhone. L'export en
`app-store-connect` réclame des profils de **distribution**, qu'Xcode crée en se
connectant au compte. Cette connexion échoue : la session a expiré ou l'authentification à
deux facteurs attend une réponse.

**Débloqué le 24 septembre après reconnexion dans Xcode.** L'export rend
`Ghostpass.ipa`, 4,9 Mo, vérifié :

| Vérifié sur l'IPA | Résultat |
|---|---|
| Extension de remplissage | `PlugIns/GhostpassAutoFill.appex` |
| Profil de l'application | `iOS Team **Store** Provisioning Profile` — distribution, non développement |
| Profil de l'extension | idem |
| Signature | `codesign --verify --deep --strict` passe |

### L'envoi

    xcodebuild -exportArchive -archivePath …/Ghostpass.xcarchive \
      -exportOptionsPlist apps/ios/ExportOptions.plist -exportPath …/export

L'envoi lui-même réclame des identifiants qui ne sont pas — et n'ont pas à être — dans le
dépôt. Deux voies :

- **Clé API App Store Connect** : un fichier `.p8` dans `~/.appstoreconnect/private_keys/`,
  plus l'identifiant de clé et celui de l'émetteur. C'est la voie à préférer, parce qu'elle
  ne partage aucun mot de passe de compte et se révoque seule.

      xcrun altool --validate-app -f …/Ghostpass.ipa -t ios \
        --apiKey <ID> --apiIssuer <ISSUER>
      xcrun altool --upload-app  -f …/Ghostpass.ipa -t ios \
        --apiKey <ID> --apiIssuer <ISSUER>

- **Mot de passe d'application** : `--username`, `--app-password` et `--provider-public-id`.

**Valider avant d'envoyer.** `--validate-app` rend les mêmes refus que l'envoi, sans
consommer un numéro de version : App Store Connect refuse deux fois le même
`CURRENT_PROJECT_VERSION`, et un envoi rejeté brûle le numéro.

Aucune clé n'est présente sur la machine de construction au 24 septembre, et Transporter
n'y est pas installé.

## Le changement d'adresse publique, et ce qu'il entraîne

L'instance publique passe de `ghostpass.stackops.ch` à **`pass.ghostsuite.cloud`**. Ce
sont **deux serveurs distincts, avec deux bases distinctes** — vérifié plutôt que
supposé : un compte créé sur l'un ne s'ouvre pas sur l'autre.

Conséquences relevées le 24 septembre 2026 :

- **La fiche App Store vise la nouvelle adresse.** C'est celle que l'examinateur saisira,
  et la seule qui vivra encore quand l'examen aura lieu.
- **Le compte de démonstration existe sur les deux**, le temps de la bascule.
- **La politique de confidentialité publiée est à corriger.** Elle nomme
  `ghostpass.stackops.ch` dans le tableau des destinataires, à la ligne Cloudflare. Ce
  document est juridique et il est **déjà en ligne** ; Apple le lira. La correction
  appartient à l'éditrice, pas au dépôt — elle est signalée ici pour ne pas être
  découverte après coup. Le texte source vit dans `site/content/confidentialite.md` du
  dépôt `ghostsuite`.
- Les mentions de l'ancienne adresse dans le code iOS sont des **commentaires et des
  valeurs de test**, pas des adresses en dur : `ServerAddress.swift` et `VaultStore.swift`
  s'en servent comme exemple de saisie, `ContractTests.swift` comme domaine d'essai. Rien à
  changer pour que le produit fonctionne — l'adresse est saisie par l'utilisateur.

## Les adresses de contact, et une qui ne répond pas

Relevé le 24 septembre 2026. Les adresses **qui existent** chez l'éditeur :
`compta@`, `contact@`, `dmarc@`, `noc@` et `privacy@stackops.ch`.

| Usage | Adresse | Pour App Store Connect |
|---|---|---|
| Questions de données personnelles | `privacy@stackops.ch` | questionnaire de confidentialité |
| Assistance et contact général | `contact@stackops.ch` | contact d'assistance |

**Deux inexactitudes corrigées ou signalées :**

- Les conditions générales donnaient `support@stackops.ch` comme contact principal.
  **Cette adresse n'existe pas.** Corrigé : un contrat qui donne une adresse morte ne donne
  pas d'adresse.
- **Le `security.txt` servi en production déclare `security@stackops.ch`, qui n'existe pas
  non plus.** Le fichier source du dépôt — `apps/web-next/public/.well-known/security.txt`
  — dit bien `contact@stackops.ch` : c'est le **déploiement qui est périmé**, pas le code.

Ce second point n'est pas cosmétique. Quelqu'un qui trouve une faille dans un gestionnaire
de mots de passe et écrit à l'adresse annoncée n'obtient rien, et le fichier dit lui-même
pourquoi il existe : « une adresse de signalement qui n'est écrite nulle part n'est pas une
adresse de signalement ». Elle est écrite, elle ne répond pas, ce qui est pire — on croit
avoir prévenu.

**À faire : redéployer `web-next` sur `pass.ghostsuite.cloud`**, puis vérifier que
`/.well-known/security.txt` sert bien `contact@`. Ce n'est pas un changement de code.

## Ce qui n'est pas prêt et qu'il vaut mieux savoir

- ~~`GET /api/mfa` doit être déployé…~~ **Fait.** Vérifié le 14 septembre 2026 contre
  `ghostpass.stackops.ch` : les trois routes — `/api/mfa`, `/api/account/audit`,
  `/api/account/activity` — répondent `401 {"error":"non authentifié"}`, c'est-à-dire
  **notre** message et non un 404 de Fastify. Elles sont donc enregistrées et servies ;
  seule l'authentification manquait à la requête d'essai.

  La distinction vaut d'être notée, parce qu'elle a servi deux fois aujourd'hui : un 404
  portant un message à nous dit « la route existe et refuse », un 404 nu dit « la route
  n'existe pas ». C'est ainsi qu'on a su que le SSO mobile était déployé mais désactivé,
  et non absent.

- Le **SSO mobile fonctionne**, vérifié le 14 septembre 2026 de bout en bout côté serveur :
  `GET /api/auth/sso/mobile/start` avec un défi PKCE S256 valide rend un `302` vers
  Cloudflare Access, avec le bon `redirect_uri`, un `state` et un `nonce`.

  Il a traversé trois états en une journée, et c'est le message qui les distinguait :
  `404` nu de Fastify — la route n'existe pas — puis `404 {"error":"SSO mobile désactivé"}`
  — elle existe, la configuration manque — puis `400 {"error":"requête invalide"}` — elle
  est configurée, c'est la requête d'essai qui était incomplète. Trois diagnostics
  opposés derrière deux fois le même code HTTP.

  Reste à éprouver le **client iOS** contre lui : `SsoMobile.swift` n'a jamais parlé à
  autre chose qu'un banc.
