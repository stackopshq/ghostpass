# Brancher un runner macOS sur la forge

Les tests iOS réclament Xcode et un simulateur : ils ne tournent que sur macOS, et la
forge n'héberge que des runners Linux. Le job `ios` de `.gitea/workflows/ci.yml` attend
donc un runner étiqueté `macos`.

Deux situations, et elles ne se configurent pas pareil : un **poste personnel qu'on prête
en dépannage**, et une **machine dédiée** qui prendra le relais.

## Prérequis, dans les deux cas

Xcode (avec un runtime de simulateur iOS), `xcodegen`, `rustup`, Node et `npm`. Le job les
vérifie au démarrage et s'arrête net, avec un message clair, s'il en manque un.

```sh
brew install gitea-runner xcodegen
xcodebuild -downloadPlatform iOS   # si aucun runtime de simulateur n'est installé
```

Le jeton d'enregistrement s'obtient dans la forge : **Settings > Actions > Runners >
Create new runner**, au niveau du dépôt ou de l'organisation pour le partager entre les
projets de la suite.

`register` écrit un fichier `.runner` — son identité auprès de la forge — **dans le
répertoire courant**, et `daemon` le cherche au même endroit. D'où un dossier à soi,
plutôt qu'un fichier égaré dans le dépôt ou au fond du dossier personnel :

```sh
mkdir -p ~/.gitea-runner && cd ~/.gitea-runner
gitea-runner register --no-interactive \
  --instance https://git.stackops.ch \
  --token <JETON> \
  --name "$(scutil --get ComputerName)" \
  --labels 'macos:host'
```

`macos:host` — le suffixe compte. Il fait exécuter les tâches **directement sur la
machine** plutôt que dans un conteneur : macOS n'en a pas, et le job a besoin de l'Xcode
du poste, pas d'une image.

## En dépannage, sur un poste personnel

**Pas de service qui démarre tout seul.** Un portable se ferme, voyage, change de réseau ;
un runner lancé à la session travaillerait sans qu'on le sache, et resterait injoignable la
moitié du temps. On le lance quand on veut qu'une pull request soit vérifiée, on l'arrête
ensuite :

```sh
cd ~/.gitea-runner && gitea-runner daemon   # au premier plan : on voit les tâches
                                            # arriver, Ctrl-C pour rendre la machine
```

Et l'interrupteur suit le même rythme. `MACOS_RUNNER` (**Settings > Actions > Variables**)
reste à `false` par défaut ; on le passe à `true` le temps de faire tourner la vérification.
Sinon, chaque pull request ouverte pendant que le portable est fermé attend un runner qui
ne viendra pas : Gitea n'échoue pas, il attend, et la pull request reste sans verdict.

Un point à ne pas perdre de vue : un runner self-hosted **exécute le code des pull requests
sur la machine qui l'héberge**. Sur un dépôt privé entre gens de confiance, c'est le
fonctionnement normal. Sur un poste personnel, cela reste une raison de plus de ne
l'allumer que le temps utile — et de ne pas ouvrir le dépôt aux contributions extérieures
tant qu'il est branché.

## Sur la machine dédiée

Une fois le Mac mini en place, c'est l'inverse : il est fait pour attendre du travail.

```sh
brew services start gitea-runner   # démarre à la session et se relance tout seul
```

`MACOS_RUNNER` peut alors rester à `true` en permanence.

Le workflow n'a **rien à changer** au passage de l'un à l'autre : les deux machines
portent la même étiquette `macos`, seul le nom diffère. Il suffit d'enregistrer le mini,
de vérifier qu'il apparaît en ligne, puis de retirer le portable.

## Retirer un runner

À faire quand le portable rend son tablier, pour ne pas laisser un runner fantôme que la
forge croira joignable :

```sh
brew services stop gitea-runner 2>/dev/null || true
gitea-runner --config /opt/homebrew/etc/gitea-runner/config.yaml daemon --once 2>/dev/null || true
rm -rf ~/.gitea-runner             # son identité auprès de la forge
```

Puis le supprimer côté forge : **Settings > Actions > Runners**, bouton de suppression en
face de son nom. Tant qu'il y figure, Gitea peut lui confier des tâches.

## Vérifier qu'il répond

Il apparaît dans **Settings > Actions > Runners**, en ligne, avec son étiquette. En cas de
doute, `gitea-runner daemon` au premier plan montre les tâches qu'il reçoit.
