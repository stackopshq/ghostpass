# Auto-classification à l'export — GhostPass

Dossier préparatoire à l'**auto-classification** du produit au titre de l'EAR américain, et
à la notification qui l'accompagne. C'est la pièce qu'App Store Connect réclame sous
« Documents sur le chiffrement des apps ».

## Avertissement, à lire avant de s'en servir

Ce document prépare une démarche ; il ne la valide pas.

Je ne suis pas juriste. Les règles américaines d'export de chiffrement ont changé plusieurs
fois — le BIS a notamment révisé ses obligations de notification et de rapport en 2021 — et
le texte en vigueur prime sur ce fichier. **Faites relire avant d'envoyer, et vérifiez les
adresses, l'ECCN et la périodicité sur la source officielle.**

Ce que ce document apporte de sûr : l'inventaire technique, relevé dans le code et
vérifiable ligne à ligne. C'est le gros du travail, et c'est la partie où se tromper
coûterait le plus cher.

## Pourquoi cette voie plutôt qu'une autre

| Voie | Ce qu'elle suppose | Pourquoi elle n'a pas été retenue |
|---|---|---|
| **Auto-classification** | Classer soi-même, notifier, puis rapporter chaque année | **Retenue** |
| CCATS | Demande formelle au BIS, instruction de plusieurs semaines | Inutile pour un produit de grande diffusion à algorithmes publics |
| §742.15(b), code publiquement disponible | Que le code **de chiffrement** soit public | Le miroir public `stackopshq/ghostpass` ne contient **pas** le cœur employé par les applications — voir ci-dessous |

### Le piège du miroir, et pourquoi la troisième voie ne tenait pas

`stackopshq/ghostpass` est public. Mais le code qui chiffre le coffre **dans le binaire
livré** n'y est pas :

- `crates/ghostpass-crypto-ffi`, présent dans le dépôt public, n'est appelé que par
  l'outillage de test — `seed-vault`, qui amorce les bancs de captures et de parcours.
- `ghost-crypto-ffi`, dans le dépôt `ghostsuite` **non publié**, est ce que compilent
  `tools/ios/build-xcframework.sh` et `tools/android/build-jni.sh`. C'est lui qui part
  dans l'IPA.

Une notification pointant le miroir aurait donc désigné un dépôt qui ne contient pas le
chiffrement du produit distribué. Pire que pas de notification : on la croirait faite.

Cette voie redeviendrait praticable si `ghostsuite` — ou au moins ses `crates/ghost-crypto*` —
était publié. C'est une décision de produit, pas une conséquence de l'export.

## Classification proposée

| Champ | Valeur proposée |
|---|---|
| ECCN | **5D992.c** — logiciel de chiffrement de grande diffusion |
| Fondement | §740.17(b)(1) de l'EAR, chiffrement dit « mass market » |
| Objet classé | GhostPass, applications iOS et Android, et le serveur associé |

**À faire confirmer.** L'ECCN et le fondement sont ce qui, dans tout ce document, relève le
plus du droit. L'inventaire ci-dessous est fait pour qu'un juriste puisse trancher vite.

## Inventaire technique

Relevé dans `ghost-crypto`, le cœur que les applications embarquent réellement.
**Aucun algorithme n'est implémenté par le projet** : le code appelle des bibliothèques
publiques et auditables. C'est ce qui rend « non propriétaire » vérifiable plutôt que
déclaratif.

| Fonction | Primitive | Paramètres | Publication |
|---|---|---|---|
| Dérivation depuis le mot de passe maître | Argon2id | 64 Mio, 3 passes, parallélisme 4, sortie 256 bits | RFC 9106 |
| Sel de dérivation | SHA-256 de l'adresse, tronqué | 128 bits, déterministe | NIST FIPS 180-4 |
| Séparation des clés dérivées | HKDF-SHA-256 | deux étiquettes distinctes | RFC 5869 |
| Chiffrement du coffre | XChaCha20-Poly1305 | clé 256 bits, nonce 192 bits | RFC 8439 et l'extension XChaCha |
| Enveloppes de partage | AES-256-GCM | clé 256 bits, nonce 96 bits | NIST FIPS 197, SP 800-38D |
| Scellement des clés d'organisation | crypto_box | X25519 + ChaCha20-Poly1305 | RFC 7748, RFC 8439 |
| Accord de clés | X25519 | — | RFC 7748 |

