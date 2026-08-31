# Accord de sous-traitance (DPA)

> **Projet — à faire relire par un juriste avant toute signature.**
> Ce document a été rédigé à partir de ce que le produit fait *réellement*,
> mesuré dans le code et la configuration de déploiement. Il n'a pas été relu
> par un professionnel du droit. Les faits techniques qu'il contient sont
> vérifiables ; les qualifications juridiques ne le sont pas encore.

*Version 0.4 — 2026-08-31. Article 28 du règlement (UE) 2016/679 (RGPD).
L'art. 9 de la loi fédérale suisse sur la protection des données (nLPD)
s'applique en outre lorsque le Client ou les personnes concernées sont en
Suisse — StackOps est établie en France, le RGPD est donc son régime premier.*

---

## 0. Identification du contrat

Les champs marqués **à compléter** le sont à la signature. Ils ne sont pas des
oublis : les remplir d'avance avec un client hypothetique produirait un document
qui a l'air signe et ne l'est pas.

| | |
|---|---|
| Client (responsable du traitement) | **à compléter** — raison sociale, forme, siège, numéro d'identification |
| Représentant du Client | **à compléter** — nom, qualité |
| Sous-traitant | StackOps, entreprise individuelle de Kevin Allioli, siège à Saint-Julien-en-Genevois (Haute-Savoie), France |
| Représentant du sous-traitant | Kevin Allioli, exploitant |
| Service concerné | GhostPass — coffre de secrets chiffré de bout en bout |
| Modèle d'hébergement retenu | **à compléter** — A (mutualisé) ou B (VM dédiée), voir §5 bis |
| Date de prise d'effet | **à compléter** |
| Durée | Celle du contrat de service principal, et jusqu'à l'exécution complète de l'article 8 |

**Ce document ne lie personne tant qu'il n'est pas signé.** Il est publié dans le
dépôt pour être relu, critiqué et repris — pas pour tenir lieu d'engagement.

---

## 1. Les parties, et qui est quoi

| | |
|---|---|
| **Responsable du traitement** | Le Client, personne morale souscrivant à GhostPass |
| **Sous-traitant** | **StackOps, entreprise individuelle de Kevin Allioli** (« StackOps »), éditeur de GhostPass |

**Deux régimes coexistent dans le produit, et les confondre serait une faute :**

- Pour un compte **individuel**, StackOps est **responsable du traitement** :
  personne d'autre ne détermine les finalités.
- Pour une **organisation**, StackOps est **sous-traitant** du Client, qui décide
  qui rejoint, ce qui est partagé et combien de temps.

Le présent accord régit le second cas. Le premier relève des conditions
générales d'utilisation.

**StackOps est une entreprise individuelle, pas une société de capitaux**, et un
Client a le droit de le savoir avant de confier ses données : il traite avec une
personne physique, dont l'engagement n'est pas adossé à un capital social.

**L'étendue de cet engagement est un point ouvert, et ce document ne le
tranche pas.** Depuis la réforme française du 14 février 2022, l'entrepreneur
individuel dispose de plein droit d'un patrimoine professionnel séparé de son
patrimoine personnel, ce dernier n'étant en principe plus saisissable par les
créanciers professionnels. Écrire ici que l'exploitant répond « sur son
patrimoine propre » serait donc inexact — et l'écrire dans l'autre sens, sans
relecture juridique, le serait tout autant.

Ce qui reste vrai quelle que soit l'analyse : la forme sociale appelle deux
vérifications qui ne sont pas techniques — qu'elle reste adaptée au volume de
données confiées, et qu'une assurance en responsabilité professionnelle couvre
le risque. Ni l'une ni l'autre n'est tranchée à ce jour.

## 2. Ce qui est traité

**Nature et finalité.** Héberger un coffre de secrets chiffré de bout en bout,
et l'accès à ce coffre pour les membres d'une organisation.

**Durée.** Celle du contrat, plus les délais de purge de l'article 8.

**Catégories de personnes.** Les membres de l'organisation du Client.

**Catégories de données.** C'est ici que le zero-knowledge se lit précisément —
ce que StackOps détient n'est pas ce qu'un hébergeur détient d'ordinaire :

