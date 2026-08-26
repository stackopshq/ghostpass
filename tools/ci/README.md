# Brancher un runner macOS sur la forge

Les tests iOS réclament Xcode et un simulateur : ils ne tournent que sur macOS, et la
forge n'héberge que des runners Linux. Le job `ios` de `.gitea/workflows/ci.yml` attend
donc un runner étiqueté `macos`, à brancher une fois.

## Ce que cela engage

Un runner self-hosted **exécute le code des pull requests sur la machine qui l'héberge**.
Sur un dépôt privé entre gens de confiance, c'est le fonctionnement normal ; sur un dépôt
ouvert aux contributions extérieures, ce serait une porte grande ouverte. À garder en tête
si le dépôt change de statut.

La machine doit aussi être allumée et connectée quand une pull request arrive. Sinon le
job reste en file d'attente : Gitea n'échoue pas, il attend, et la pull request n'a pas de
verdict. D'où l'interrupteur décrit plus bas.

## Prérequis de la machine

Xcode (avec un runtime de simulateur iOS), `xcodegen`, `rustup`, Node et `npm`. Le job les
vérifie au démarrage et s'arrête net avec un message clair s'il en manque un.

```sh
brew install gitea-runner xcodegen
xcodebuild -downloadPlatform iOS   # si aucun runtime de simulateur n'est installé
```

## Enregistrement

Le jeton s'obtient dans la forge : **Settings > Actions > Runners > Create new runner**
(au niveau du dépôt, ou de l'organisation pour le partager entre projets).

```sh
gitea-runner register --no-interactive \
  --instance https://git.stackops.ch \
  --token <JETON> \
  --name "$(scutil --get ComputerName)" \
  --labels 'macos:host'
```

`macos:host` — le suffixe compte. Il demande d'exécuter les tâches **directement sur la
machine**, et non dans un conteneur : macOS n'en a pas, et le job a besoin de l'Xcode du
poste, pas d'une image.

## Exécution

```sh
brew services start gitea-runner   # au démarrage de session, en arrière-plan
# ou, ponctuellement :
gitea-runner daemon
```

## L'interrupteur

Le job est conditionné à la variable de dépôt `MACOS_RUNNER`
(**Settings > Actions > Variables**) :

- `true` — le job tourne à chaque pull request ;
- absente ou toute autre valeur — le job est ignoré, et les tests iOS se lancent à la main
  avec `./tools/ios/run-ios-tests.sh`.

C'est ce qu'il faut basculer quand la machine part en vacances, plutôt que de laisser les
pull requests attendre un runner qui ne répondra pas.

## Vérifier que le runner répond

Il apparaît dans **Settings > Actions > Runners**, en ligne, avec son étiquette. En cas de
doute, `gitea-runner daemon` au premier plan montre les tâches qu'il reçoit.
