# Les pièces du dossier ANSSI

Ce répertoire porte les pièces telles qu'elles partent à l'ANSSI, dans les formats qu'elle
accepte — `.pdf`, `.xls`, `.doc`. Le markdown n'en fait pas partie.

## Pourquoi ces fichiers sont versionnés alors qu'ils sont dérivés

`GhostPass-dossier-technique.pdf` et `.docx` se régénèrent depuis
[`../../anssi-dossier-technique.md`](../../anssi-dossier-technique.md). On pourrait donc
ne garder que la source.

Ils sont conservés parce qu'un dossier réglementaire n'est pas un livrable ordinaire :
**ce qui compte est ce qui a été déposé**, pas ce qu'on saurait reconstruire. Si l'annexe
technique évolue — elle le fera, le code bouge — une régénération ne rendrait plus le
document que l'administration a reçu. Un contrôle porte sur la pièce envoyée, à sa date.

C'est le même raisonnement que pour le courriel de notification au BIS, dont la copie est
la seule trace de la démarche.

## Les deux brochures, et pourquoi elles sont distinctes

Le formulaire réclame **deux pièces**, et leurs aides le disent :

- **brochure commerciale** — « aperçu du moyen de cryptologie, décrivant ses fonctions
  principales et les fonctionnalités cryptographiques ». Elle se lit sans être du métier.
  Source : [`brochure-commerciale.md`](brochure-commerciale.md).
- **brochure technique** — « spécifications techniques détaillées ». Source :
  [`../../anssi-dossier-technique.md`](../../anssi-dossier-technique.md).

Joindre la seconde en croyant avoir répondu aux deux est l'erreur facile : elles portent
des noms voisins et le même sujet, mais l'ANSSI attend deux niveaux de lecture différents.

## Régénérer

    docs/legal/anssi/produire-les-pieces.sh

Le script produit les trois pièces en PDF et en DOCX, **et retire des documents envoyés
les passages destinés à la lecture interne**.

C'est sa raison d'être. `anssi-dossier-technique.md` est un document de travail : il porte
un avertissement qui s'adresse à l'éditrice — « je ne suis pas juriste », « à faire
relire » — et une section « À compléter avant dépôt ». Utiles dans le dépôt, ils n'ont rien
à faire dans une pièce envoyée à une administration : ils parlent du processus de
rédaction, pas du produit déclaré. Converti à la main, le document partait avec. Clara l'a
vu avant l'envoi.

Le script se termine par un contrôle qui relit **les PDF produits** et refuse d'aboutir
s'il y reste une trace interne. Deux choses ont failli le rendre inutile, et elles sont
écrites dans le fichier :

- il lisait les PDF avec `pandoc`, qui **ne lit pas le PDF en entrée**. Il échouait en
  silence, `grep` cherchait dans du vide, et le contrôle restait vert alors que le
  nettoyage était désactivé. Remplacé par `pdftotext`, et **éprouvé par mutation** : sans
  le nettoyage, il rougit sur la bonne pièce ;
- le drapeau `-exit-on-error` de `pdftotext` rend 99 sur des avertissements bénins, ce qui
  rendait le contrôle faussement rouge. C'est le **texte vide** qui fait foi : si rien ne
  sort du PDF, le contrôle n'a rien lu et doit le dire plutôt que de conclure.

Si `pdftotext` manque, le script sort en **2** — ni vert ni rouge, mais « pas pu
regarder ».

**Si un dépôt est refait, dater les fichiers plutôt que les écraser** —
`GhostPass-dossier-technique-2027-01-15.pdf` — pour garder ce qui a été envoyé la fois
d'avant.

## Ce qui n'est pas ici, et pourquoi

Le **formulaire rempli et signé** n'y est pas. Il porte une signature manuscrite et les
coordonnées personnelles du déclarant ; sa place est dans les archives de l'entreprise, pas
dans un dépôt dont le miroir est public.

Les **pièces administratives** — présentation de la société, extrait K bis — non plus, pour
la même raison.

## Voir aussi

- [`anssi-formulaire-reponses.md`](../../anssi-formulaire-reponses.md) — les réponses à
  recopier dans le formulaire, rubrique par rubrique.
- [`anssi-dossier-technique.md`](../../anssi-dossier-technique.md) — la source de ce qui est
  ici.
- [`bis-autoclassification.md`](../../bis-autoclassification.md) — le volet américain, qui
  est une démarche distincte et due pour une autre raison.