| Donnée | Forme chez StackOps |
|---|---|
| Contenu des secrets (identifiants, notes, cartes, fichiers) | **Chiffré côté client.** StackOps ne possède aucune clé et ne peut pas déchiffrer |
| Adresse de courriel | **En clair** — elle est l'identifiant de connexion |
| Noms d'organisations, de collections, de groupes | **En clair** |
| Noms des dossiers du coffre personnel | Chiffrés |
| Domaines des sites enregistrés | **Vus transitoirement** par le service d'icônes, si celui-ci est activé (§6) |
| Adresse IP et agent utilisateur des connexions | En clair, purgés après 90 jours |
| Journal d'audit (action, horodatage, IP) | En clair, purgé après 365 jours |

**Ce que ce tableau dit et que la promesse commerciale ne dit pas** : le
zero-knowledge de GhostPass est **à métadonnées ouvertes**. Le contenu est
inaccessible à StackOps ; la structure — qui appartient à quelle organisation,
comment elle s'appelle — ne l'est pas. C'est le choix qu'ont fait la plupart des
produits comparables, et le Client a le droit de le savoir avant de signer.

## 3. Instructions documentées (art. 28.3.a)

StackOps ne traite les données que sur instruction documentée du Client. Les
instructions permanentes sont : héberger, servir, sauvegarder et restaurer le
coffre du Client, et rien d'autre.

**Aucune exploitation secondaire.** Pas d'analyse, pas de profilage, pas
d'entraînement de modèle, pas de revente, pas de communication à des tiers hors
des sous-traitants ultérieurs listés au §6.

Si une obligation légale impose un traitement supplémentaire, StackOps en
informe le Client avant de l'exécuter, sauf interdiction légale de le faire.

## 4. Confidentialité (art. 28.3.b)

Les personnes autorisées chez StackOps sont soumises à une obligation
contractuelle de confidentialité survivant à la fin de leur engagement.

**Un fait, plutôt qu'une promesse** : le personnel de StackOps ne peut pas lire
le contenu des coffres, quel que soit son niveau d'accès, parce que les clés
n'existent nulle part de son côté. La confidentialité du contenu ne repose pas
sur la discipline des personnes ; celle des métadonnées du §2, si.

## 5. Sécurité (art. 28.3.c et art. 32)