Bibliothèques : `argon2 0.5`, `chacha20poly1305 0.10`, `aes-gcm 0.10`, `crypto_box 0.9`,
`x25519-dalek 2.0`, `hkdf 0.12`, `sha2 0.10`, `zeroize 1.9`, entropie du système via
`getrandom`.

## Fonction du produit

GhostPass est un gestionnaire de mots de passe **à connaissance nulle**. Le chiffrement et
le déchiffrement ont lieu sur l'appareil ; le serveur ne détient que des données qu'il ne
peut pas lire. Il est distribué gratuitement, sous **Elastic License 2.0**, et peut être
auto-hébergé.

Ce que le serveur détient, et qui figure dans la politique de confidentialité publiée : des
adresses de courriel et des blocs chiffrés. Ce qu'il ne détient pas : mot de passe maître,
clé de chiffrement, clé privée en clair, ni aucun contenu de coffre.

## Les deux gestes de la démarche

### 1. La notification, avant la première exportation

| À | Adresse |
|---|---|
| Bureau of Industry and Security | `crypt@bis.doc.gov` |
| National Security Agency | `enc@nsa.gov` |

Projet de message :

> Subject: Mass market encryption self-classification — GhostPass
>
> Pursuant to §740.17(b)(1) of the Export Administration Regulations, this is notification
> of the self-classification of a mass market encryption item.
>
> **Product:** GhostPass, a zero-knowledge password manager (iOS, Android, and server).
> **ECCN:** 5D992.c
> **Submitter:** StackOps, sole proprietorship of Kevin Allioli,
> Saint-Julien-en-Genevois (Haute-Savoie), France.
> **Contact:** contact@stackops.ch
>
> **Description.** Encryption and decryption happen on the user's device. The server stores
> only ciphertext it cannot read. The software is source-available under the Elastic
> License 2.0 and can be self-hosted.
>
> **Cryptographic functions.** No algorithm is implemented by this project: the code calls
> published, auditable libraries.
>
> | Purpose | Primitive | Publication |
> |---|---|---|
> | Key derivation from the master password | Argon2id, 64 MiB, 3 passes, 256-bit output | RFC 9106 |
> | Vault encryption | XChaCha20-Poly1305, 256-bit key | RFC 8439 and the XChaCha extension |
> | Share envelopes | AES-256-GCM, 96-bit nonce | NIST FIPS 197, SP 800-38D |
> | Sealing organisation keys | crypto_box (X25519 + ChaCha20-Poly1305) | RFC 7748, RFC 8439 |
> | Key agreement | X25519 | RFC 7748 |
> | Key separation | HKDF-SHA-256 | RFC 5869 |
> | Digests | SHA-256 | NIST FIPS 180-4 |
>
> No proprietary or non-published algorithm is used.

### 2. Le rapport annuel

**C'est le piège de cette voie, et c'est pourquoi il est écrit ici plutôt que découvert
plus tard.** Une auto-classification n'est pas un acte unique : elle suppose un rapport
annuel au BIS, couvrant les produits classés l'année précédente.

L'échéance et la forme sont à vérifier sur le texte en vigueur. **Mettre un rappel
calendaire le jour de la première notification** — un oubli d'un an ne se remarque pas, et
c'est exactement le genre d'obligation dont on découvre l'existence au contrôle.

## Après l'envoi

- Conserver le message et son accusé : c'est la pièce qu'App Store Connect réclame.
- Reporter le numéro obtenu dans la fiche, et le cas échéant dans `project.yml` sous
  `INFOPLIST_KEY_ITSEncryptionExportComplianceCode`.
- Renotifier si la composition cryptographique change. Ajouter une primitive, changer un
  paramètre, ou passer d'une bibliothèque à une autre modifie l'objet classé.

## Ce que cela ne règle pas

La **déclaration française** reste due. La fourniture d'un moyen de cryptologie assurant la
confidentialité relève d'une déclaration à l'ANSSI, indépendamment du régime américain et
du fait que le code soit public ou non. Voir
[`anssi-dossier-technique.md`](anssi-dossier-technique.md), qui partage le même inventaire.
