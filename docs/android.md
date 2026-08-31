# GhostPass sur Android — ce qu'il faut savoir avant d'écrire une ligne

GhostPass iOS reste en Swift : l'application est un produit d'intégration système —
extension de remplissage, trousseau sous contrôle biométrique, groupe d'applications,
verrouillage sur les phases de scène — et c'est exactement là qu'un cadre multiplateforme
aide le moins. Son Android est donc une application **Kotlin native**, pas un portage.

Ce document rassemble ce qui ne se devine pas. Chacun des points ci-dessous a la même
propriété désagréable : **un écart ne produit aucune erreur**. Il rend simplement des
données illisibles chez un autre client, ou plus tard, ou chez quelqu'un d'autre.

## 0. Le prérequis — **levé le 2026-08-31**

La chaîne Rust → Kotlin fonctionne : `tools/android/build-jni.sh` compile
`ghost-crypto-ffi` pour les trois architectures, génère les liaisons, et
`apps/android/shared-test/kotlin/ch/stackops/ghostpass/CoeurTest.kt` traverse la frontière
avec le vecteur ci-dessous — 12 tests sur émulateur, avec un contrôle négatif qui prouve
qu'ils ne sont pas creux (retirer la bibliothèque partagée les fait tomber).

**Ce qui existe s'arrête là.** Deux fichiers Kotlin, aucune application : ni écran, ni
coffre, ni service de remplissage. Tout ce qui suit est à écrire.

Le paragraphe d'origine, conservé parce qu'il dit pourquoi ce jalon comptait :

**Rien ne compilait le cœur pour Android.** `tools/ios/build-xcframework.sh`
appelle `uniffi-bindgen --language swift` ; personne n'a jamais lancé l'équivalent Kotlin,
et aucune cible Android n'est configurée pour ce produit.

Le premier travail est donc un `tools/android/build-jni.sh` qui :

1. compile `ghost-crypto-ffi` (dans le dépôt `ghostsuite`, pas ici) pour
   `aarch64-linux-android`, `armv7-linux-androideabi`, `x86_64-linux-android` ;
2. génère les liaisons Kotlin avec `uniffi-bindgen --language kotlin` ;
3. dépose les `.so` là où Gradle les attend.

**Et un test qui traverse la frontière**, avec le vecteur ci-dessous. Sans lui, une chaîne
de construction cassée se manifesterait au premier déverrouillage d'un utilisateur, pas à
la compilation.

> Le pont Flutter de GhostCal a été validé exactement ainsi, et cette discipline a payé :
> elle a révélé que le JDK le plus récent casse l'outillage Android, et que deux clés
> manquantes dans un `Info.plist` empêchaient toute exécution sur appareil — deux choses
> qu'aucune relecture n'aurait trouvées.

## 1. Pas une ligne de cryptographie hors du cœur

C'est la règle qui rend ces portages possibles. Le cœur Rust est partagé, prouvé, et
consommé par UniFFI. La couche Kotlin traduit des types et rien d'autre.

Vecteur de traversée, à reprendre **valeur par valeur** — il vient de `hash-wasm`, la
bibliothèque du navigateur, et non du cœur : il vérifie que Kotlin obtient ce que le web
obtient, pas que le cœur est cohérent avec lui-même.

```
deriverCle(phrase: "correct horse", sel: 16 octets valant 0x07)
  → 7b985d8fa00c9eccccf918c8cb9feaa8036af381caf6f498e099b5b849b8c18a
```

Les autres vecteurs sont dans `apps/ios/Tests/ContractTests.swift`. **Les porter tels
quels.** Un vecteur qui change en traduisant est un défaut, pas une adaptation.

## 2. Les registres à nom réservé

Le coffre ne contient que des éléments chiffrés. Ce que l'application doit retenir en plus
vit dans des éléments comme les autres, sous un nom commençant par un **octet NUL** —
qu'aucun clavier ne produit, donc qu'aucun nom d'utilisateur ne peut usurper.

| Nom | Contenu |
|---|---|
| `\0gp:folders` | tableau JSON de chemins — les dossiers **vides** seulement |
| `\0gp:favorites` | tableau JSON d'identifiants d'éléments |
| `\0gp:shares` | tableau JSON d'objets `PartageEnCours` (voir §4) |
| `\0gp:orgcolors` | objet JSON `{ "<id d'organisation>": "#RRGGBB" }` |

