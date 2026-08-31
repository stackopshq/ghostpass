# GhostPass sur Android — ce qu'il faut savoir avant d'écrire une ligne

GhostPass iOS reste en Swift : l'application est un produit d'intégration système —
extension de remplissage, trousseau sous contrôle biométrique, groupe d'applications,
verrouillage sur les phases de scène — et c'est exactement là qu'un cadre multiplateforme
aide le moins. Son Android est donc une application **Kotlin native**, pas un portage.

Ce document rassemble ce qui ne se devine pas. Chacun des points ci-dessous a la même
propriété désagréable : **un écart ne produit aucune erreur**. Il rend simplement des
données illisibles chez un autre client, ou plus tard, ou chez quelqu'un d'autre.

## 0. Le prérequis, avant tout le reste

**Rien ne compile le cœur pour Android aujourd'hui.** `tools/ios/build-xcframework.sh`
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

## 8. Ce qui reste à décider

- Le partage du trousseau entre l'application et le service d'autofill. Sur iOS, la
  décision est prise et documentée (`docs/adr/0001`) : on partage, parce qu'un mot de passe
  maître retapé dix fois par jour est un mot de passe maître qu'on raccourcit. L'équivalent
  Android — un `KeyStore` et un identifiant d'application partagé — demande sa propre
  analyse.
- La biométrie : `BiometricPrompt` avec une clé invalidée à l'enrôlement d'une nouvelle
  empreinte, l'équivalent de `.biometryCurrentSet`.
