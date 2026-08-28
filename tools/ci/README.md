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

> **La portée du jeton décide de tout, et l'erreur est silencieuse.** Les pages
> *Paramètres **utilisateur** > Actions > Exécuteurs* et *Paramètres du **dépôt** >
> Actions > Exécuteurs* se ressemblent et délivrent chacune un jeton. Un runner
> enregistré avec le premier ne recevra jamais de tâche d'un dépôt appartenant à une
> organisation : `register` répond « registered successfully », le daemon annonce son
> étiquette, et le job attend indéfiniment un exécuteur que le dépôt ne voit pas. On l'a
> payé deux fois. L'URL sans ambiguïté :
> `https://git.stackops.ch/stackops/ghostpass/settings/actions/runners`, ou
> `.../org/stackops/settings/actions/runners` pour toute l'organisation.
>
> Pour vérifier plutôt que d'espérer, une fois enregistré :
>
> ```sh
> curl -sS -H "Authorization: token <JETON_API>" \
>   https://git.stackops.ch/api/v1/repos/stackops/ghostpass/actions/runners | jq .
> ```
>
> Une liste vide veut dire que le runner est ailleurs. (L'exécuteur Linux partagé n'y
> figure pas : il est de type *Global*, la page web agrège les portées, l'API non.)

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

**Une tâche à la fois.** `run-ios-tests.sh` prend le port 3111 en dur, pilote un
simulateur nommé et écrit dans `apps/ios/TestResults/` : deux jobs iOS concurrents sur la
même machine se marchent dessus, et le second meurt sur « Le port 3111 est déjà occupé ».
Or un même commit en déclenche deux — celui du `push` et celui de la pull request. Il faut
donc borner le runner, dans `~/.gitea-runner/config.yaml` :

```yaml
runner:
  capacity: 1
```

## En dépannage, sur un poste personnel

**Pas de service qui démarre tout seul.** Un portable se ferme, voyage, change de réseau ;
un runner lancé à la session travaillerait sans qu'on le sache, et resterait injoignable la
moitié du temps. On le lance quand on veut qu'une pull request soit vérifiée, on l'arrête
ensuite :

```sh
cd ~/.gitea-runner && gitea-runner daemon   # au premier plan : on voit les tâches
                                            # arriver, Ctrl-C pour rendre la machine
```

**Le job hérite du `PATH` du daemon, pas de celui du shell interactif.** `rustup`
s'installe dans `~/.cargo/bin` et s'ajoute au `PATH` depuis `~/.zprofile` : un daemon
lancé par `nohup`, `launchd` ou tout ce qui ne charge pas le profil ne verra donc pas
`cargo`, et le job s'arrêtera net sur « cargo introuvable sur ce runner » — après avoir
trouvé `xcodebuild` et `xcodegen`, qui vivent dans `/opt/homebrew/bin`. En arrière-plan,
on le lui donne explicitement :

```sh
cd ~/.gitea-runner && PATH="$HOME/.cargo/bin:$PATH" nohup gitea-runner daemon \
  >> ~/.gitea-runner/logs/daemon.log 2>&1 &
```

**La machine ne porte qu'une suite à la fois.** `run-ios-tests.sh` prend le port 3111 en
dur, crée un simulateur et écrit dans `apps/ios/TestResults/` : deux exécutions
concurrentes se marchent dessus, et celle qui perd la course meurt sur « Le port 3111 est
déjà occupé » — un échec qui ne dit rien du code.

**La contention compte autant que le conflit de port.** Les tests d'interface attendent des
animations, des transitions de clavier, des apparitions de cellules : ils échouent sur des
délais dépassés dès que la machine est saturée. Un `xcodebuild build`, un `wasm-pack`, un
`cargo test` lancés pendant qu'un job tourne suffisent — les tests tombent alors sur « champ
hors d'atteinte » ou « serveur injoignable », deux messages qui accusent le code d'une
famine de processeur. Vérifier qu'aucune suite ne tourne avant de *lancer une suite* ne
suffit donc pas : il faut le vérifier avant toute opération lourde.

**Et ne jamais tuer par motif ce qui décrit aussi les processus du runner.** Le harnais
lance son backend par `npm start`, c'est-à-dire `tsx src/index.ts`. Un `pkill -f "tsx
src/index.ts"` destiné à son propre serveur de test emporte donc aussi celui du job en
cours — les tests suivants échouent alors sur « le coffre ne s'est pas ouvert — serveur
injoignable », un message qui accuse le code d'un dégât causé par le ménage. Payé une
fois : viser le PID retenu au démarrage, ou le port, jamais une chaîne que le runner
partage.

Le runner ne prévient pas avant de démarrer un job, et rien ne verrouille la machine entre
lui et un lancement à la main. Vérifier que le poste est libre avant de lancer ne suffit
donc pas : c'est une course, et un job CI peut arriver dans l'intervalle. En pratique, on
attend le verdict d'un push avant de relancer une suite locale, plutôt que de courir à
côté du runner.

**Pour voir ce qu'un job a fait**, activer la conservation des logs dans
`~/.gitea-runner/config.yaml` — le journal du daemon ne contient que « tâche reçue », et
sans ça un échec ne laisse qu'un silence de deux minutes :

```yaml
log:
  job:
    dir: "/Users/<toi>/.gitea-runner/logs/jobs"
```

Et l'interrupteur suit le même rythme — mais il ne sert qu'à *couper*. `MACOS_RUNNER` à
`false` écarte le job iOS ; dans tous les autres cas, y compris si la variable n'existe
pas, il tourne. On le passe donc à `false` quand le portable reste fermé un moment, pour
qu'une pull request n'attende pas un runner qui ne viendra pas : Gitea n'échoue pas, il
attend, et la pull request resterait sans verdict.

Le sens a été inversé après coup, et la raison mérite d'être dite. L'interrupteur exigeait
d'abord `MACOS_RUNNER == 'true'`. Une variable qui ne se résout pas rend alors une chaîne
vide, le job disparaît du rapport sans un mot, et on croit avoir une CI iOS pendant des
heures sans en avoir. Une file d'attente se remarque ; une absence, non.

**La portée compte, et c'est exactement ce qui nous est arrivé.** Une variable posée dans
*Paramètres utilisateur > Actions > Variables* ne s'applique qu'aux dépôts de cet
utilisateur. `ghostpass` appartient à l'organisation `stackops` : il faut la poser sur le
dépôt (**Paramètres du dépôt > Actions > Variables**) ou sur l'organisation. Le job
`Tests iOS — activés ?` affiche à chaque exécution la valeur qu'il voit, précisément pour
qu'on n'ait plus à le deviner.

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

`MACOS_RUNNER` n'a alors plus lieu d'exister : sans elle, le job tourne.

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
