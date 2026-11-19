# Notes de version

Un fichier par version, nommé comme son étiquette : `v0.1.0.md`. Il devient le texte de la
page Release sur GitHub, que lisent ceux qui hébergent GhostPass. Il est donc écrit pour
eux, en anglais : ce qui change, ce qu'il faut régler dans `.env`, et ce qu'il faut faire
avant de mettre à jour.

## Publier une version

1. Écrire `docs/releases/vX.Y.Z.md` dans une MR, la faire relire, la fusionner.
2. Attendre que le pipeline de `main` soit vert.
3. Poser l'étiquette `vX.Y.Z` sur ce commit de `main`.

Le pipeline de l'étiquette publie alors :
- les images `vX.Y.Z` et `vX.Y.Z-web`, sur le registre du projet et sur ghcr.io (job
  `images`) ;
- la page Release sur GitHub, avec ce fichier pour texte (job `release-github`).

Le job `release-github` échoue s'il manque le fichier de notes. Il ne fait rien si le jeton
`GITHUB_RELEASE_TOKEN` est absent, et il ne remplace pas une Release qui existe déjà.
