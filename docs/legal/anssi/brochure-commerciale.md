---
title: "GhostPass — présentation du produit"
author: "StackOps"
---

# GhostPass

**Un gestionnaire de mots de passe dont le serveur ne peut pas lire vos mots de passe.**

GhostPass conserve identifiants de connexion, notes et cartes bancaires dans un coffre
chiffré, accessible depuis un iPhone, un iPad, un téléphone Android ou un navigateur, et
synchronisé entre les appareils de son utilisateur.

Il est édité par **StackOps**, entreprise individuelle de Kevin Allioli, à
Saint-Julien-en-Genevois (Haute-Savoie, France).

## À qui il s'adresse

Aux particuliers et aux petites organisations qui veulent garder leurs secrets sans
confier leur contenu à un tiers — y compris à l'éditeur du produit.

Le logiciel serveur est également mis à disposition de ceux qui préfèrent l'héberger
eux-mêmes, sur leur propre matériel.

## Ce que le produit fait

**Un coffre chiffré sur l'appareil.** Le chiffrement et le déchiffrement ont lieu
localement. Le serveur héberge des données qu'il ne sait pas lire.

**Le remplissage automatique des identifiants.** Depuis le clavier, dans le navigateur
comme dans les applications. Les codes à usage unique sont calculés sur l'appareil et
proposés au bon champ.

**La santé du coffre.** Le coffre se relit pour signaler les mots de passe trop courts,
réutilisés ou dépourvus de second facteur. La vérification des fuites connues n'envoie
jamais le mot de passe : seuls les cinq premiers caractères de son empreinte partent, et
la comparaison se fait sur l'appareil.

**Le partage ponctuel d'un secret.** Un lien qui expire à la date choisie, ou après le
nombre de consultations choisi. La clé de déchiffrement voyage dans le fragment de
l'adresse — la partie après le dièse, que les navigateurs n'envoient jamais au serveur.

**Les coffres d'équipe.** Des collections partagées entre membres d'une organisation, avec
la possibilité de voir qui a accès à quoi et de le reprendre. Retirer quelqu'un renouvelle
la clé de l'équipe.

**L'accès d'urgence.** La possibilité de confier à un proche l'ouverture du coffre après un
délai fixé, pendant lequel le titulaire peut refuser.

**Le fonctionnement hors ligne.** Le coffre s'ouvre sans réseau, depuis une copie chiffrée
conservée sur l'appareil.

## Les fonctionnalités cryptographiques, en résumé

Le mot de passe maître de l'utilisateur ne quitte jamais son appareil. Il y est transformé
en clé par **Argon2id**, et cette clé ouvre le coffre, chiffré en
**XChaCha20-Poly1305**. Le serveur ne reçoit qu'un condensat d'authentification, qui ne
permet pas de remonter au mot de passe ni d'ouvrir quoi que ce soit.

Les secrets partagés par lien sont scellés en **AES-256-GCM**, et les clés d'organisation
par une boîte authentifiée **X25519 avec ChaCha20-Poly1305**.

**Aucun de ces algorithmes n'a été écrit pour ce produit.** Tous sont publiés et
normalisés — RFC 9106, RFC 8439, NIST FIPS 197 et SP 800-38D, RFC 7748, RFC 5869,
NIST FIPS 180-4 — et mis en œuvre par des bibliothèques publiques et auditables.

Le détail des paramètres figure dans la documentation technique jointe au dossier.

## Ce que le produit ne fait pas

Il ne collecte aucune donnée d'usage, n'affiche aucune publicité et ne contient aucun
traceur.

L'éditeur ne détient ni le mot de passe maître, ni la clé de chiffrement, ni aucun contenu
de coffre en clair, et n'est pas en mesure de les reconstituer. Ce n'est pas une politique
interne : c'est une propriété du produit.

## Distribution

Gratuit, sans achat intégré. Distribué par l'App Store d'Apple et le Play Store de Google,
et sous forme d'une application web. Le code est disponible sous licence
**Elastic License 2.0**, et le serveur peut être auto-hébergé.

- Site du produit : `https://ghostsuite.cloud/ghostpass/`
- Politique de confidentialité : `https://ghostsuite.cloud/confidentialite/`
- Contact : `contact@stackops.ch`