Chacun est un `SecureNote` dont `data.content` est le JSON sérialisé. L'interface masque
tout élément dont le nom commence par `\0gp:` — sans quoi ils apparaîtraient comme des
lignes fantômes.

**Piège mesuré** : `grep` traite un fichier contenant un NUL comme binaire et rend zéro
résultat **sans le dire**. Chercher `gp:shares` sans le préfixe, ou utiliser `grep -a`.

## 3. Les couleurs d'équipe — à copier au calcul près

Un utilisateur qui n'a rien réglé doit voir **la même couleur** sur les trois clients. La
règle est volontairement bête pour être reproductible partout :

```
somme   = chaque octet UTF-8 de l'identifiant d'organisation, additionné
couleur = palette[somme % 8]

palette = ["#4C8DFF", "#B57BFF", "#00C2A8", "#FF8A3D",
           "#E75480", "#3FBF5F", "#FFC53D", "#7A8CFF"]
```

**N'utilisez aucun hachage de bibliothèque.** `hashCode` en Kotlin, comme `hashValue` en
Swift, n'est pas garanti stable entre exécutions : la couleur changerait à chaque
ouverture de l'application.

Vecteurs de contrôle :

```
org_stackops    → #7A8CFF
org_1           → #4C8DFF
org_2           → #B57BFF
ORG-9f3c-4d2e   → #FFC53D
```

La couleur choisie par l'utilisateur, dans `\0gp:orgcolors`, l'emporte sur celle-ci. Une
valeur illisible retombe sur la couleur attribuée — jamais sur du noir.

## 4. Le partage de liens — le point de sécurité le plus important

Le serveur relaie les partages vers ghostbit et rend `{ id, url, deleteToken, expiresAt }`.
La clé de déchiffrement est posée **dans le fragment** du lien, après le `#`.

**Le domaine de cette URL doit être vérifié.** Un navigateur n'envoie jamais le fragment
dans la requête HTTP — mais la *page* servie par ce domaine est du code que ce domaine
contrôle, et rien ne l'empêche de lire `location.hash`. Accepter sans contrôle l'adresse
rendue par le serveur revient à le laisser désigner qui recevra la clé : il détient déjà le
chiffré, et obtiendrait le secret en clair.

La règle appliquée sur iOS, à reprendre :

- l'ancre de confiance est **le serveur que l'utilisateur a saisi** ;
- même hôte → accepté ;
- autre hôte → **montré à l'utilisateur** et confirmé ; un refus **révoque** le partage,
  qui existe déjà côté serveur à cet instant ;
- schéma `https` exigé, sauf si le serveur lui-même est en clair (boucle locale) ;
- les domaines approuvés se mémorisent **par serveur**, jamais globalement.

Cas à tester : `ghostpass.example.com.attaquant.example` ne doit pas passer.

**Compatibilité** : un serveur antérieur au relais rend `{ id }` seul. Les champs `url` et
`deleteToken` sont donc **optionnels** ; leur absence fait retomber sur `<serveur>/s/<id>`,
et rien n'est écrit au registre des partages — sans jeton et sans route de révocation, une
ligne y serait un vœu.

## 5. La règle d'affichage qui traverse toute la suite

**Ce qui ne se déchiffre pas s'affiche quand même.** Un élément illisible garde sa place et
dit pourquoi ; il ne disparaît pas. Une ligne absente se lit comme « il n'y a rien », ce
qui est faux.

Corollaire : distinguer « clé manquante » de « donnée vide ». Sur iOS, un titre d'événement
a **quatre** provenances distinctes — déchiffré, rendu en clair par le serveur, scellé mais
non ouvert, ou absent — et les confondre ferait passer une clé manquante pour un élément mal
rempli.

## 6. Le remplissage automatique

Le service d'autofill Android est du Kotlin, comme l'extension iOS est du Swift. C'est la
fonction principale du produit, et la plus dépendante de la plateforme.

