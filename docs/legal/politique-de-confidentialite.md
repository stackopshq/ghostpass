# Politique de confidentialité — GhostPass

*Version 0.4 — 2026-09-25. Articles 12 à 14 du règlement (UE) 2016/679 (RGPD).*

---

## En une phrase

GhostPass ne peut pas lire vos secrets : ils sont chiffrés sur votre appareil,
avec une clé que nous n'avons jamais. Ce que nous détenons, et que cette page
détaille sans détour, ce sont votre adresse de courriel et la **structure** de
votre coffre.

## Qui est responsable

| | |
|---|---|
| Éditeur | **StackOps**, entreprise individuelle de Kevin Allioli |
| Siège | Saint-Julien-en-Genevois (Haute-Savoie), France |
| Contact protection des données | privacy@stackops.ch |
| Délégué à la protection des données | Aucun — la loi n'en impose pas un ici |

**Si vous utilisez GhostPass via votre employeur ou votre organisation**, c'est
cette organisation qui décide des finalités, et c'est donc *elle* le responsable
du traitement. StackOps agit alors comme sous-traitant, et sa politique à elle
s'applique en plus de celle-ci. Adressez-lui vos demandes en premier.

## Ce que nous savons de vous, et ce que nous ne savons pas

C'est la partie qui compte, et elle est courte.

