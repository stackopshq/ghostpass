# 0002 — Le coffre lisible par le service de remplissage, sur Android

*Décidé le 2026-08-31. Statut : accepté.*

Pendant du [`0001`](0001-le-trousseau-partage-avec-l-extension.md) pour Android, et **pas
sa transposition** : le problème n'a pas la même forme, et le voir comme identique aurait
fait construire un mécanisme dont la plateforme n'a pas besoin.

## Ce qui se décide ici

Le service de remplissage automatique peut-il ouvrir le coffre sans que l'utilisateur
retape son mot de passe maître à chaque champ rempli ?

## Ce qui diffère d'iOS, et qu'il fallait mesurer

Sur iOS, l'extension de remplissage est un **processus distinct avec son propre
conteneur** : elle ne voit ni le trousseau de l'application ni ses fichiers sans un groupe
d'applications et un partage de trousseau explicites. C'est cette séparation qui fait de
`0001` une décision de sécurité.

Sur Android, `AndroidManifest.xml` ne déclare aucun `android:process` pour le service :
**il tourne dans le processus de l'application**, dans le même bac à sable, avec le même
`filesDir` et les mêmes alias de KeyStore. Il n'y a rien à partager, parce que rien n'est
séparé.

Ce qui reste vrai en revanche : le système peut lier ce service **alors que l'interface
n'a jamais été ouverte**. La clé déverrouillée n'est alors dans aucune mémoire, et le
service n'a rien à déchiffrer.

La question n'est donc pas « comment partager », comme sur iOS, mais **« que persiste-t-on
pour qu'un déverrouillage sans interface soit possible »**.

## La décision

**On persiste la clé du coffre, enveloppée par une clé de l'`AndroidKeyStore` liée à
l'authentification de l'utilisateur.**

Le même raisonnement que `0001` s'applique, et il est le motif principal : un mot de passe
maître retapé dix fois par jour est un mot de passe maître qu'on raccourcit. Le mécanisme
qui protège devient alors ce qui affaiblit.

Trois exigences, et aucune n'est décorative :

- **`setUserAuthenticationRequired(true)`**, avec **`AUTH_BIOMETRIC_STRONG` seul** — la clé
  ne sort qu'après biométrie forte.

  *Corrigé le 2026-08-31, après mesure.* Cette ligne disait « biométrie **ou code de
  l'appareil** », et c'était une erreur de ma part : ajouter `AUTH_DEVICE_CREDENTIAL`
  **désarme le réglage suivant**, celui que cet ADR juge le plus important. Un code
  d'appareil n'est pas invalidé par l'enrôlement d'une empreinte ; qui le connaît ouvrirait
  le coffre quoi qu'il arrive côté biométrie.

  Conséquence assumée : sur un appareil sans biométrie enrôlée, le raccourci n'existe pas
  et le mot de passe maître reste le seul chemin. C'est le bon repli — vers plus fort, pas
  vers plus faible ;
- **`setInvalidatedByBiometricEnrollment(true)`** — l'équivalent exact de
  `.biometryCurrentSet` sur iOS. Sans lui, quelqu'un qui ajoute son empreinte au téléphone
  déverrouillé de sa victime obtient le coffre. Le défaut d'Android est `false` : l'oubli
  ne produit aucune erreur, et laisse une porte ouverte ;
- **`setUnlockedDeviceRequired(true)`** — rien ne se déchiffre écran verrouillé.

Le matériel enveloppé vit dans `filesDir`, qui est privé à l'application. **Pas de sauvegarde
automatique** : `android:allowBackup="false"`, sans quoi le coffre partirait chez un
sauvegardeur qui n'est pas le nôtre.

## Ce que cela ne change pas

**Rien ne se remplit sans interaction.** Le service propose, l'utilisateur choisit. C'est
la règle d'iOS et elle vaut ici : un remplissage automatique qui s'exécute seul rendrait
une application malveillante capable de moissonner un coffre en affichant des formulaires.

**Le mot de passe maître reste requis au premier déverrouillage** après installation, après
redémarrage, et après toute invalidation de la clé. La biométrie raccourcit les
déverrouillages suivants ; elle ne remplace jamais le premier.

## Ce qui a été écarté

**Demander le mot de passe maître à chaque remplissage.** C'est ce que fait la version
actuelle, faute de décision. Mesuré sur iOS avant `0001` : la fonction principale du
produit devient assez pénible pour qu'on cesse de s'en servir, ce qui est la pire issue —
l'utilisateur retourne aux mots de passe qu'il retient.

**Garder la clé en mémoire du processus seulement.** Séduisant, et faux : le système tue le
processus entre deux usages, et le service se retrouve lié sans rien avoir. La fonction
marcherait par intermittence, ce qui est plus déroutant qu'une fonction absente.

## Le témoin, et pourquoi le témoin évident ne vaut rien

Un test doit vérifier que la clé est bien **invalidée par l'enrôlement d'une nouvelle
empreinte**. C'est le seul des trois réglages dont l'oubli ne se voit jamais à l'usage :
tout continue de fonctionner, simplement pour quelqu'un de plus.

*Mesuré le 2026-08-31, puis **corrigé le même jour**.* On avait d'abord conclu que lire
`KeyInfo` ne mesurait rien — la clé fabriquée sans le réglage rapportant `true` elle aussi.

**C'était faux, et la façon dont on l'a su vaut d'être gardée.** Cette observation avait
été figée dans un test plutôt que seulement écrite ; le test **est tombé** au premier
démarrage à froid de l'émulateur. La première mesure venait d'une machine reprise d'un
instantané, où le magasin de clés ne distinguait pas les deux consignes. Le magasin d'un
appareil neuf, lui, les distingue.

Figer une observation dans un test est donc ce qui a évité une documentation durablement
fausse : une note en prose serait restée vraie pour toujours. Le test est devenu un vrai
témoin.

Le témoin qui vaut est `tools/android/temoin-de-l-invalidation.sh` : il **enrôle réellement
une empreinte de plus** sur l'appareil et regarde si la clé sert encore. Trois pièges y ont
été trouvés, tous silencieux — `connectedAndroidTest` désinstalle l'application et efface
les clés entre les deux temps ; l'intention d'enrôlement ouvre la *liste* au lieu de
l'assistant quand une empreinte existe déjà, si bien que rien n'était enrôlé ; et une boîte
de renommage faisait compter la même empreinte deux fois.

Reste le témoin qui va plus loin que `KeyInfo` : `tools/android/temoin-de-l-invalidation.sh`
**enrôle réellement une empreinte de plus** sur l'appareil et regarde si la clé sert encore.
Trois pièges y ont été trouvés, tous silencieux — `connectedAndroidTest` désinstalle
l'application et efface les clés entre les deux temps ; l'intention d'enrôlement ouvre la
*liste* au lieu de l'assistant quand une empreinte existe déjà ; et une boîte de renommage
faisait compter la même empreinte deux fois.

`setUnlockedDeviceRequired`, lui, n'est rendu par `KeyInfo` à aucun niveau d'API jusqu'à
36 : son témoin est donc plus faible que les deux autres, et le fichier le dit.
