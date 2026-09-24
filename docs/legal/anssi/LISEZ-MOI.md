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

## Régénérer

    pandoc docs/anssi-dossier-technique.md \
      --metadata title="GhostPass — dossier technique" \
      --metadata author="StackOps" \
      -o docs/legal/anssi/GhostPass-dossier-technique.docx

    pandoc docs/anssi-dossier-technique.md -s --embed-resources \
      --metadata title="GhostPass — dossier technique" -o /tmp/dossier.html
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
      --headless --disable-gpu --no-pdf-header-footer \
      --print-to-pdf=docs/legal/anssi/GhostPass-dossier-technique.pdf file:///tmp/dossier.html

**Le PDF passe par le navigateur et non par pandoc seul** : `pandoc -o x.pdf` réclame un
moteur LaTeX, soit plusieurs gigaoctets installés pour une conversion. Chrome était déjà
là.

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