| Mesure | État |
|---|---|
| Chiffrement de bout en bout, clés dérivées du mot de passe maître | En place |
| Aucune primitive capable d'ouvrir un coffre, côté serveur | En place, vérifiable — le serveur détient **une** primitive de déchiffrement et une seule : celle qui lit le secret du second facteur pour vérifier un code (`apps/server/src/services/secretAtRest.ts`, voir l'avant-dernière ligne). Aucune clé de coffre n'existe de son côté, et aucun code du serveur ne déchiffre un contenu |
| TLS sur tous les accès publics | En place |
| Second facteur (TOTP, WebAuthn, clés d'accès) | En place |
| Conteneur non-root, racine en lecture seule, `NoNewPrivileges` | En place |
| Analyse de dépendances et de secrets en intégration continue | En place |
| Revue par un pair obligatoire avant fusion | En place depuis le 2026-08-30 |
| Sauvegardes chiffrées quotidiennes, hors site | En place |
| Restauration éprouvée | **Éprouvée sur l'infrastructure, pas encore sur ce service en particulier** |
| Secret du second facteur chiffré au repos | En place depuis le 2026-08-30 — AES-256-GCM, clé hors base |
| Chiffrement des connexions internes à la base | **Dépend du modèle d'hébergement — voir §5 bis** |

La dernière ligne est un écart connu dans un modèle et sans objet dans l'autre.
Elle figure ici plutôt que d'être tue : un DPA qui ne mentionne que ce qui va
bien ne vaut rien le jour où il faut s'y référer. Mais l'écrire sans dire à quel
modèle il s'applique serait aussi trompeur — dans un sens comme dans l'autre.

**La deuxième ligne a changé de formulation, et il faut dire pourquoi.** Elle
affirmait jusqu'ici que « le dépôt ne contient aucune primitive de déchiffrement
dans `apps/server` ». Ce n'est plus vrai depuis le 2026-08-30 : chiffrer au repos
le secret du second facteur — le progrès que l'avant-dernière ligne de ce même
tableau annonce — suppose de savoir le déchiffrer pour vérifier un code à six
chiffres. Les deux lignes se contredisaient.

**La substance ne bouge pas** : rien, côté serveur, ne peut ouvrir un coffre. Ce
qui bouge est la vérifiabilité de la phrase. Le §9 invite le Client à examiner le
code source ; l'ancienne rédaction se réfutait en trente secondes par une
recherche de `createDecipheriv`, et lui faisait alors découvrir une contradiction
interne dans le document qui le lie. **Une affirmation qui résiste à la
vérification vaut mieux qu'une affirmation plus forte qui n'y résiste pas.**

## 5 bis. Les deux modèles d'hébergement

Le même produit est exploité de deux façons, et **les mesures de l'article 32 ne
sont pas les mêmes**. Confondre les deux ferait déclarer au Client une faiblesse
qu'il n'a pas, ou lui taire celle qu'il a.

### Modèle A — instance mutualisée

Le Client est hébergé sur l'infrastructure de StackOps, aux côtés d'autres
clients et des services internes de l'exploitant.

| | |
|---|---|
| Application | Une machine virtuelle du parc de StackOps |
| Base de données | Un serveur PostgreSQL **partagé** avec d'autres services de l'exploitant, sur le réseau interne |
| Connexion à la base | **En clair sur le réseau interne à ce jour.** Le serveur accepte TLS ; l'application ne le demande pas encore. Correctif écrit, non encore déployé |
| Isolation entre clients | Applicative — une base par produit, des organisations distinctes en son sein |

### Modèle B — machine virtuelle dédiée

Le Client dispose de sa propre machine virtuelle, sur un serveur physique loué
par StackOps chez OVH.

| | |
|---|---|
| Application | Une machine virtuelle dédiée au seul Client |
| Base de données | **Sur la même machine virtuelle**, dans son propre conteneur |
| Connexion à la base | **Ne quitte jamais la machine.** Réseau privé de conteneurs, la base est jointe par son nom, et **aucun port n'est publié sur l'hôte** |
| Partage de liens | **Par l'instance ghostbit du Client** — `GHOSTBIT_URL` doit la désigner, faute de quoi l'isolation de la ligne suivante est rompue. Voir §6 |
| Isolation entre clients | Par machine virtuelle — mémoire, disque et réseau séparés |

**La ligne « connexion en clair » du §5 ne concerne donc que le modèle A.** Dans
le modèle B, il n'existe pas de réseau à écouter entre l'application et sa base :
le trafic reste dans l'espace de noms réseau de la machine, et la base n'est
atteignable depuis nulle part ailleurs. Chiffrer ce lien n'ajouterait rien contre
un adversaire qui n'a pas déjà la machine — et un adversaire qui a la machine a
aussi la clé.

### Modèle C — auto-hébergement

Le Client exploite lui-même le produit. **StackOps n'est alors pas
sous-traitant** mais fournisseur de logiciel, et le présent accord ne s'applique
pas (voir §10).

## 6. Sous-traitants ultérieurs (art. 28.2 et 28.4)

Le Client autorise le recours aux sous-traitants ci-dessous. StackOps informe le
Client de tout ajout ou remplacement **au moins trente jours avant**, et le
Client peut s'y opposer ; à défaut d'accord, il peut résilier sans pénalité.

| Sous-traitant | Rôle pour GhostPass | Pays | Accès aux données | Modèle |
|---|---|---|---|---|
| **Cloudflare, Inc.** | Tunnel du nom public — rien d'autre | États-Unis | Voit le trafic ; **sert le code qui chiffre** (voir plus bas) | A et B |
| **Infomaniak Network SA (Swiss Backup)** | Destination hors site des sauvegardes, chiffrées par restic avant envoi | Suisse | Aucun accès en clair | A et B |
| **OVH SAS** | Serveur physique portant la machine virtuelle dédiée du Client | France — **Gravelines** (Nord) | Accès physique à la machine ; aucun accès applicatif | **B uniquement** |
| **OVH SAS** | Sauvegarde du serveur physique | France — **Roubaix** (Nord) | Instantanés du serveur, dans l'Union | **B uniquement** |

Les deux lignes OVH n'existent que si le Client a choisi le modèle B : la
machine est à Gravelines, sa sauvegarde à Roubaix, les deux dans l'Union. Dans
le modèle A, l'infrastructure est celle de StackOps et aucun hébergeur tiers
n'est sur le chemin des données.

*La sauvegarde de Roubaix ne figurait dans aucun document du dépôt avant cette
version — elle a été portée à ma connaissance par l'exploitante. Une destination
de sauvegarde qui n'existe que dans la tête de quelqu'un est exactement ce que
la règle « tout est versionné » vise, et c'est aussi une ligne qui manquait à un
registre de transferts.*

**Deux lignes ont été retirées de ce tableau, et il faut dire pourquoi**, sans
quoi une version antérieure de ce document contredirait celle-ci.

*L'identité n'est pas dans le périmètre du Client.* StackOps utilise Cloudflare
Access et un annuaire Google Workspace **pour ses propres accès à sa propre
infrastructure**. Ce sont ses outils internes d'exploitant, pas un traitement des
données du Client. Les utilisateurs du Client s'authentifient par **mot de passe
maître**, par **clé d'accès**, ou par le fournisseur OIDC que **le Client
choisit** — et dans ce dernier cas ce fournisseur est un sous-traitant *du
Client*, pas de StackOps : nous n'avons ni contrat avec lui, ni moyen d'agir sur
lui, et le déclarer comme le nôtre laisserait croire le contraire.

*Un prestataire du parc n'est pas sur le chemin de ce produit.* **Hetzner**
reçoit d'autres dépôts de sauvegarde, mais pas celui qui contient cette base.

*Et Infomaniak n'y est qu'à un titre.* Il héberge le frontal Pangolin du reste du
parc, dont **GhostPass ne dépend pas** — son nom public passe par un tunnel
Cloudflare. Il figure au tableau ci-dessus uniquement comme dépôt de
sauvegardes.

Un sous-traitant déclaré en trop n'est pas un excès de prudence : il autorise un
transfert qui n'a pas lieu, et rend la liste entière suspecte le jour où le
Client la vérifie.

### ghostbit — un service de StackOps, et non un sous-traitant ultérieur

Depuis le 2026-08-29, **créer un lien de partage passe par ghostbit**, un autre
service de la suite Ghost. Aucun document de ce dossier ne le disait ; c'est une
omission, et elle se répare ici plutôt que dans le code d'un Client qui la
découvrirait seul.

**Ce qui traverse est le bloc chiffré lui-même**, et non une référence vers lui :
GhostPass poste le chiffré à `${GHOSTBIT_URL}/api/v1/pastes`
(`apps/server/src/services/ghostbit.ts`). La clé qui l'ouvre vit dans le
**fragment de l'URL** — la portion après le `#`, que les navigateurs n'envoient à
aucun serveur. Elle n'atteint donc ni GhostPass, ni ghostbit, ni aucun
intermédiaire du chemin.

**Écrire « rien ne sort » serait faux ; écrire « rien de lisible ne sort » est
exact**, et la différence compte pour un Client qui doit répondre de ses flux.

**Ghostbit ne figure pas au tableau ci-dessus parce qu'il n'est pas un
sous-traitant ultérieur** : c'est un service de StackOps, exploité par StackOps,
sur l'infrastructure de StackOps. Aucun tiers n'entre en scène, aucun transfert
n'est créé, et l'inscrire au tableau laisserait croire l'inverse — ce qui est
exactement le défaut décrit au paragraphe précédent. En modèle A, c'est un
**composant interne du produit**, au même titre que sa base de données.

**En modèle B, c'est une obligation de configuration, et elle est
contraignante.** Le §5 bis promet une isolation « par machine virtuelle —
mémoire, disque et réseau séparés ». Si `GHOSTBIT_URL` désignait l'instance
mutualisée de StackOps, les blocs chiffrés du Client quitteraient sa machine
dédiée pour l'infrastructure partagée de l'éditeur, et cette ligne du présent
accord deviendrait fausse. **`GHOSTBIT_URL` doit donc désigner une instance
ghostbit du Client.** Ghostbit s'auto-héberge et son image est publiée :
`ghcr.io/stackopshq/ghostbit`.

*Le produit refuse le partage plutôt que d'inventer un repli : `GHOSTBIT_URL`
absente, `POST /api/send` répond 503 (`apps/server/src/routes/send.ts`). Une
instance mal configurée ne fabrique donc pas de lien silencieusement mauvais —
elle n'en fabrique aucun.*

### Les sauvegardes ont quitté Google Drive

Elles vont désormais chez **Swiss Backup** (Infomaniak), en Suisse. Le tableau
ci-dessus décrit l'état après cette bascule, faite le 2026-08-30.

Ce qu'elle **retire** : un transfert vers les États-Unis, sous clauses
contractuelles types. Ce qu'elle **laisse** : un transfert hors de l'Union, vers
la Suisse, cette fois couvert par une décision d'adéquation. Les instantanés
étaient déjà chiffrés par restic avant de quitter la machine dans les deux cas —
ce qui change n'est pas la confidentialité du contenu, c'est la juridiction du
dépôt et donc le régime d'accès dont il relève.

**Le gain est réel et il n'est pas celui d'une sortie de l'Union.** Le dire
autrement laisserait croire que la question du transfert est close, alors qu'elle
change seulement de fondement.

*Note de rédaction : cette version du document est écrite le jour même de la
bascule. Si la relecture juridique intervient avant qu'elle soit effective, la
ligne « Swiss Backup » du tableau est en avance sur le réel — c'est le seul
endroit de cet accord où ce risque existe, et il se lève par une vérification de
la configuration de `core-db`.*

### Ce que Cloudflare peut, et que le Client doit savoir

Le tunnel termine le TLS, donc il sert le JavaScript et le module WebAssembly qui
chiffrent. Un intermédiaire capable de modifier ce code peut défaire le
chiffrement, sans jamais toucher à la base. **Ce n'est pas propre à GhostPass** :
c'est la limite de tout chiffrement livré par le Web, chez tous les produits à
interface navigateur.

**L'atténuation est réelle et livrée : GhostPass s'auto-héberge.** Le Client qui
refuse cet intermédiaire le retire, en servant le produit depuis sa propre
infrastructure. La confiance ne disparaît pas — elle passe de Cloudflare au
Client, ce qui est exactement ce que doit vouloir un Client que la question
préoccupe.

### Transferts hors de l'Union européenne

StackOps est établie en France : le point de départ de tout transfert est donc
l'Union, et non la Suisse. Deux destinations sortent de l'Union :

| Destination | Pays | Fondement du transfert |
|---|---|---|
| **Cloudflare, Inc.** | États-Unis | Clauses contractuelles types |
| **Infomaniak (Swiss Backup)** | Suisse | **Décision d'adéquation** de la Commission européenne du 26 juillet 2000, maintenue |

**La Suisse est un pays tiers vu de France**, même si c'est le pays tiers le
mieux traité par le droit européen : la décision d'adéquation dispense de
garanties supplémentaires. Une version antérieure de ce document, écrite quand
l'établissement était cru suisse, présentait Swiss Backup comme *l'absence* d'un
transfert. C'était l'inverse — et c'est une correction qui compte, parce qu'un
transfert non déclaré est précisément ce qu'une autorité cherche.

Le Client qui souhaite le supprimer entièrement le peut : il auto-héberge, et
plus aucune donnée ne quitte son périmètre.

## 7. Assistance au Client (art. 28.3.e et 28.3.f)

**Droits des personnes.** GhostPass expose depuis le 2026-08-30 :

- `GET /api/account/export` — tout ce que le serveur détient, articles 15 et 20 ;
- `DELETE /api/account` — effacement, article 17.

L'export rend les champs chiffrés **tels quels** : StackOps ne peut pas les
déchiffrer, et c'est la contrepartie exacte du zero-knowledge, non une limite de
l'export. La personne les déchiffre avec sa clé, hors du serveur.

**Analyse d'impact (art. 35).** Lorsque le Client mène la sienne, StackOps lui
fournit sur demande écrite tout ce qui figure au §5 de l'[examen
préalable](aipd-examen-prealable.md) — dont le code source, public, qui lui
permet de vérifier lui-même l'affirmation centrale plutôt que de nous croire.

