# Formulaire ANSSI — les réponses, rubrique par rubrique

Réponses à recopier dans `crypto_declaration-demande_autorisation_operations_annexe1_v2.pdf`,
l'annexe I du décret n° 2007-663 du 2 mai 2007.

**Le PDF est un formulaire XFA** : il ne s'ouvre que dans Adobe Acrobat Reader. Aperçu de
macOS, les navigateurs et la plupart des lecteurs affichent une page blanche avec un
message invitant à mettre à jour le lecteur. Ce n'est pas un fichier abîmé.

## Avertissement

Ce document remplit ce qui se tire du code. **Trois points relèvent d'un arbitrage** et
sont marqués `À TRANCHER` : ils engagent l'entreprise et ne se déduisent d'aucun fichier.

Je ne suis pas juriste. Le contenu technique est vérifiable ligne à ligne dans le dépôt ;
la qualification ne l'est pas.

---

## Formalité à cocher, en tête du formulaire

> ☑ **Déclaration uniquement**

Le formulaire propose quatre cases : déclaration, autorisation, renouvellement, et
« déclaration et demande d'autorisation » qui est cochée par défaut.

**Ne pas laisser la case par défaut.** La demande d'autorisation vise les transferts vers
un État membre de l'Union et les exportations vers un pays tiers, au titre du chapitre III
du décret. La fourniture d'un moyen de cryptologie relève du chapitre II, et une
déclaration y suffit. Cocher « combiné » transformerait une formalité en instruction.

---

## A — Déclarant

`À TRANCHER` : **A.1 personne morale ou A.2 personne physique ?**

StackOps est une **entreprise individuelle**, qui n'a pas de personnalité morale distincte
de celle de son exploitant — mais qui porte une dénomination et un SIRET, que le formulaire
réclame en A.1. L'usage courant est de remplir A.1 ; c'est à confirmer.

| Champ | Valeur |
|---|---|
| Dénomination sociale | StackOps |
| Numéro SIRET | *(à reporter)* |
| Nationalité | Française |
| Adresse | *(siège, Saint-Julien-en-Genevois)* |
| Code postal / Ville | 74160 Saint-Julien-en-Genevois |
| Pays | France |

**Personne chargée du dossier administratif** : Kevin Allioli, `contact@stackops.ch`.

**Personne chargée des éléments techniques** : `À TRANCHER` — qui l'ANSSI doit-elle appeler
pour des questions de cryptographie ? Le contact publié pour la sécurité est
`contact@stackops.ch`, et `privacy@stackops.ch` pour les données personnelles.

---

## B.1 — Informations générales sur le moyen

