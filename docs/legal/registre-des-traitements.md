# Registre des activités de traitement — GhostPass

> **Projet — à faire relire par un juriste.**
> Comme les deux autres documents de ce dossier, celui-ci est rédigé à partir de
> ce que le produit fait *réellement*, mesuré dans le code et la configuration de
> déploiement. Les faits techniques sont vérifiables ; les qualifications
> juridiques ne sont pas encore relues.

*Version 0.3 — 2026-08-31. Article 30 du règlement (UE) 2016/679 (RGPD).
StackOps est établie en France : le RGPD est son régime premier. L'art. 12 nLPD
s'applique en outre lorsque le Client ou les personnes concernées sont en
Suisse.*

---

## Pourquoi ce registre existe, alors que StackOps a moins de 250 employés

L'article 30.5 dispense les organisations de moins de 250 personnes de tenir un
registre — **sauf**, notamment, lorsque le traitement n'est pas occasionnel.
Héberger en continu les coffres de secrets de clients n'est pas occasionnel.
La dispense ne s'applique donc pas.

Ce document est aussi ce qu'une autorité demande **en premier** lors d'un
contrôle. Ne pas l'avoir se remarque avant tout le reste.

## Deux rôles, et il faut les séparer

GhostPass fait coexister deux régimes, déjà distingués au §1 du
[DPA](dpa.md) :

| Fiche | Rôle de StackOps | Objet |
|---|---|---|
| **A** | **Responsable du traitement** (art. 30.1) | Les comptes individuels — personne d'autre n'en détermine les finalités |
| **B** | **Sous-traitant** (art. 30.2) | Les coffres des organisations clientes |

Les mélanger produirait un registre qui n'est ni l'un ni l'autre.

---

## Fiche A — Comptes individuels (StackOps responsable)

| | |
|---|---|
| **Responsable** | StackOps, entreprise individuelle de Kevin Allioli, siège à Saint-Julien-en-Genevois (Haute-Savoie), France |
| **Contact** | privacy@stackops.ch |
| **Délégué à la protection des données** | Aucun. Ni l'art. 37 RGPD ni l'art. 10 nLPD n'en imposent un ici : pas d'autorité publique, pas de suivi systématique à grande échelle, pas de traitement à grande échelle de données sensibles. **À réexaminer si le volume de clients change** |
| **Représentant dans l'Union** (art. 27) | **Sans objet.** StackOps est établie en France, donc dans l'Union : l'article 27 ne vise que les responsables établis hors de l'Union |

### Finalités et bases légales

| Finalité | Base légale | Données |
|---|---|---|
| Fournir le coffre | Exécution du contrat (art. 6.1.b) | Adresse de courriel, secrets chiffrés, métadonnées de structure |
| Authentifier, et détecter les abus | Intérêt légitime (art. 6.1.f) | Adresse IP, agent utilisateur, horodatages de connexion |
| Tracer les actions sensibles | Intérêt légitime (art. 6.1.f) et obligation de sécurité (art. 32) | Journal d'audit : action, horodatage, adresse IP |
| Facturer | Exécution du contrat, obligation légale de conservation | **Sans objet à ce jour** — aucun encaissement n'est en place |

### Catégories de données

Reprises telles quelles du §2 du DPA, qui fait foi. En résumé : **le contenu est
chiffré côté client et illisible pour StackOps ; la structure ne l'est pas.**

Aucune catégorie particulière au sens de l'art. 9 RGPD n'est traitée **en clair**.
Un utilisateur peut en ranger dans son coffre — StackOps ne peut ni le savoir ni
le lire.

### Durées de conservation

| Donnée | Durée | Mécanisme |
|---|---|---|
| Événements de connexion (IP, agent utilisateur) | **90 jours** | Purge automatique au démarrage puis toutes les 6 heures |
| Journal d'audit | **365 jours** | Idem |
| Compte et coffre | Jusqu'à suppression par la personne, ou 90 jours après la fin du contrat | `DELETE /api/account` |
| Sauvegardes chiffrées | **Jusqu'à ~12 mois** — 14 quotidiennes, 8 hebdomadaires, 12 mensuelles | Rotation `restic forget` |

L'écart entre la suppression en production et la disparition des sauvegardes est
assumé et écrit au §8 du DPA. Un effacement immédiat des sauvegardes
détruirait celles des autres.

---

## Fiche B — Coffres d'organisations clientes (StackOps sous-traitant)

| | |
|---|---|
| **Sous-traitant** | StackOps, entreprise individuelle de Kevin Allioli, siège à Saint-Julien-en-Genevois (Haute-Savoie), France |
| **Contact** | privacy@stackops.ch |

### Responsables du traitement pour le compte desquels StackOps agit

**Aucun à ce jour.** Aucun accord de sous-traitance n'est signé, donc aucun
client soumis au RGPD n'est hébergé sous ce régime.

Cette ligne est le cœur du registre, et son état actuel est aussi le principal
écart de conformité relevé par l'audit du 2026-08-30 (écart C-2) : **le produit
ne peut pas être vendu à un client soumis au RGPD tant qu'elle reste vide et
qu'un contrat n'a pas été signé.**

| Responsable | Contact | Modèle d'hébergement | DPA signé le | Fin |
|---|---|---|---|---|
| *(aucun)* | | | | |

Chaque signature ajoute une ligne. Le registre est mis à jour **dans le même
geste** que la signature, jamais après.

### Catégories de traitements effectués pour le compte des responsables

- Hébergement et mise à disposition d'un coffre de secrets chiffré de bout en bout ;
- Authentification des membres de l'organisation ;
- Sauvegarde et restauration ;
- Journalisation des actions sensibles ;
- Assistance à l'exercice des droits des personnes (export, effacement).