**Violations de données.** StackOps notifie le Client **sans délai indu et au
plus tard sous 24 heures** après avoir eu connaissance d'une violation
concernant ses données, avec la nature de l'incident, les catégories et le
volume approximatif concernés, les conséquences probables et les mesures prises.
Le Client reste responsable de sa propre notification à l'autorité.

**Quelle autorité, lorsque des personnes en Suisse sont concernées.** La
notification comprend alors le **PFPDT** — Préposé fédéral à la protection des
données et à la transparence — au titre de l'art. 24 nLPD, en plus de l'autorité
compétente au sens du RGPD.

**Son standard n'est pas celui du RGPD, et le confondre serait une erreur dans
les deux sens.** L'annonce au PFPDT est due « **dans les meilleurs délais** » :
la loi suisse ne fixe aucun délai chiffré, et son seuil est un risque élevé pour
la personnalité ou les droits fondamentaux de la personne. Recopier ici les 72
heures de l'art. 33 RGPD inventerait un délai que la loi ne pose pas, et
laisserait croire qu'attendre soixante-et-onze heures est conforme.

## 8. Fin du contrat (art. 28.3.g)

Au choix du Client, exprimé avant le terme : restitution des données au format
d'export du §7, ou effacement.

À défaut d'instruction, les données de production sont effacées **90 jours**
après le terme.