| Champ | Valeur |
|---|---|
| Désignation générique | Gestionnaire de mots de passe à chiffrement de bout en bout |
| Dénomination du moyen | GhostPass |
| Version | 1.0 |
| Date de mise sur le marché | *(date de publication sur l'App Store)* |
| Fabricant | StackOps |
| Marque de distribution | StackOps |
| Référence commerciale | `ch.stackops.ghostpass` (identifiant de l'application iOS) |

Le déclarant **est** le fabricant : les champs « dénomination d'origine » et le bloc
réservé au cas contraire restent vides.

---

## B.2 — Description fonctionnelle

**Catégorie** : ☑ Logiciel (☐ Matériel)

**Fonction principale** : ☑ **Sécurité de l'information** (moyen de chiffrement,
bibliothèque cryptographique)

C'est la catégorie juste : le chiffrement n'est pas un accessoire du produit, il en est
la fonction. Les quatre autres — ordinateur, envoi/stockage/réception, réseau, autres —
décriraient un produit dont la cryptographie sert autre chose.

**Description générale du moyen** :

> GhostPass est un gestionnaire de mots de passe à connaissance nulle, destiné aux
> particuliers et aux petites organisations. Il conserve identifiants, notes et cartes
> bancaires dans un coffre chiffré sur l'appareil de l'utilisateur.
>
> Le chiffrement et le déchiffrement ont lieu exclusivement sur l'appareil, avec une clé
> dérivée d'un mot de passe maître que l'éditeur ne détient pas. Le serveur héberge des
> données qu'il ne peut pas déchiffrer : il ne dispose ni du mot de passe maître, ni de la
> clé de chiffrement, ni d'aucun contenu en clair, et ne peut pas les reconstituer.
>
> Le produit est distribué gratuitement sous licence Elastic License 2.0 et peut être
> hébergé par l'utilisateur lui-même. Il est disponible sous forme d'applications iOS et
> Android et d'une application web.

---

## B.3 — Description technique des services de cryptologie

**Catégories de fonctions cryptographiques** — cocher :

☑ **Confidentialité** — le contenu des coffres est chiffré
☑ **Intégrité** — les chiffrements sont authentifiés (Poly1305, GCM)
☑ **Authentification** — dérivation d'un condensat d'authentification, second facteur TOTP
☐ Signature — aucune signature n'est produite par le moyen

**Protocoles sécurisés utilisés** : aucun des protocoles listés (IPsec, SIP/RTP) n'est
employé. Le transport passe par HTTPS/TLS, assuré par l'hébergement, et **le chiffrement
de bout en bout en est indépendant** : il protège le contenu y compris d'un serveur
compromis, ce que TLS ne fait pas.

**Description des fonctionnalités cryptographiques** :

> Le mot de passe maître de l'utilisateur est transformé en clé sur son appareil par
> Argon2id. De cette clé sont dérivées, par HKDF sur deux étiquettes distinctes, une clé de
> chiffrement qui ne quitte jamais l'appareil et un condensat d'authentification qui seul
> est transmis au serveur, lequel le recondense avant stockage.
>
> Chaque élément du coffre porte sa propre clé, elle-même chiffrée sous la clé de
> l'utilisateur. Les coffres partagés entre membres d'une organisation emploient une clé
> d'organisation scellée individuellement pour chaque membre.
>
> **Aucun algorithme n'est implémenté par le produit** : le code appelle des bibliothèques
> publiques et auditables.

**Tableau des algorithmes** (le formulaire attend : algorithme, mode, taille de clé,
fonction) :

| Algorithme | Mode | Taille de clé | Fonction |
|---|---|---|---|
| Argon2id | 64 Mio, 3 passes, parallélisme 4 | sortie 256 bits | Dérivation depuis le mot de passe maître |
| XChaCha20-Poly1305 | AEAD, nonce 192 bits | 256 bits | Chiffrement du coffre |
| AES-GCM | AEAD, nonce 96 bits | 256 bits | Enveloppes de partage ponctuel |
| X25519 | échange de clés | 256 bits | Accord de clés |
| ChaCha20-Poly1305 | AEAD, via `crypto_box` | 256 bits | Scellement des clés d'organisation |
| HKDF | extraction-expansion, SHA-256 | 256 bits | Séparation des clés dérivées |
| SHA-256 | — | — | Condensats, sel de dérivation |

Publications de référence : RFC 9106 (Argon2), RFC 8439 et son extension XChaCha,
NIST FIPS 197 et SP 800-38D (AES-GCM), RFC 7748 (X25519), RFC 5869 (HKDF),
NIST FIPS 180-4 (SHA-256).

---

## C — Moyen relevant de la catégorie 3 de l'annexe 2

Cette section vise les moyens de grande diffusion. GhostPass en relève, et les trois
questions posées y répondent directement.

**Mode de commercialisation et marché visé** :

> Distribution gratuite par les boutiques d'applications d'Apple et de Google, sans achat
> intégré ni publicité, à destination du grand public et des petites organisations. Le
> logiciel serveur est également mis à disposition pour un hébergement par l'utilisateur.
> Aucune vente directe, aucune personnalisation par client, aucune restriction d'accès à
> l'acquisition.

**Pourquoi la fonctionnalité cryptographique ne peut pas être modifiée facilement par
l'utilisateur** :

> Les applications mobiles sont distribuées sous forme de binaires signés par leurs
> éditeurs respectifs ; toute modification invalide la signature et empêche l'installation.
> Les paramètres cryptographiques ne sont exposés par aucun réglage : ni le choix des
> algorithmes, ni les longueurs de clés, ni les paramètres de dérivation ne sont
> accessibles à l'utilisateur. Le client refuse en outre les paramètres de dérivation
> affaiblis qui lui seraient transmis par un serveur, en les revérifiant contre des
> planchers inscrits dans le code avant toute dérivation.

**Pourquoi l'installation ne nécessite pas d'assistance importante du fournisseur** :

> L'installation se fait depuis une boutique d'applications, sans intervention du
> fournisseur. La première utilisation demande une adresse de serveur, une adresse de
> courriel et un mot de passe maître ; aucune configuration cryptographique n'est requise
> ni possible. L'assistance se limite à une documentation publique.

---

## D — Renouvellement d'autorisation

**Sans objet.** Le moyen n'a jamais fait l'objet d'une autorisation de transfert ou
d'exportation. Laisser les trois champs vides.

---

## E — Pièces à joindre

| Pièce | État |
|---|---|
| Document général présentant la société | `À TRANCHER` — à produire par l'éditeur |
| Extrait K bis de moins de trois mois | **sans objet** — voir ci-dessous |
| Brochure commerciale du moyen | **prête** : `docs/legal/anssi/GhostPass-brochure-commerciale.pdf`, 2 pages |
| Brochure technique du moyen | **prête** : `docs/legal/anssi/GhostPass-dossier-technique.pdf`, 4 pages |
| Manuel utilisateur | Le README et la page produit, si un document séparé est demandé |
| Guide administrateur | La documentation d'auto-hébergement du dépôt |

---

### L'extrait K bis, que vous n'avez pas

Le K bis est réservé aux sociétés inscrites au registre du commerce. **StackOps est une
entreprise individuelle sous régime de micro-entreprise : il n'en existe pas.**

Le formulaire l'a prévu — il demande « un extrait K bis […] **ou un document équivalent** ».
Deux pièces font l'affaire, et toutes deux se téléchargent gratuitement :

- **l'avis de situation au répertoire SIRENE**, sur `avis-situation-sirene.insee.fr`, avec
  le numéro SIREN ;
- **l'extrait d'immatriculation au Registre National des Entreprises**, sur `data.inpi.fr`,
  souvent mieux reçu car il porte la mention « entreprise individuelle ».

Joindre l'une des deux, datée de moins de trois mois, et **indiquer en clair dans le
courriel de dépôt** qu'il s'agit du document équivalent au K bis pour une entreprise
individuelle. Une pièce absente sans explication fait revenir le dossier ; une pièce
remplacée et nommée, non.

**Ce que cela dit de la question A.1 / A.2** : le formulaire lie l'extrait K bis à la
personne morale. Ne pas en avoir est un indice en faveur du **A.2, personne physique** —
une entreprise individuelle n'a pas de personnalité distincte de son exploitant. Cela ne
tranche pas pour autant : A.2 est décrit comme « le cas où le déclarant est un
particulier », ce qui décrit mal quelqu'un agissant dans son activité professionnelle.
`controle@ssi.gouv.fr` répond à ce genre de question, et la poser coûte moins qu'un
aller-retour.

## F — Attestation

Datée et signée par une personne habilitée à engager le déclarant : Kevin Allioli, en
qualité d'exploitant de l'entreprise individuelle StackOps.

---

## Le dépôt

Par courriel à **`controle@ssi.gouv.fr`**, avec un objet de forme imposée :

```
[formalités] StackOps – GhostPass
```

Trois pièces, et les deux premières sont bien deux fichiers distincts du même formulaire :

1. le formulaire **complété, signé et scanné** ;
2. le formulaire **électronique complété et sauvegardé** ;
3. la documentation, en `.pdf`, `.xls` ou `.doc` — **le markdown n'est pas accepté**.

## Ce que l'ANSSI peut demander ensuite

Le formulaire annonce les éléments qu'elle est en droit de réclamer, et deux méritent
d'être anticipés :

- **le code source du moyen et de quoi le recompiler.** C'est disponible : le miroir
  public porte le serveur et le chiffrement du client web, et le cœur mobile peut être
  communiqué.
- **la description des prétraitements et post-traitements** appliqués aux données avant et
  après chiffrement. Elle figure au §2 de l'annexe technique.
