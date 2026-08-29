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
