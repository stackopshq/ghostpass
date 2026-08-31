# Conditions générales d'utilisation — GhostPass

> **Projet — à faire relire par un juriste avant toute mise en ligne.**
> Rédigé à partir de ce que le produit fait réellement. Les faits techniques
> sont vérifiables dans le code ; les qualifications juridiques ne sont pas
> encore relues.

*Version 0.1 — 2026-08-30.*

---

## 1. Qui édite ce service

GhostPass est édité par **StackOps**, entreprise individuelle de Kevin Allioli,
dont le siège est à **Saint-Julien-en-Genevois (Haute-Savoie), France**. Contact :
support@stackops.ch. Pour toute question de protection des données :
privacy@stackops.ch. Pour signaler une faille : security@stackops.ch (voir
`/.well-known/security.txt`).

## 2. Ce que le service fait

GhostPass conserve vos secrets — identifiants, notes, cartes — **chiffrés avec
une clé dérivée de votre mot de passe maître, sur votre appareil**. Le serveur
reçoit du chiffré et rend du chiffré.

## 3. Ce que cela implique pour vous, et qu'il faut lire avant de commencer

**Nous ne pouvons pas réinitialiser votre mot de passe maître.** Ce n'est pas une
politique, c'est une conséquence : la clé de vos données en dérive, et nous ne
la détenons pas. Si vous le perdez sans avoir conservé votre kit de récupération,
**vos données sont définitivement inaccessibles**, y compris pour nous.

C'est le prix de la garantie inverse : personne chez StackOps, ni personne qui
obtiendrait un accès à nos serveurs, ne peut lire vos secrets.

**Conservez votre kit de récupération**, hors de GhostPass et hors de l'appareil
qui vous sert à vous connecter.

## 4. Ce que nous voyons, et ce que nous ne voyons pas

| Nous ne voyons pas | Nous voyons |
|---|---|
| Le contenu de vos secrets | Votre adresse de courriel |
| Vos mots de passe, notes, cartes, fichiers | Les noms de vos organisations, collections et groupes |
| Les noms de vos dossiers personnels | La date et l'adresse IP de vos connexions (90 jours) |
| Votre mot de passe maître | Vos actions au journal d'audit (365 jours) |

Si le service d'icônes est activé, notre serveur récupère le logo des sites que
vous enregistrez, et **voit donc leur domaine à ce moment-là**. Il ne les
conserve pas, et le service peut être désactivé.

Le détail complet — finalités, bases légales, durées, destinataires, transferts
hors de l'Union et voies de recours — vit dans la
**[politique de confidentialité](politique-de-confidentialite.md)**, qui fait
partie de ces conditions. Ce tableau en est le résumé, pas la substitution.

## 5. Votre compte

Vous êtes responsable de la confidentialité de votre mot de passe maître et de
vos seconds facteurs. Vous devez avoir la capacité juridique de contracter.

Un compte peut être suspendu en cas d'usage manifestement illicite ou
d'atteinte à l'intégrité du service. La suspension n'est jamais un moyen de
pression commercial.

## 6. Vos droits, et comment les exercer sans nous écrire

- **Exporter toutes vos données** : Sécurité → *Exporter mes données*. Le fichier
  contient ce que nous détenons, chiffré tel que nous le détenons.
- **Supprimer votre compte** : Sécurité → *Supprimer mon compte*. Immédiat et
  irréversible.

Ces deux actions sont dans l'interface et ne demandent aucune démarche auprès de
nous, délibérément : un droit qui suppose d'écrire à un service client est un
droit qu'on n'exerce pas.

Pour les autres droits (rectification, opposition, limitation) :
privacy@stackops.ch. Réponse sous trente jours.

## 7. Disponibilité

Le service est fourni sans engagement de disponibilité chiffré à ce jour. Nous
publions nos interruptions et nous nous efforçons de prévenir des maintenances.

**Aucun engagement de niveau de service n'est pris tant qu'il n'est pas écrit
ici** : une promesse de disponibilité orale ou commerciale n'engage pas, et nous
préférons ne rien promettre que promettre ce que nous ne mesurons pas encore.

## 8. Vos données vous appartiennent

Vous restez titulaire de vos données. Nous ne les exploitons pas, ne les
analysons pas, ne les revendons pas, et ne nous en servons pas pour entraîner
quoi que ce soit.

Si vous utilisez GhostPass au nom d'une organisation, un **accord de
sous-traitance** distinct s'applique (`docs/legal/dpa.md`).

## 9. Le logiciel

GhostPass est **open-source et intégralement auto-hébergeable**. Vous pouvez
lire le code, le vérifier, et faire tourner votre propre instance. Dans ce cas,
ces conditions ne s'appliquent pas : nous ne sommes plus votre hébergeur, mais
seulement l'auteur du logiciel, sous sa licence.

## 10. Responsabilité

Nous mettons en œuvre les mesures décrites dans notre documentation de sécurité.
Notre responsabilité ne peut être engagée pour la perte d'un mot de passe maître
(§3), ni pour l'usage que vous faites du service.

Nous n'excluons pas notre responsabilité en cas de faute grave ou intentionnelle.

**Aucun plafond de responsabilité n'est fixé ici**, et c'est une lacune, pas une
générosité. StackOps est une entreprise individuelle : sans plafond, l'exploitant
répond sur son patrimoine propre, sans limite de montant. Une clause de
plafonnement — usuellement adossée au montant payé sur douze mois — appartient à
cette section, et son absence est le point que la relecture juridique doit
trancher en premier.

## 11. Modification

Toute modification substantielle est annoncée **trente jours avant** son entrée
en vigueur, par courriel et dans l'application. Vous pouvez résilier sans frais
pendant ce délai.

## 12. Droit applicable

Droit français. For juridique : les tribunaux compétents du siège de
l'exploitant, à Saint-Julien-en-Genevois — il ne
s'invente pas et une clause de for erronée est pire qu'absente. Sous réserve des
dispositions impératives
protégeant les consommateurs et, pour les résidents de l'Union européenne, des
règles de compétence qui leur sont propres.
