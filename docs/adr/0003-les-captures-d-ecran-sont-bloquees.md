# 0003 — Les captures d'écran sont bloquées, y compris celles de l'utilisateur

*Décidé le 2026-08-31. Statut : accepté.*

## Ce qui se décide ici

L'application Android pose `FLAG_SECURE` sur sa fenêtre, sans condition et pour toute la
durée de vie de l'activité. Le système refuse alors d'en faire une image : ni capture, ni
enregistrement d'écran, ni vignette dans le sélecteur d'applications.

**Y compris pour l'utilisateur lui-même.** C'est la partie qui se décide, et elle a été
constatée avant d'être acceptée : le 2026-08-31, sur un Redmi Note 9S, une capture de
l'écran d'accueil du téléphone rend 3,8 Mo et une capture de GhostPass rend **zéro octet**.

## Ce que ça protège

- **Les vignettes du sélecteur d'applications**, qu'Android écrit sur disque. Sans ce
  drapeau, le contenu d'un coffre déverrouillé s'y retrouve, et y reste ;
- **les enregistrements d'écran**, y compris ceux qu'une autre application lance ;
- **le partage d'écran**, qui est le vecteur le plus banal : quelqu'un en visioconférence
  qui ouvre son gestionnaire de mots de passe sans y penser.

## Ce que ça ne protège pas, et qu'il ne faut pas croire

Une photographie de l'écran avec un second appareil. Rien ne l'empêche, et aucun drapeau
ne le pourra jamais.

## Le coût, assumé

Quelqu'un qui veut montrer un défaut à un support, ou garder la trace d'un écran, ne peut
pas. C'est une gêne réelle et elle a été pesée : Bitwarden fait le même choix, et le
positionnement de sécurité du produit le justifie.

**C'est aussi la raison d'écrire cette décision.** Un drapeau dont personne ne se souvient
du motif se fait retirer par le premier qui trouve la gêne — probablement en réponse à un
utilisateur mécontent, probablement sans mesurer ce qu'il rouvre.

## Posé une fois, jamais au fil des écrans

Le drapeau vaut pour toute l'activité et non pour les seuls écrans qui montrent des
secrets. Une fenêtre qui le gagne et le perd au fil de la navigation finit par le perdre au
mauvais moment — pendant une transition, une reprise, un écran qu'on n'avait pas prévu.

## L'asymétrie avec iOS, qui n'est pas un oubli

**iOS ne sait pas faire ça.** Aucune API n'y empêche une capture d'écran, et c'est un choix
d'Apple. GhostPass iOS fait ce qu'il peut : `VoileDeConfidentialite` recouvre l'interface
dès que la scène quitte l'état actif, ce qui protège la vignette du sélecteur — mais **pas
la capture, ni l'enregistrement, ni le partage d'écran**.

Les deux plateformes n'offrent donc pas la même garantie, et c'est structurel. Il ne faut ni
présenter cette protection comme une propriété du produit dans une page publique, ni
conclure qu'iOS a un défaut à corriger.
