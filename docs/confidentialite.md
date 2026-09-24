# Politique de confidentialité — GhostPass

> **Brouillon.** Ce texte décrit fidèlement ce que fait le code ; il n'a pas été relu par
> un juriste. Apple exige une URL de politique de confidentialité pour publier — celle-ci
> est un point de départ, pas un document validé. Les mentions entre crochets sont à
> compléter.

*Dernière mise à jour : [date]*
*Responsable de traitement : [raison sociale], [adresse], [contact].*

## En un paragraphe

GhostPass est un gestionnaire de mots de passe chiffré de bout en bout. Le chiffrement a
lieu sur votre appareil, avec une clé dérivée de votre mot de passe maître — que nous ne
connaissons pas et qui ne quitte jamais votre appareil. Le serveur héberge des données
qu'il ne peut pas lire. Nous n'avons donc pas la possibilité technique d'accéder au contenu
de votre coffre, ni de le restituer si vous perdez votre mot de passe maître et votre clé
de récupération.

## Ce que nous détenons

**Votre adresse e-mail.** Elle identifie votre compte et sert aux échanges nécessaires au
service.

**Votre coffre, chiffré.** Identifiants, notes, cartes : tout est chiffré sur votre
appareil avant d'être transmis. Nous stockons des blocs illisibles pour nous.

**Un historique de connexions** — date, adresse IP, description de l'appareil. Il vous est
présenté dans l'application pour que vous puissiez repérer un accès qui ne serait pas le
vôtre. C'est aussi ce qui permet de vous signaler un appareil inconnu.

**Un journal des actions sensibles** : activation ou retrait d'un second facteur, accès
d'urgence accordé, renouvellement d'une clé d'équipe. Même objet.

## Ce que nous ne détenons pas

Votre mot de passe maître. Le serveur n'en reçoit qu'une empreinte, calculée sur votre
appareil, qui ne permet pas de le retrouver. Vos clés de chiffrement. Le contenu de votre
coffre en clair. Aucun traceur publicitaire, aucun outil d'analyse comportementale, aucune
transmission à des tiers à des fins commerciales.

## Ce que l'application contacte

**Votre serveur GhostPass**, dont vous choisissez l'adresse.

**`api.pwnedpasswords.com`**, et seulement si vous lancez vous-même une vérification de
fuite. Cet appel n'envoie jamais un mot de passe : seuls les cinq premiers caractères de
son empreinte partent, et la comparaison se fait sur votre appareil parmi les réponses
reçues. Le service interrogé ne peut pas savoir quel mot de passe vous vérifiiez.

**Le service d'icônes de votre serveur**, si vous laissez les icônes de sites activées.
Les adresses des sites de votre coffre transitent alors vers *votre* serveur — jamais vers
un tiers. Le réglage se coupe dans l'application.

Aucune police, aucun script, aucune ressource n'est chargé depuis un service tiers.

## Partage

**Coffres d'équipe.** Ce que vous y déposez est lisible par les membres à qui la clé de
l'équipe a été remise. Retirer quelqu'un renouvelle cette clé — mais ce qu'il a déjà vu
reste connu de lui, et les mots de passe concernés doivent être changés.

**Accès d'urgence.** Vous pouvez confier à un contact la possibilité d'ouvrir votre coffre
après un délai que vous fixez, pendant lequel vous pouvez refuser.

**Partage ponctuel.** Le lien contient la clé après le `#` : cette partie n'est jamais
transmise au serveur. Quiconque détient le lien peut lire le secret, une fois ou le nombre
de fois que vous avez choisi, jusqu'à l'échéance que vous avez fixée.

## Durées

Votre compte et votre coffre sont conservés tant que vous les gardez. Les partages
ponctuels s'effacent à leur échéance ou après épuisement des consultations, au plus tard
sous 30 jours. [Durée de conservation de l'historique de connexions : à préciser.]

## Vos droits

Conformément au RGPD, vous disposez d'un droit d'accès, de rectification, d'effacement, de
limitation, d'opposition et de portabilité. Écrivez à [contact].

Une limite technique mérite d'être dite franchement : nous pouvons vous restituer vos
données chiffrées et supprimer votre compte, mais nous ne pouvons pas vous fournir le
contenu de votre coffre en clair — nous n'y avons pas accès. Vous seul le pouvez, depuis
l'application, par la fonction d'export.

Vous pouvez introduire une réclamation auprès de la CNIL.

## Hébergement

[À compléter : hébergeur, pays, garanties.]

## Modifications

Toute modification de ce document sera annoncée dans l'application avant son entrée en
vigueur.
