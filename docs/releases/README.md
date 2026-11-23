# Notes de version

Chaque produit a ses étiquettes, parce qu'ils ne sortent pas ensemble :

| Étiquette | Produit | Ce que le pipeline de l'étiquette fait |
|---|---|---|
| `server-vX.Y.Z` | serveur et interface web (les images) | vérifie, publie les images, crée la Release GitHub |
| `ios-vX.Y.Z` | application iOS | vérifie seulement : la soumission à Apple reste manuelle |
| `android-vX.Y.Z` | application Android | vérifie seulement : le dépôt sur Play reste manuel |

Un `v*` nu ne déclenche plus rien. `v0.1.0`, posée avant cette règle, désigne le serveur et
l'interface web.

## Publier une version du serveur

Un fichier par version, nommé comme son étiquette : `server-v0.2.0.md` (`v0.1.0.md` date
d'avant les préfixes). Il devient le texte de la page Release sur GitHub, que lisent ceux qui
hébergent GhostPass. Il est donc écrit pour eux, en anglais : ce qui change, ce qu'il faut
régler dans `.env`, et ce qu'il faut faire avant de mettre à jour.

1. Écrire `docs/releases/server-vX.Y.Z.md` dans une MR, la faire relire, la fusionner.
2. Attendre que le pipeline de `main` soit vert.
3. Poser l'étiquette `server-vX.Y.Z` sur ce commit de `main`.

Le pipeline de l'étiquette publie alors :
- les images `vX.Y.Z` et `vX.Y.Z-web`, sans le préfixe, sur le registre du projet et sur
  ghcr.io (job `images`) ;
- la page Release « GhostPass vX.Y.Z » sur GitHub, avec ce fichier pour texte (job
  `release-github`).

Le job `release-github` échoue s'il manque le fichier de notes. Il ne fait rien si le jeton
`GITHUB_RELEASE_TOKEN` est absent, et il ne remplace pas une Release qui existe déjà.

## Étiqueter une version mobile

Poser `ios-vX.Y.Z` ou `android-vX.Y.Z` sur le commit de `main` d'où vient le paquet envoyé en
boutique, avec le numéro que la boutique affiche. L'étiquette ne publie rien : elle dit quel
code est en ligne, et son pipeline garde la trace des vérifications de ce commit.
