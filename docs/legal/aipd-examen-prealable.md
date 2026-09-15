# Analyse d'impact — examen préalable

> **Projet — à faire relire par un juriste.**
> Ce document ne conclut pas qu'aucune analyse d'impact n'est due. Il conclut
> qu'**au vu de ce qui est mesurable aujourd'hui**, elle ne l'est pas, et il
> nomme précisément ce qui renverserait cette conclusion.

*Version 0.2 — 2026-08-31. Article 35 du règlement (UE) 2016/679 (RGPD).*

---

## Ce que ce document est, et n'est pas

L'article 35 impose une analyse d'impact (AIPD) lorsqu'un traitement est
« susceptible d'engendrer un risque élevé » pour les droits et libertés des
personnes. **Décider qu'il n'y en a pas est en soi une décision**, et une
autorité qui contrôle demande à la voir motivée.

Ce document est cet examen préalable — une page, refaite quand un critère bouge.
Ce n'est **pas** une analyse d'impact : si l'un des déclencheurs du §4 se
réalise, il faut en écrire une vraie.

## 1. Qui doit la faire, et pour quoi

L'article 35 s'adresse au **responsable du traitement**. Les deux régimes de
GhostPass ne sont donc pas dans la même situation.

| Régime | Responsable | À qui incombe l'AIPD |
|---|---|---|
| **Comptes individuels** | StackOps | **À StackOps** — objet du présent examen |
| **Coffres d'organisations** | Le Client | **Au Client.** StackOps doit l'y *aider* (art. 28.3.f), pas la faire à sa place |

Ce que StackOps fournit à un Client qui mène la sienne est listé au §5.

## 2. Les trois cas de l'article 35.3

| Cas | GhostPass |
|---|---|
| **a)** Évaluation systématique et approfondie fondée sur un traitement automatisé, dont le profilage, produisant des effets juridiques | **Non.** Aucun profilage, aucune décision automatisée. Mesuré : le serveur ne contient aucune logique de scoring |
| **b)** Traitement à grande échelle de données sensibles (art. 9) ou d'infractions (art. 10) | **Non**, et pour une raison de fait : les secrets sont **chiffrés côté client**. Un utilisateur peut ranger une donnée de santé dans son coffre — StackOps ne peut ni le savoir ni la lire, et ne la traite donc pas au sens de l'article 9 |
| **c)** Surveillance systématique à grande échelle d'une zone accessible au public | **Non.** Sans objet |

**Aucun des trois n'est rempli.** Mais l'article 35.3 n'est qu'une liste
d'exemples : l'obligation naît du « risque élevé », pas de la liste.

## 3. Les neuf critères du CEPD (lignes directrices WP248)

Deux critères ou plus remplis appellent en principe une AIPD. Voici l'examen,
critère par critère, sans arrondir.

| Critère | Rempli | Pourquoi |
|---|---|---|
| Évaluation ou notation | Non | Aucun score, aucune prédiction |
| Décision automatisée à effet juridique | Non | Aucune |
| Surveillance systématique | Non | Les traces de connexion servent la sécurité du compte, pas l'observation des personnes, et sont purgées à 90 jours |
| **Données sensibles ou à caractère hautement personnel** | **Partiellement** | Voir ci-dessous — c'est le seul critère qui mérite un débat |
| Traitement à grande échelle | **Non aujourd'hui** | Voir §4, c'est le déclencheur le plus probable |
| Croisement de jeux de données | Non | Aucun croisement, aucun enrichissement externe |
| Personnes vulnérables | Non pour les comptes individuels | Pour les organisations, les membres sont des salariés du Client — et c'est **au Client** que ce critère s'applique |
| Usage innovant ou nouveau | Non | Le chiffrement de bout en bout d'un coffre est une technique mature, largement déployée |
| Blocage d'un droit ou d'un service | Non | Aucun refus de service n'est décidé par un traitement |

### Le seul critère discutable, et il mérite d'être discuté

Un coffre de mots de passe contient, par nature, les clés d'accès à la banque, à
la messagerie, au dossier médical. **Le contenu est donc de la donnée hautement
personnelle** au sens le plus fort du terme.