**Les sauvegardes suivent leur propre rotation, et elle est plus longue que ça.**
Mesurée sur la machine le 2026-08-30 : `restic forget` conserve **14
quotidiennes, 8 hebdomadaires et 12 mensuelles**. Une donnée peut donc subsister
dans une sauvegarde chiffrée **jusqu'à environ douze mois** après son
effacement en production, et non six.

Un effacement immédiat des sauvegardes n'est pas techniquement possible sans
détruire celles des autres clients — mais le délai réel est celui-là, et
l'annoncer plus court aurait été un engagement intenable. Les instantanés sont
chiffrés par restic avant de quitter la machine : le prestataire de stockage n'y
a aucun accès en clair pendant ces douze mois.

## 9. Audit (art. 28.3.h)

StackOps met à disposition du Client, sur demande écrite et une fois par an :

- le présent accord et ses annexes à jour ;
- les rapports d'audit internes les plus récents ;
- le **code source complet du produit**, qui est public — ce qui donne au Client
  une capacité de vérification que peu d'éditeurs offrent.

Un audit sur site est possible, aux frais du Client, moyennant un préavis de
trente jours ouvrés.

## 10. Ce que cet accord ne couvre pas

- Le comportement des membres de l'organisation du Client, qui relève du Client.
- La perte du mot de passe maître d'un utilisateur : **StackOps ne peut pas le
  réinitialiser**, ni récupérer un coffre dont la clé est perdue. C'est une
  conséquence directe du zero-knowledge, et le Client doit en informer ses
  membres.
