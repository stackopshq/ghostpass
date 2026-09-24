# Notification d'export — code source de chiffrement publiquement disponible

Projet de notification au titre du **§742.15(b)** de l'EAR, à envoyer avant la première
mise à disposition publique du code source.

## Avertissement, à lire avant de s'en servir

Ce document prépare une démarche ; il ne la valide pas.

Je ne suis pas juriste. Les règles américaines d'export de chiffrement ont changé
plusieurs fois — le BIS a notamment révisé ses obligations de notification en 2021 — et le
texte en vigueur prime sur ce fichier. **Faites relire avant d'envoyer.**

Ce que ce document apporte de sûr : l'inventaire technique, tiré du code et vérifiable,
que la notification réclame. Voir aussi [`anssi-dossier-technique.md`](anssi-dossier-technique.md),
qui couvre le versant français et sert la même matière.

## Ce que cette voie suppose, et qui n'était pas vrai jusqu'ici

Le §742.15(b) vise le code source **publiquement disponible**. Le critère est
l'accessibilité réelle, pas le nom de la licence : jusqu'au 24 septembre 2026, le miroir
public de GhostPass répondait `404`, et l'argument ne tenait pas.

La publication du dépôt sur `https://github.com/stackopshq/ghostpass` change cela — et
c'est **la condition** de tout ce qui suit. Si le dépôt redevenait privé, la notification
deviendrait sans objet.

**Une nuance qui mérite un avis, et que ce document ne tranche pas** : l'exemption porte sur
le **code source**. Le binaire distribué par l'App Store est un objet compilé, et
l'articulation entre les deux est précisément le genre de question où se tromper coûte
cher. Le §740.17(b) — chiffrement de grande diffusion — est l'autre voie, et elle vise les
objets.

## Destinataires

| À | Adresse |
|---|---|
| Bureau of Industry and Security | `crypt@bis.doc.gov` |
| National Security Agency | `enc@nsa.gov` |

Ces adresses sont à **revérifier sur le texte en vigueur** au moment de l'envoi.

## Projet de message

> Subject: Notification of publicly available encryption source code — GhostPass
>
> Pursuant to §742.15(b) of the Export Administration Regulations, this is notification of
> the internet location of publicly available encryption source code.
>
> **Source code URL:** https://github.com/stackopshq/ghostpass
>
> **Submitter:** StackOps, sole proprietorship of Kevin Allioli,
> Saint-Julien-en-Genevois (Haute-Savoie), France.
> **Contact:** contact@stackops.ch
>
> **Description.** GhostPass is a zero-knowledge password manager. Encryption and
> decryption happen on the user's device; the server stores only ciphertext it cannot read.
> The software is source-available under the Elastic License 2.0 and can be self-hosted.
>
> **Cryptographic functions.** No algorithm is implemented by this project: the code calls
> published, auditable libraries.
>
> | Purpose | Primitive | Publication |
> |---|---|---|
> | Key derivation from the master password | Argon2id, 64 MiB, 3 passes, 32-byte output | RFC 9106 |
> | Vault encryption | XChaCha20-Poly1305, 256-bit key | RFC 8439 and the XChaCha extension |
> | Share envelopes | AES-256-GCM, 96-bit nonce | NIST FIPS 197, SP 800-38D |
> | Sealing organisation keys | crypto_box (X25519 + ChaCha20-Poly1305) | RFC 7748, RFC 8439 |
> | Key agreement | X25519 | RFC 7748 |
> | Key separation | HKDF-SHA-256 | RFC 5869 |
> | Digests | SHA-256 | NIST FIPS 180-4 |
>
> No proprietary or non-published algorithm is used.

## Après l'envoi

- Conserver le message envoyé et son accusé : App Store Connect réclame une preuve de
  classification, et c'est elle.
- Si l'URL du dépôt change, **renotifier**. Une notification qui pointe une adresse morte
  ne vaut rien, et c'est exactement l'état dans lequel était le miroir avant aujourd'hui.

## Ce que cela ne règle pas

La déclaration française reste due. La fourniture d'un moyen de cryptologie assurant la
confidentialité relève d'une déclaration à l'ANSSI, indépendamment du régime américain et
du fait que le code soit public ou non. Voir
[`anssi-dossier-technique.md`](anssi-dossier-technique.md).
