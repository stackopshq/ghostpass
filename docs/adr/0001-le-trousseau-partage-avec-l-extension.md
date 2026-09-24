# 0001 — Le mot de passe maître est lisible par l'extension de remplissage

*Décidé le 2026-08-30. Statut : accepté.*

## Ce qui se décide ici

L'application et son extension de remplissage automatique sont deux processus. Faut-il
que l'extension puisse lire, sous contrôle biométrique, le mot de passe maître que
l'application a rangé dans le trousseau ?

## L'état de départ, découvert par un audit

Aucun `keychain-access-groups` n'était déclaré, et le code ne posait jamais
`kSecAttrAccessGroup`. Chaque cible écrivait donc dans son groupe d'accès par défaut,
dérivé de son propre identifiant d'application — `ch.stackops.ghostpass` d'un côté,
`ch.stackops.ghostpass.autofill` de l'autre.

Conséquence : `AutoFillStore.canUseBiometrics` rendait toujours faux, et
`AutoFillStore.unlockWithBiometrics` n'était **jamais exécuté**. L'utilisateur retapait
son mot de passe maître à chaque remplissage. Ce n'était pas un choix — c'était un défaut
que rien ne signalait, parce que la lecture d'un élément absent est traitée comme un refus
silencieux, ce qui est le bon comportement partout ailleurs.

## Les deux options

**A. Ne pas partager.** Le mot de passe maître reste confiné à un seul processus.
L'extension continue de le demander à chaque usage.

**B. Partager** un groupe de trousseau entre les deux cibles. L'extension peut alors lire
l'élément, sous la même protection qu'aujourd'hui.

## Ce qui a été retenu, et pourquoi

**B, le partage.**

Le point décisif est que **le partage ne rend pas le mot de passe maître lisible**.
L'élément est protégé par `kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly` et un
`SecAccessControl` en `.biometryCurrentSet` : la Secure Enclave exige une correspondance
biométrique à chaque lecture, et l'ajout d'un visage ou d'un doigt invalide l'élément. Ce
que le partage change, c'est qu'un **second processus, signé par la même équipe, dans le
même bac à sable**, peut demander ce déverrouillage. La surface ajoutée est réelle mais
étroite : elle suppose déjà un compromis du binaire de l'extension, et quiconque en est là
peut aussi bien attendre que l'utilisateur ouvre l'application.

En face, l'option A a un coût de sécurité que sa prudence apparente masque : **un mot de
passe maître retapé dix fois par jour est un mot de passe maître qu'on raccourcit**, et
qu'on saisit en public, dans un contexte — une page web dans Safari — où l'utilisateur est
précisément le moins attentif. Cet affaiblissement-là est systématique et subi par tous,
là où le risque de l'option B suppose un attaquant déjà présent sur l'appareil.

1Password et Bitwarden font le même choix sur iOS. Ce n'est pas un argument d'autorité,
mais le signe que le compromis a été pesé ailleurs dans le même sens.

## Ce que ça change concrètement

- Les deux `.entitlements` déclarent le même `keychain-access-groups`, avec le groupe
  partagé **en première position** : il devient le groupe par défaut des deux cibles. Pour
  l'application, ce défaut est identique à celui d'avant — les éléments déjà écrits
  restent lisibles, aucune migration n'est nécessaire.
- Le code ne pose toujours pas `kSecAttrAccessGroup` : le défaut suffit, et une constante
  en dur devrait porter le préfixe d'équipe, qui varie selon la signature.
- Le repli de `SharedStore` sur le conteneur privé quand le groupe d'applications manque
  est conservé, bien que la variante « équipe personnelle » qui le motivait ait été
  supprimée le 14 septembre 2026, l'adhésion payante rendant le groupe provisionnable.
  Ce repli reste juste : il fait fonctionner l'application seule quand le groupe est
  indisponible pour une raison quelconque. Mais il est **silencieux**, et c'est son
  défaut — l'extension lit alors un conteneur vide et annonce un coffre sans identifiant.
  Les réglages affichent désormais l'état du partage, précisément pour que ce repli cesse
  de se confondre avec un coffre vide.

## Ce que ça ne change pas

Le mot de passe maître reste hors du groupe d'applications, hors des sauvegardes, hors
d'iCloud, et n'est jamais écrit en clair sur le disque. Le jeton de session reste dans le
trousseau en `WhenUnlockedThisDeviceOnly`. Le partage porte sur un élément, pas sur une
politique.

## Pour l'audit de conformité

Ni le RGPD, ni la nLPD, ni ISO 27001 ne prescrivent cette configuration. Le RGPD
(art. 32) et la nLPD (art. 8) demandent des mesures « appropriées » au risque ; ISO 27001
demande que la décision soit issue d'une appréciation du risque et qu'elle soit traçable.
Les deux options peuvent satisfaire ces exigences ; **une décision non écrite, non.** Ce
document est la trace.

Le risque accepté est nommé : un compromis du binaire de l'extension permettrait de
solliciter la lecture biométrique du mot de passe maître. Il est jugé inférieur au risque
écarté : l'affaiblissement systématique du mot de passe maître par la saisie répétée.

## Ce qui reste à vérifier sur matériel

Que le bouton biométrique apparaisse réellement dans l'extension une fois Face ID activé
dans l'application. L'audit qui a révélé le défaut n'a rien exécuté, et cette décision
repose sur la lecture du code et des habilitations. Tant que ce n'est pas constaté sur un
appareil, le partage est une intention, pas un fait.