- Les instances auto-hébergées par le Client, où StackOps n'est pas
  sous-traitant mais fournisseur de logiciel.

## 11. Droit applicable et for

Droit français, sans préjudice de l'application du RGPD, qui prime en tout
état de cause. For juridique : les tribunaux compétents du siège de
l'exploitant, à **Saint-Julien-en-Genevois (Haute-Savoie)**.

Lorsque le Client ou les personnes concernées sont établis en Suisse, la nLPD
s'applique en outre, et les compétences qu'elle prévoit demeurent.

Les règles de compétence protectrices des consommateurs et celles du RGPD à
l'égard des personnes concernées demeurent réservées.

## 12. Signatures

Le présent accord entre en vigueur à la date portée au §0, à la signature des
deux parties. Il prime sur toute stipulation contraire du contrat de service
principal pour ce qui touche au traitement de données à caractère personnel.

| | Le Client | StackOps |
|---|---|---|
| Nom | **à compléter** | Kevin Allioli |
| Qualité | **à compléter** | Exploitant |
| Lieu et date | | |
| Signature | | |

---

## Annexes

Les annexes font partie intégrante de l'accord. Elles vivent dans le dépôt et
sont datées, de sorte qu'un Client puisse constater ce qui a changé depuis sa
signature.

| Annexe | Contenu | Où |
|---|---|---|
| 1 | Catégories de données et de personnes | §2 du présent document |
| 2 | Mesures de sécurité, par modèle d'hébergement | §5 et §5 bis |
| 3 | Sous-traitants ultérieurs | §6 |
| 4 | Registre des activités de traitement (art. 30) | [`registre-des-traitements.md`](registre-des-traitements.md) |
| 5 | Examen préalable d'analyse d'impact (art. 35) | [`aipd-examen-prealable.md`](aipd-examen-prealable.md) |
| 6 | Politique de confidentialité remise aux personnes | [`politique-de-confidentialite.md`](politique-de-confidentialite.md) |

---

*Contact protection des données : privacy@stackops.ch*

> **Cette adresse doit exister avant la première signature.** Elle est publiée
> ici, dans les conditions générales et dans le `security.txt` en ligne. Une
> voie de recours annoncée qui rebondit vaut moins que pas de voie du tout —
> elle fait croire qu'on peut nous joindre.