**Il lit le coffre depuis le 2026-08-31** (`docs/adr/0002`). Le partage des rôles ne se
devine pas et vaut d'être su : le service ne peut proposer que des lignes **sans valeur** —
une `RemoteViews` est rendue par un autre processus et ne reçoit aucun événement, donc il
n'existe là aucun moyen d'obtenir un geste. Tout ce qui touche aux secrets vit dans
`ActiviteDeRemplissage`, qui a un écran : biométrie, ouverture du coffre par l'enveloppe
d'appareil, choix, et `Dataset`.

**Piège mesuré, et il ne produit aucune erreur** : l'authentification se pose soit sur la
*réponse* (`FillResponse.setAuthentication`), soit sur le *jeu* (`Dataset.setAuthentication`),
et les deux attendent en retour un objet **différent** — une `FillResponse` pour la
première, un `Dataset` pour la seconde. Se tromper n'affiche rien : le journal note
« invalid index (65535) », et le champ reste vide. GhostPass authentifie au niveau du jeu.

Deux choses apprises côté iOS qui devraient transposer :

- **le rapprochement d'hôtes n'utilise pas de liste de suffixes publics.** Voir
  `SiteMatching.swift` : deux domaines frères ne sont jamais rapprochés (c'est correct),
  mais un hôte qui *est* un suffixe public (`github.io`) correspond à tout ce qui est
  dessous. Le défaut le plus visible à l'usage est un faux **négatif** :
  `mail.google.com` ne propose rien sur `accounts.google.com` ;
- **rien ne se remplit sans interaction.** L'extension iOS refuse systématiquement le
  remplissage sans intervention de l'utilisateur.

## 7. L'application est gratuite, et doit le prouver

StackOps met GhostPass à disposition gratuitement. Ce qui se paie, chez ceux qui ne
veulent pas auto-héberger, est la **mise à disposition d'une VM** — pas le logiciel.

C'est une qualification juridique, et aucun relecteur ne juge sur la qualification : il
juge sur ce que **contient l'application**. Trois choses décident, et les trois doivent
rester vraies sans que personne n'ait à s'en souvenir :

- aucun tarif affiché, aucun renvoi vers un achat ;
- aucun point de terminaison de l'éditeur en dur ;
- un premier lancement qui aboutit à un coffre utilisable **contre une instance
  quelconque**, sans jamais toucher `stackops.ch`.

Côté iOS, `tools/ios/verifier-l-autonomie.sh` mesure les deux premiers **sur le paquet
construit**, jamais sur les sources : la fiche App Store parle légitimement de tarif, les
ADR d'abonnement, et un `grep` sur le dépôt demanderait une liste d'exclusions qui
pourrit. C'est ainsi qu'un garde-fou de la suite a expédié en production la classe CSS
qu'il interdisait — il a scanné son propre texte.

**Écrire l'équivalent pour l'APK**, et le brancher dans la CI. Deux pièges mesurés en
l'écrivant pour iOS, qui transposeront :

- une recherche insensible à la casse sur `EUR` trouve « eur » dans `erreur33` et fait
  rougir toute l'application. Les codes de devise se cherchent **en capitales, bornés par
  des limites de mot** ;
- le troisième point n'est prouvé par aucun scan de chaînes. Ce qui le prouve est un test
  de bout en bout contre une instance locale. Sans lui, le contrôle reste vert et ne veut
  plus rien dire.

Et le contrôle doit **savoir tomber** : ajoutez une chaîne de tarif dans une branche
jetable, reconstruisez, et vérifiez qu'il rougit. Injecter les octets à la fin du binaire
ne suffit pas — mesuré sur iOS : `strings` ne lit pas ce qui suit le dernier segment d'un
Mach-O, et le témoin passait au vert en croyant prouver quelque chose.

Enfin : les règles de Google sur les paiements hors application sont **voisines de celles
d'Apple, pas identiques**, et les deux ont bougé plusieurs fois. Elles sont à relire sur
le texte en vigueur avant chaque soumission, pas à transposer.

## 8. Le SSO — et le piège que GhostCal nous a montré

**Un compte peut n'avoir aucun mot de passe.** Sur une instance où l'authentification passe
par un fournisseur d'identité, `password_hash` est nul, et la route de connexion classique
rend « identifiants invalides » — le même message que pour un mauvais mot de passe, et
volontairement, pour ne pas révéler quels comptes existent.

Mesuré ce matin : Clara n'a pas pu se connecter à GhostCal depuis mobile, et le message ne
disait rien de la vraie cause. **Un client mobile sans SSO est inutilisable sur ces
instances-là**, sans qu'aucun message ne l'explique.

Le serveur GhostPass reçoit en ce moment (autre session) une route `POST
/api/auth/sso/exchange` acceptant `{ code, codeVerifier, nonce, redirectUri }` et rendant la
même charge que le callback web — `{ token, email, kdfParams, encryptedUserKey,
encryptedPrivateKey }`. Alignez-vous sur ces noms ; ne les réinventez pas.

**Le point de sécurité, et il n'est pas négociable** : flux à code d'autorisation **avec
PKCE mené par l'application** (RFC 8252). Pas de redirection finale du serveur portant le
jeton : sur Android comme sur iOS, une autre application peut revendiquer un schéma
personnalisé et intercepter cette redirection. Avec PKCE, un code intercepté ne vaut rien
sans le vérificateur, qui ne quitte jamais l'application.

Côté Android : **Custom Tabs**, jamais une WebView — une WebView donne à l'application
l'accès au mot de passe saisi chez le fournisseur d'identité, ce qui annule l'intérêt du
SSO. Et préférez un **App Link vérifié** (`https://`) au schéma personnalisé quand
l'instance le permet : lui seul est réellement exclusif.

Le SSO **authentifie** ; il n'ouvre pas le coffre. Celui-ci s'ouvre ensuite avec le mot de
passe maître, qui dérive la clé. Ces deux rôles sont distincts et les confondre est la
première erreur de conception d'un client à connaissance nulle.

## 9. Les liens de second facteur — déclarer sans traiter est pire que se taire

Mesuré sur iOS ce matin : GhostPass n'apparaissait pas sous « Configurer les codes dans »
alors que l'extension déclarait bien fournir des codes à usage unique. La cause était
ailleurs — **l'application ne déclarait pas savoir ouvrir les liens `otpauth:`**. Ce
réglage désigne l'application qui *ouvre les liens*, pas celle qui *remplit les champs*.

L'équivalent Android est un `intent-filter` sur le schéma `otpauth`. Trois règles, apprises
en le câblant :

- **le lien arrive souvent coffre fermé** — on scanne un QR code, le système réveille
  l'application, qui demande d'abord le mot de passe maître. Le jeter à ce moment-là fait
  qu'on déverrouille pour rien. Il faut le **retenir** jusqu'à ce qu'un écran sache
  l'afficher ;
- **rien ne s'écrit sans geste** : le lien pré-remplit un formulaire, il ne crée pas
  d'entrée. Une URL venue du dehors qui écrirait seule serait un moyen d'ajouter des lignes
  dans le coffre de quelqu'un d'autre ;
- le paramètre `issuer` l'emporte sur le chemin quand les deux se contredisent — un service
  renommé met à jour le paramètre et laisse le chemin d'origine.

Les vecteurs sont dans `apps/ios/Tests/ContractTests.swift`, classe `EtiquetteOtpauthTests`.
À porter tels quels.

## 10. L'apparence — l'application est le petit frère, pas un cousin

Deux règles, toutes deux issues d'un retour de Clara sur le portage Flutter de GhostCal
(« oh c'est moche comparé à l'app de ghostpass ») :

**L'écran d'entrée se copie structure par structure**, pas « dans l'esprit » : enseigne sur
plaque avec son halo, titre, sous-titre, puis une carte de verre portant les champs et les
actions. Reprendre la palette sans le langage visuel donne des composants du système
simplement recolorés — et ça se voit immédiatement.

**L'icône ne se rend pas naïvement.** Les SVG de charte sont cadrés pour un favicon, où la
silhouette touche les bords sans conséquence à 16 px. `suite/tools/brand/icone-ios.py`
mesure la silhouette et la ramène à **80 % de la hauteur, centrée** — la proportion de
l'icône iOS de GhostPass. Sans cette correction, deux produits de la suite ont des
silhouettes de tailles différentes : invisible sur une capture isolée, flagrant sur
l'écran d'accueil.

**L'équivalent Android existe depuis le 2026-08-31** :
`suite/tools/brand/icone-adaptative-android.py`, appelé par
`tools/android/make-brand-assets.sh`. Et la proportion **n'est pas la même**, ce qui est
tout l'objet de l'outil. Une icône adaptative fait 108 dp, mais seule la zone centrale de
**72 dp** est garantie visible : le reste est rogné selon le masque du lanceur. Les 80 %
portent donc sur la zone sûre :

```
72 dp × 80 %  =  57,6 dp de silhouette
57,6 / 108    ≈  53 % de la toile
```

Appliquer 80 % à la toile ferait déborder la silhouette de 7,2 dp de chaque côté — rognée
**chez certains utilisateurs seulement**. L'outil remesure le PNG qu'il vient d'écrire et
refuse d'écrire si la silhouette sort de la zone sûre ; la recette naïve à 80 % est bien
refusée, vérifié.

## 11. Ce qui était à décider — et qui l'est

Les deux points de cette section sont **tranchés et mis en œuvre** depuis le 2026-08-31.

**Le partage du trousseau entre l'application et le service** : `docs/adr/0002`. Ce n'est
pas la transposition d'`0001` — sur Android le service tourne dans le processus de
l'application, même bac à sable, mêmes alias de KeyStore. Il n'y a rien à partager parce
que rien n'est séparé. La vraie question était « que persiste-t-on pour qu'un
déverrouillage sans interface soit possible » ; la réponse est la clé du coffre enveloppée
par le cœur sous un secret aléatoire, ce secret scellé par une clé de l'`AndroidKeyStore`.
L'enveloppe passe par `wrap_user_key_for_passkey` / `unlock_with_passkey`, déjà dans le
cœur et déjà partagées avec le déverrouillage par passkey du web : rien n'a été écrit en
Kotlin, et il n'existe pas de second format d'enveloppe pour Android.

**La biométrie** : `BiometricPrompt` sur la même clé (`Biometrie.kt`, `CleDEnveloppe.kt`).

Trois choses mesurées en l'écrivant, qu'aucune lecture de documentation ne donne :

- **`KeyInfo.isInvalidatedByBiometricEnrollment` ne témoigne de rien.** Il rapporte `true`
  quoi qu'on ait demandé au constructeur, parce qu'il dérive du *type d'authentificateur*
  de la clé et non du drapeau. Un test qui le lit est vert des deux côtés de la mutation —
  le premier témoin écrit ici l'était. Le témoin qui vaut est
  `tools/android/temoin-de-l-invalidation.sh` : il enrôle une empreinte de plus, pour de
  vrai, et regarde si la clé sert encore ;
- **ce qui protège réellement ici est l'authentification *par usage*** (zéro seconde de
  validité) sur biométrie forte, pas le drapeau — qui est redondant dans cette
  configuration. Une durée de validité positive attache la clé à l'horloge du système : la
  clé témoin ainsi construite **survit** à l'enrôlement, mesuré ;
