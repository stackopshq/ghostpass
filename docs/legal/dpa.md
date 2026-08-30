# Accord de sous-traitance (DPA)

> **Projet — à faire relire par un juriste avant toute signature.**
> Ce document a été rédigé à partir de ce que le produit fait *réellement*,
> mesuré dans le code et la configuration de déploiement. Il n'a pas été relu
> par un professionnel du droit. Les faits techniques qu'il contient sont
> vérifiables ; les qualifications juridiques ne le sont pas encore.

*Version 0.1 — 2026-08-30. Article 28 du règlement (UE) 2016/679 (RGPD) et
art. 9 de la loi fédérale suisse sur la protection des données (nLPD).*

---

## 1. Les parties, et qui est quoi

| | |
|---|---|
| **Responsable du traitement** | Le Client, personne morale souscrivant à GhostPass |
| **Sous-traitant** | StackOps Sàrl (« StackOps »), éditeur de GhostPass |

**Deux régimes coexistent dans le produit, et les confondre serait une faute :**

- Pour un compte **individuel**, StackOps est **responsable du traitement** :
  personne d'autre ne détermine les finalités.
- Pour une **organisation**, StackOps est **sous-traitant** du Client, qui décide
  qui rejoint, ce qui est partagé et combien de temps.

Le présent accord régit le second cas. Le premier relève des conditions
générales d'utilisation.

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
| Aucun code de déchiffrement côté serveur | En place, vérifiable — le dépôt ne contient aucune primitive de déchiffrement dans `apps/server` |
| TLS sur tous les accès publics | En place |
| Second facteur (TOTP, WebAuthn, clés d'accès) | En place |
| Conteneur non-root, racine en lecture seule, `NoNewPrivileges` | En place |
| Analyse de dépendances et de secrets en intégration continue | En place |
| Revue par un pair obligatoire avant fusion | En place depuis le 2026-08-30 |
| Sauvegardes chiffrées quotidiennes, hors site | En place |
| Restauration éprouvée | **Éprouvée sur l'infrastructure, pas encore sur ce service en particulier** |
| Chiffrement des connexions internes à la base | **Non — traité en interne, échéance à convenir** |
| Secret du second facteur chiffré au repos | **Non — le secret TOTP est stocké en clair** |

Les deux dernières lignes sont des écarts connus, et figurent ici plutôt que
d'être tues : un DPA qui ne mentionne que ce qui va bien ne vaut rien le jour où
il faut s'y référer.

## 6. Sous-traitants ultérieurs (art. 28.2 et 28.4)

Le Client autorise le recours aux sous-traitants ci-dessous. StackOps informe le
Client de tout ajout ou remplacement **au moins trente jours avant**, et le
Client peut s'y opposer ; à défaut d'accord, il peut résilier sans pénalité.

| Sous-traitant | Rôle | Pays | Accès aux données |
|---|---|---|---|
| **Cloudflare, Inc.** | Termine le TLS du nom public, sert l'application | 🇺🇸 | Voit le trafic ; **sert le code qui chiffre** — voir ci-dessous |
| **Infomaniak Network SA** | Frontal d'exposition | 🇨🇭 | Trafic chiffré |
| **Google LLC (Drive)** | Dépôt des sauvegardes, chiffrées avant envoi | 🇺🇸 | Aucun accès en clair |
| **Google Workspace** | Fournisseur d'identité de l'instance opérée par StackOps | 🇺🇸 | Adresse de courriel, journal de connexion |
| **Hetzner Online GmbH** | Dépôt secondaire des sauvegardes | 🇩🇪 | Aucun accès en clair |

**Ce que Cloudflare peut, et que le Client doit savoir.** Le frontal termine le
TLS, donc il sert le JavaScript et le module WebAssembly qui chiffrent. Un
intermédiaire capable de modifier ce code peut défaire le chiffrement, sans
jamais toucher à la base. **Ce n'est pas propre à GhostPass** : c'est la limite
de tout chiffrement livré par le Web, chez tous les produits à interface
navigateur.

**L'atténuation est réelle et livrée : GhostPass s'auto-héberge.** Le Client qui
refuse cet intermédiaire le retire, en servant le produit depuis sa propre
infrastructure. La confiance ne disparaît pas — elle passe de Cloudflare au
Client, ce qui est exactement ce que doit vouloir un Client que la question
préoccupe.

**Le fournisseur d'identité n'est pas dans ce tableau, et c'est volontaire.**
Sur l'instance opérée par StackOps, la connexion déléguée passe par **Google
Workspace**. Mais un Client peut brancher **son propre fournisseur OIDC** — c'est
lui qui choisit, et nous nous adaptons. Dans ce cas le fournisseur est un
sous-traitant **du Client**, pas de StackOps : nous n'avons ni contrat avec lui,
ni moyen d'agir sur lui, et le déclarer comme le nôtre laisserait croire le
contraire.

Les transferts hors de Suisse et de l'Union européenne s'appuient sur les
clauses contractuelles types et, pour les sauvegardes, sur le fait qu'elles sont
chiffrées avant tout envoi.

## 7. Assistance au Client (art. 28.3.e et 28.3.f)

**Droits des personnes.** GhostPass expose depuis le 2026-08-30 :

- `GET /api/account/export` — tout ce que le serveur détient, articles 15 et 20 ;
- `DELETE /api/account` — effacement, article 17.

L'export rend les champs chiffrés **tels quels** : StackOps ne peut pas les
déchiffrer, et c'est la contrepartie exacte du zero-knowledge, non une limite de
l'export. La personne les déchiffre avec sa clé, hors du serveur.

**Violations de données.** StackOps notifie le Client **sans délai indu et au
plus tard sous 24 heures** après avoir eu connaissance d'une violation
concernant ses données, avec la nature de l'incident, les catégories et le
volume approximatif concernés, les conséquences probables et les mesures prises.
Le Client reste responsable de sa propre notification à l'autorité.

## 8. Fin du contrat (art. 28.3.g)

Au choix du Client, exprimé avant le terme : restitution des données au format
d'export du §7, ou effacement.

À défaut d'instruction, les données sont effacées **90 jours** après le terme.
Les sauvegardes chiffrées existantes sont purgées selon leur propre rotation, au
plus tard **180 jours** après le terme — un effacement immédiat des sauvegardes
n'est pas techniquement possible sans détruire celles des autres clients, et le
dire vaut mieux que promettre l'inverse.

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

---

*Contact protection des données : privacy@stackops.ch*