| Donnée | Ce que StackOps en voit |
|---|---|
| **Le contenu de vos secrets** — identifiants, notes, cartes, fichiers | **Rien.** Chiffré sur votre appareil. Nous n'avons aucune clé, et rien, côté serveur, ne peut ouvrir un coffre |
| **Les noms de vos dossiers personnels** | Rien — chiffrés aussi |
| Votre adresse de courriel | **En clair.** C'est votre identifiant de connexion |
| Les noms d'organisations, de collections et de groupes | **En clair** |
| Les domaines des sites que vous enregistrez | **De passage**, uniquement si le service d'icônes est activé, pour aller chercher le logo du site |
| Votre adresse IP et votre navigateur, à la connexion | En clair, **effacés au bout de 90 jours** |
| Vos actions sensibles (journal d'audit) | En clair, **effacées au bout de 365 jours** |

**Ce tableau dit une chose que la publicité des coffres-forts dit rarement :** le
contenu nous est inaccessible, la **structure** ne l'est pas. Savoir que vous
avez une collection nommée « Banque » ne nous apprend pas ce qu'elle contient,
mais ce n'est pas rien, et vous avez le droit de le savoir avant de vous
inscrire.

## Pourquoi nous traitons ces données, et à quel titre

| Finalité | Base légale |
|---|---|
| Vous fournir le coffre que vous avez demandé | **Exécution du contrat** (art. 6.1.b) |
| Vous authentifier, et repérer les tentatives d'accès abusives | **Intérêt légitime** (art. 6.1.f) — protéger les comptes |
| Tracer les actions sensibles sur votre compte | **Intérêt légitime** et obligation de sécurité (art. 32) |

**Nous ne faisons rien d'autre avec.** Pas d'analyse comportementale, pas de
profilage, pas de publicité, pas d'entraînement de modèle, pas de revente.
Aucune décision automatisée n'est prise à votre sujet.

## Combien de temps

| Donnée | Durée |
|---|---|
| Traces de connexion (IP, navigateur) | 90 jours |
| Journal d'audit | 365 jours |
| Compte et coffre | Jusqu'à ce que vous les supprimiez |
| Sauvegardes chiffrées | **Jusqu'à environ 12 mois** après la suppression |

**L'écart entre les deux dernières lignes est réel et nous l'écrivons plutôt que
de l'arrondir.** Supprimer votre compte l'efface de la production immédiatement ;
les sauvegardes chiffrées, elles, tournent sur un cycle plus long, et un
effacement immédiat détruirait celles des autres utilisateurs.

## Qui d'autre voit passer ces données

| Destinataire | Ce qu'il fait | Où |
|---|---|---|
| **Cloudflare, Inc.** | Achemine le trafic vers les instances de la suite : `pass.ghostsuite.cloud`, `cal.ghostsuite.cloud`, `bit.ghostsuite.cloud` | États-Unis |
| **Infomaniak** (Swiss Backup) | Reçoit les sauvegardes, **déjà chiffrées** avant de partir | Suisse |
| **OVH** | Héberge la machine, si votre organisation a choisi une instance dédiée | France — Gravelines et Roubaix |

**Deux de ces destinations sont hors de l'Union européenne :** les États-Unis,
encadrés par les clauses contractuelles types, et la Suisse, reconnue par la
Commission européenne comme offrant une protection adéquate.

Personne d'autre. Aucune régie publicitaire, aucun outil de mesure d'audience,
aucun courtier de données.

### Le partage d'un secret passe par ghostbit

Quand vous créez un lien de partage, le secret **chiffré** est déposé chez
**ghostbit**, un autre service de la suite Ghost. Ce n'est pas un tiers : c'est
StackOps, sur son infrastructure — d'où son absence du tableau ci-dessus, qui
liste les entreprises extérieures.

Nous l'écrivons quand même, parce qu'un bloc de données **traverse** réellement,
et que « ne sort pas » et « sort illisible » ne sont pas la même phrase. La clé
qui ouvre ce bloc vit dans la partie de l'adresse située **après le `#`** — celle
que votre navigateur n'envoie à aucun serveur. Ghostbit reçoit donc quelque chose
qu'il ne peut pas lire, et nous non plus.

Si votre organisation dispose d'une instance dédiée, le partage passe par **son**
ghostbit et non par le nôtre.

### Ce que Cloudflare peut, et que nous préférons écrire

Cloudflare achemine le trafic, donc il vous **sert le code JavaScript qui
chiffre**. Un intermédiaire capable de modifier ce code pourrait défaire le
chiffrement, sans jamais toucher à nos serveurs.

Ce n'est pas propre à GhostPass : c'est la limite de tout chiffrement livré par
un navigateur, chez tous les produits comparables. **Nous préférons l'écrire
plutôt que de laisser croire à une garantie que la technique ne donne pas.**

Vous pouvez la supprimer entièrement : GhostPass s'installe sur votre propre
serveur, et alors plus rien ne passe par nous.

## Vos droits

Vous pouvez à tout moment :

- **accéder** à vos données et en obtenir une copie — bouton d'export dans votre
  compte, ou `GET /api/account/export` ;
- **les corriger** si elles sont inexactes ;
- **les effacer** — bouton de suppression de compte, effet immédiat ;
- **les emporter** ailleurs, dans un format lisible par une machine ;
- **vous opposer** aux traitements fondés sur notre intérêt légitime ;
- **demander la limitation** d'un traitement que vous contestez.

Écrivez à **privacy@stackops.ch**. Nous répondons dans le mois, et vous dirons
avant l'échéance si le délai doit être prolongé.

**Une limite honnête sur l'export** : les champs chiffrés vous sont rendus
**tels quels**. Nous ne pouvons pas les déchiffrer — c'est le prix exact du
zero-knowledge, pas une insuffisance de l'export. Vous les ouvrez avec votre clé,
hors de nos serveurs.

**Si vous perdez votre mot de passe maître, nous ne pouvons rien.** Ni le
réinitialiser, ni récupérer le coffre. C'est la conséquence directe de ne pas
détenir vos clés, et il faut le savoir avant de commencer, pas après.

## Réclamation

Si notre réponse ne vous satisfait pas, vous pouvez saisir la **CNIL**,
3 place de Fontenoy, 75007 Paris — <https://www.cnil.fr/fr/plaintes>.

Si vous résidez en Suisse, vous pouvez également saisir le **PFPDT**,
<https://www.edoeb.admin.ch>.

**Le PFPDT a un second rôle, distinct de celui-là.** Saisir une autorité est
votre droit ; l'informer est notre obligation. En cas de violation de données
présentant un risque élevé pour votre personnalité ou vos droits fondamentaux, le
PFPDT en est aussi le destinataire d'une annonce, « dans les meilleurs délais »
(art. 24 de la loi suisse révisée) — un standard propre à cette loi, et non les
72 heures du RGPD.

## Sécurité

Le détail complet vit dans l'[accord de sous-traitance](dpa.md) et le
[registre des traitements](registre-des-traitements.md), qui sont publics. En
résumé : chiffrement de bout en bout, second facteur, secret du second facteur
lui-même chiffré au repos, conteneurs durcis, analyse de dépendances et de
secrets à chaque modification du code, revue obligatoire avant toute mise en
production, sauvegardes chiffrées hors site.

**Et une chose que peu d'éditeurs peuvent offrir : le code est public.** Vous
n'êtes pas obligés de nous croire sur parole — vous pouvez vérifier que le
serveur ne contient aucun moyen de déchiffrer vos secrets.

## Modifications

Cette page est versionnée dans le dépôt public du produit : son historique
complet est consultable, et chaque modification est datée. En cas de changement
substantiel, nous vous en informerons avant qu'il prenne effet.

| Version | Date | Modification |
|---|---|---|
| 0.4 | 2026-09-25 | Retrait de l'avertissement « Projet — à faire relire par un juriste avant mise en ligne », que le document portait **alors qu'il était déjà publié**. La relecture a eu lieu ; l'avertissement ne décrivait plus l'état du texte, et une politique de confidentialité qui s'annonce comme un projet se dessert. Aucune modification de fond : ni les données traitées, ni les destinataires, ni les droits ne changent. Les rangs d'historique sont par ailleurs remis en ordre — ils se lisaient 0.3, 0.1, 0.2 |
| 0.3 | 2026-09-24 | La ligne Cloudflare nommait `ghostpass.stackops.ch`, instance décommissionnée le jour même et qui ne répond plus. Elle nomme désormais les trois instances de la suite : `pass.`, `cal.` et `bit.ghostsuite.cloud`. Ni les destinataires ni les données traitées ne changent : c'est une correction d'exactitude |
| 0.2 | 2026-08-31 | Trois corrections d'exactitude, après confrontation au code. « Le serveur ne contient aucun code capable de déchiffrer » devient « rien, côté serveur, ne peut ouvrir un coffre » : le serveur détient bien une primitive de déchiffrement, pour le seul secret du second facteur. Le partage par **ghostbit** est décrit — il ne l'était nulle part. Le **PFPDT** gagne son second rôle, destinataire d'une annonce de violation, distinct de celui d'autorité de réclamation |
| 0.1 | 2026-08-31 | Création |