Ce qui empêche de conclure au risque élevé n'est pas que la donnée serait
anodine, c'est que **StackOps ne la traite pas**. Elle transite chiffrée, se
range chiffrée, ressort chiffrée, et aucune clé n'existe de notre côté — le
serveur ne contient aucune primitive capable d'ouvrir un coffre, ce qui est
vérifiable dans un dépôt public. Il détient **une** opération de déchiffrement,
et une seule : celle qui lit le secret du second facteur pour vérifier un code.
Elle n'ouvre rien d'autre, et surtout aucun contenu.

**C'est un raisonnement qui tient tant que le zero-knowledge tient.** Le jour où
une fonctionnalité demanderait au serveur de lire un secret, ce critère
basculerait, et cet examen avec lui.

## 4. Ce qui renverse cette conclusion

Refaire cet examen — et probablement écrire une AIPD — dès qu'une de ces lignes
devient vraie :

| Déclencheur | Pourquoi il compte |
|---|---|
| **Le serveur acquiert un moyen de lire un secret**, pour quelque fonctionnalité que ce soit | Le raisonnement du §3 repose entièrement là-dessus |
| **La liste de la CNIL** des traitements soumis à AIPD couvre ce cas | Elle n'a pas été vérifiée ici et doit l'être — c'est le point le plus concret à confier au juriste |
| **Passage à grande échelle** | Le critère « grande échelle » n'a pas de seuil chiffré dans le règlement. Nous en fixons un **interne** pour ne pas décider à l'aveugle : au-delà de **5 000 comptes** ou d'un Client de plus de **500 membres**, on refait l'examen. Ce seuil n'a aucune valeur légale ; il sert à ce que la question soit posée avant qu'il soit tard |
| **Ajout d'une donnée sensible en clair** — santé, biométrie, opinions | Ferait entrer dans l'art. 35.3.b si l'échelle suit |
| **Une nouvelle catégorie de personnes concernées** — mineurs, patients, usagers d'un service public | Change le profil de vulnérabilité |
| **Représentation en Suisse** (art. 14 de la loi suisse révisée) | Elle suppose **quatre** conditions **cumulatives** : traiter des données de personnes en Suisse, **à grande échelle**, de manière **régulière**, **et** avec un **risque élevé**. Les deux dernières ne sont pas remplies aujourd'hui, et la dernière tombe précisément avec la conclusion du §3 — ce qui lie ce déclencheur au premier de ce tableau. À réexaminer au même seuil que les autres : **5 000 comptes**, ou un Client de plus de **500 membres**. C'est l'obligation que l'on croit à tort déclenchée dès qu'un utilisateur suisse existe |

**Un examen préalable qui ne dit pas quand le refaire ne sert qu'une fois.**
C'est pourquoi ce tableau existe, et pourquoi il est plus long que la conclusion.

## 5. Ce que StackOps fournit à un Client qui mène sa propre AIPD

Le Client est responsable de traitement : l'AIPD lui incombe, et l'art. 28.3.f
nous oblige à l'y aider. Sur demande écrite, nous fournissons :

- l'[accord de sous-traitance](dpa.md) et ses annexes — finalités, données,
  durées, sous-traitants ultérieurs, transferts ;
- le [registre des traitements](registre-des-traitements.md) ;
- le présent examen ;
- la description des mesures de sécurité par modèle d'hébergement (DPA §5 et
  §5 bis) ;
- **le code source**, qui est public — un Client peut vérifier lui-même
  l'affirmation centrale de cet examen plutôt que de nous croire.

## 6. Conclusion

**Aucune analyse d'impact n'est requise à ce jour** pour les comptes
individuels, pour lesquels StackOps est responsable du traitement :

- aucun des trois cas de l'article 35.3 n'est rempli ;
- un seul des neuf critères du CEPD est partiellement rempli, et il l'est par le
  *contenu* du coffre, que StackOps ne traite pas.

Cette conclusion est **datée et conditionnelle**. Elle tombe avec le premier
déclencheur du §4, et le premier d'entre eux — la vérification de la liste de la
CNIL — n'a pas encore été faite.

## Journal des versions

| Version | Date | Modification |
|---|---|---|
| 0.1 | 2026-08-31 | Création. Conclusion : pas d'AIPD requise, sous les cinq réserves du §4 |
| 0.2 | 2026-08-31 | Le §3 dit désormais ce que le serveur déchiffre *réellement* — le secret du second facteur, et rien d'autre — plutôt qu'« aucune primitive de déchiffrement », que le code réfute. La représentation en Suisse (art. 14 de la loi révisée) entre au tableau des déclencheurs du §4, au même seuil que les autres. La conclusion est inchangée |
