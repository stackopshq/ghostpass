# Brancher un runner macOS sur GitLab

Les tests iOS réclament Xcode et un simulateur : ils ne tournent que sur macOS, et les
runners partagés de GitLab sont sous Linux. Le job `ios` de `.gitlab-ci.yml` attend donc
un runner étiqueté `macos`.

## L'interrupteur : `MACOS_RUNNER`

Le job `ios` n'est créé que si la variable CI/CD `MACOS_RUNNER` vaut `true`
(**Settings > CI/CD > Variables**, sur le projet ou sur le groupe ghostsuite).

C'est l'inverse de ce que faisait la CI Gitea, et la raison mérite d'être dite. Sur
Gitea, un job sans runner restait en file : la pull request attendait, mais l'absence de
runner se voyait. Sur GitLab, un job `tags: [macos]` sans runner reste `pending`
indéfiniment et bloque le pipeline entier. On ne le crée donc que lorsqu'un runner existe.

Pour que l'absence ne passe pas inaperçue, le job `ios-gate` tourne à chaque pipeline,
sur Linux, et affiche ce que l'interrupteur a décidé. Tant que `MACOS_RUNNER` n'est pas à
`true`, **les tests se lancent à la main avant toute MR touchant à l'application** :

```sh
./tools/ios/run-ios-tests.sh
```

## Prérequis

Xcode (avec un runtime de simulateur iOS), `xcodegen`, `rustup`, Node, `npm` et `git`. Le
job les vérifie au démarrage et s'arrête net, avec un message clair, s'il en manque un.

```sh
brew install gitlab-runner xcodegen
xcodebuild -downloadPlatform iOS   # si aucun runtime de simulateur n'est installé
```

## Enregistrer le runner

Créer le runner dans GitLab, au niveau du **groupe ghostsuite** pour le partager entre
les produits de la suite : **Build > Runners > New group runner**, étiquette `macos`,
case « Run untagged jobs » **décochée** (le Mac ne doit recevoir que les jobs iOS). GitLab
donne alors un jeton d'authentification `glrt-…`.

```sh
gitlab-runner register --non-interactive \
  --url https://gitlab.com \
  --token glrt-… \
  --executor shell \
  --description "$(scutil --get ComputerName)"
```

L'exécuteur `shell` fait tourner les jobs **directement sur la machine** : macOS n'a pas
de conteneurs, et le job a besoin de l'Xcode du poste, pas d'une image.

**Une tâche à la fois.** `run-ios-tests.sh` prend le port 3111 en dur, pilote un
simulateur nommé et écrit dans `apps/ios/TestResults/` : deux jobs iOS concurrents sur la
même machine se marchent dessus, et le second meurt sur « Le port 3111 est déjà occupé ».
Le job porte un `resource_group` qui les met en file, mais le runner doit aussi être
borné, dans `~/.gitlab-runner/config.toml` :

```toml
concurrent = 1
```

Puis `MACOS_RUNNER = true` dans les variables CI/CD, et vérifier que le runner apparaît
en ligne dans **Build > Runners**.

## Ce que l'expérience a appris

**Le job hérite du `PATH` du service, pas de celui du shell interactif.** `rustup`
s'installe dans `~/.cargo/bin` et s'ajoute au `PATH` depuis `~/.zprofile` : un service
lancé par `launchd` ne charge pas le profil et ne verra donc pas `cargo`. Le job
s'arrêtera net sur « cargo introuvable sur ce runner », après avoir trouvé `xcodebuild`
et `xcodegen`, qui vivent dans `/opt/homebrew/bin`. Le donner explicitement dans
`config.toml`, section du runner :

```toml
environment = ["PATH=/Users/<toi>/.cargo/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"]
```

**La contention compte autant que le conflit de port.** Les tests d'interface attendent des
animations, des transitions de clavier, des apparitions de cellules : ils échouent sur des
délais dépassés dès que la machine est saturée. Un `xcodebuild build`, un `wasm-pack`, un
`cargo test` lancés pendant qu'un job tourne suffisent : les tests tombent alors sur
« champ hors d'atteinte » ou « serveur injoignable », deux messages qui accusent le code
d'une famine de processeur.

**Ne jamais tuer par motif ce qui décrit aussi les processus du runner.** Le harnais lance
son backend par `npm start`, c'est-à-dire `tsx src/index.ts`. Un `pkill -f "tsx
src/index.ts"` destiné à son propre serveur de test emporte donc aussi celui du job en
cours. Viser le PID retenu au démarrage, ou le port, jamais une chaîne que le runner
partage.

**Pousser, c'est programmer un travail sur cette machine.** Le 28 août 2026, un job a
échoué sur « Le port 3111 est déjà occupé » : la suite avait été lancée à la main quatre
minutes avant que la CI, déclenchée par le push qui venait de partir, ne lance la même
suite sur le même port. Pousser *ou* lancer la suite localement, pas les deux à quelques
minutes d'intervalle.

**Un runner exécute le code des MR sur la machine qui l'héberge.** Sur un projet privé
entre gens de confiance, c'est le fonctionnement normal. Sur un poste personnel, c'est une
raison de plus de ne l'allumer que le temps utile.

## Poste prêté ou machine dédiée

Sur un **poste personnel prêté en dépannage**, pas de service qui démarre tout seul : un
portable se ferme, voyage, change de réseau. On lance le runner au premier plan quand on
veut qu'une MR soit vérifiée, et on remet `MACOS_RUNNER` à autre chose que `true` quand le
portable reste fermé un moment, sans quoi les pipelines attendront un runner qui ne vient
pas :

```sh
gitlab-runner run   # au premier plan : on voit les tâches arriver, Ctrl-C pour rendre la machine
```

Sur une **machine dédiée**, l'inverse : elle est faite pour attendre du travail.

```sh
brew services start gitlab-runner   # démarre à la session et se relance tout seul
```

La CI n'a rien à changer au passage de l'un à l'autre : les deux machines portent la même
étiquette `macos`. Enregistrer la nouvelle, vérifier qu'elle apparaît en ligne, puis
retirer l'ancienne.

## Retirer un runner

```sh
brew services stop gitlab-runner 2>/dev/null || true
gitlab-runner unregister --all-runners
```

Puis le supprimer dans **Build > Runners** : tant qu'il y figure, GitLab peut lui confier
des tâches.