**Et rien d'autre** : ni analyse, ni profilage, ni entraînement de modèle, ni
communication à des tiers hors des sous-traitants ultérieurs ci-dessous (§3 du
DPA).

---

## Transferts hors de l'Union européenne

Le point de départ est la France. **Deux destinations sortent de l'Union**, et
la seconde l'a longtemps été sans être vue comme telle.

| Destinataire | Pays | Ce qui transite | Fondement du transfert | Modèle |
|---|---|---|---|---|
| **Cloudflare, Inc.** | États-Unis | Le trafic du nom public ; sert le code qui chiffre | Clauses contractuelles types | A et B |
| **Infomaniak Network SA** (Swiss Backup) | **Suisse — pays tiers** | Sauvegardes, chiffrées par restic avant envoi | **Décision d'adéquation** du 26 juillet 2000 | A et B |
| **OVH SAS** | France — Gravelines (Nord) | Rien en clair — l'hébergeur porte la machine, pas les données applicatives | Dans l'Union, pas un transfert | B uniquement |
| **OVH SAS** | France — Roubaix (Nord) | Instantanés du serveur physique | Dans l'Union, pas un transfert | B uniquement |

**La Suisse est un pays tiers vu de France.** La décision d'adéquation dispense
de garanties supplémentaires, mais le transfert existe et doit être déclaré : une
version antérieure de ce registre, écrite quand l'établissement était cru suisse,
présentait Swiss Backup comme l'absence d'un transfert. C'était l'inverse.

### ghostbit — reçoit des données, et n'est pourtant ni un destinataire tiers ni un transfert

Créer un lien de partage transmet le bloc **chiffré** à **ghostbit**, un autre
service de StackOps exploité sur son infrastructure
(`apps/server/src/services/ghostbit.ts`). Ce n'est donc ni une communication à un
tiers ni un transfert : même responsable, même infrastructure, même pays. La clé
de déchiffrement vit dans le fragment de l'URL et n'atteint aucun serveur.

Cela figure ici bien que rien ne l'y oblige, parce qu'un registre qui ne
mentionne que les mouvements *externes* laisse croire qu'il n'y en a pas
d'autres. En modèle B, la configuration doit désigner l'instance ghostbit du
Client — voir §6 du DPA.

---

## Description générale des mesures de sécurité (art. 30.1.g et 30.2.d)

Le détail, par modèle d'hébergement, est au §5 et §5 bis du DPA. En synthèse :

- **Chiffrement de bout en bout** — clés dérivées du mot de passe maître, jamais
  transmises. Le serveur ne contient aucune primitive capable d'ouvrir un
  coffre — sa seule opération de déchiffrement porte sur le secret du second
  facteur, ligne suivante ;
- **Second facteur** — TOTP, WebAuthn, clés d'accès. Le secret TOTP est chiffré
  au repos (AES-256-GCM, clé hors base) depuis le 2026-08-30 ;
- **Cloisonnement** — par machine virtuelle dans le modèle B, applicatif dans le
  modèle A ;
- **Durcissement d'exécution** — conteneur non-root, racine en lecture seule,
  `NoNewPrivileges` ;
- **Chaîne de fabrication** — analyse de dépendances et de secrets en intégration
  continue, revue par un pair obligatoire avant fusion ;
- **Sauvegardes** — quotidiennes, chiffrées avant de quitter la machine, hors
  site ;
- **Minimisation** — purge automatique des traces de connexion et du journal
  d'audit.

**Écart connu**, écrit ici comme il l'est au DPA : dans le **modèle A**, la
connexion entre l'application et sa base traverse le réseau interne **en clair**.
Le serveur accepte TLS ; l'application ne le demande pas encore. Sans objet dans
le modèle B, où le lien ne quitte pas la machine.

---

## Analyse d'impact (art. 35)

Un examen préalable daté conclut qu'**aucune analyse d'impact n'est requise à ce
jour** pour les comptes individuels, et nomme les cinq événements qui
renverseraient cette conclusion :
[`aipd-examen-prealable.md`](aipd-examen-prealable.md).

Pour les coffres d'organisations, l'AIPD incombe au Client, qui en est le
responsable ; StackOps l'y assiste.

## Tenue du registre

| | |
|---|---|
| Responsable de la mise à jour | Kevin Allioli |
| Fréquence de revue | À chaque signature ou résiliation d'un DPA, à chaque ajout de sous-traitant ultérieur, et au minimum **une fois par an** |
| Emplacement | `stackops/ghostpass`, `docs/legal/` — versionné, donc l'historique des modifications est celui de Git |

**Le versionnement est ici une mesure de conformité, pas une commodité.** Une
autorité qui demande « depuis quand cette ligne dit-elle cela » obtient une
réponse datée et signée, ce qu'un document bureautique ne donne pas.

## Journal des versions

| Version | Date | Modification |
|---|---|---|
| 0.1 | 2026-08-31 | Création. Aucun responsable du traitement en fiche B — aucun DPA n'est signé |
| 0.2 | 2026-08-31 | **L'établissement est français**, siège à Saint-Julien-en-Genevois, et non suisse comme l'écrivaient les conditions générales. Trois conséquences : le représentant art. 27 devient sans objet, la Suisse devient un pays tiers de destination, et la sauvegarde OVH de Roubaix entre au tableau des transferts |
| 0.3 | 2026-08-31 | **ghostbit** entre au registre : le partage lui transmet le bloc chiffré. Ce n'est ni une communication à un tiers ni un transfert — même responsable, même infrastructure, même pays — mais un registre muet sur les mouvements internes laisse croire qu'il n'y en a pas. La mesure « aucune primitive de déchiffrement » est corrigée en « aucune primitive capable d'ouvrir un coffre » |