- **la biométrie seule, sans `AUTH_DEVICE_CREDENTIAL`.** L'ADR écrit « biométrie ou code de
  l'appareil » ; autoriser le code désarmerait l'invalidation, puisque l'attaque décrite
  suppose déjà de connaître ce code. C'est un écart assumé, écrit dans `CleDEnveloppe.kt`.

Plancher d'API : la politique complète demande l'**API 28** (`setUnlockedDeviceRequired`),
alors que `minSdk` est 24. En dessous, le raccourci n'est pas proposé du tout — plutôt que
de poser deux réglages sur trois sans le dire.

## 12. Ce qui reste à faire

- **Les liens `otpauth:`** (§9). L'écran d'édition existe désormais et porte un champ de
  second facteur ; l'`intent-filter` et la rétention du lien coffre fermé restent à écrire.
- **Le SSO** (§8). Rien n'en est fait.
- **Le partage de liens** (§4). `DestinationDePartage` porte la règle de domaine et elle est
  éprouvée par les vecteurs ; aucun écran ne s'en sert.
- **Les registres en écriture.** Ils se lisent (dossiers, favoris, partages, couleurs) ;
  rien ne les réécrit, donc mettre un élément en favori n'est pas possible.
- **Un parcours de premier lancement automatisé**, celui que `verifier-l-autonomie.sh` dit
  ne pas prouver. Il a été fait **à la main** contre un serveur local sur émulateur le
  2026-08-31 — connexion, coffre, biométrie, création, remplissage — mais rien ne le rejoue.
