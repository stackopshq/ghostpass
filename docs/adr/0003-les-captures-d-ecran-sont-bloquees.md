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

## iOS y arrive aussi — corrigé le 2026-08-31, après mesure

**Ce paragraphe disait « iOS ne sait pas faire ça ». C'était faux**, et il valait mieux
l'apprendre par une idée de Kevin que par un utilisateur.

Il est exact qu'iOS n'offre **aucune API** pour interdire une capture. Mais la couche de
rendu d'un `UITextField` en saisie sécurisée est exclue des captures, des enregistrements
et du partage d'écran. On y range le contenu de l'application, et le système rend du noir à
sa place. C'est ce que fait `ProtectionDesCaptures`.

Mesuré sur iPhone, capture de l'utilisateur, **avec son contrôle négatif** :

| | Ce que l'image contient |
|---|---|
| avec la protection | noir |
| sans la protection | l'écran, lisible |

L'écart entre les deux est ce qui prouve. Le noir seul ne prouvait rien : une image vide
pour une autre raison — écran verrouillé, application passée en arrière-plan pendant le
geste — aurait passé pour un succès.

### Ce que cette version-ci coûte, et qu'Android ne coûte pas

`FLAG_SECURE` est une API publique et garantie. La couche sécurisée d'iOS ne l'est pas : on
n'appelle rien de privé, mais on s'appuie sur une structure de vues qu'Apple ne documente
pas. **Le jour où elle change, la protection échoue en s'ouvrant** — les captures
redeviennent lisibles, sans erreur ni signe, et l'on continue de compter dessus.

D'où `ProtectionDesCapturesTests`, dont c'est l'unique raison d'être : il vérifie que le
détournement a encore une prise. Il ne mesure pas la couleur de l'image — cela ne se fait
que sur un appareil — mais il tombera avant qu'un utilisateur ne découvre la régression.

### Ce qui reste vrai des deux côtés

Aucune des deux plateformes n'empêche une photographie de l'écran avec un second appareil,
et il ne faut pas présenter cette protection comme une propriété du produit sans dire
laquelle.
