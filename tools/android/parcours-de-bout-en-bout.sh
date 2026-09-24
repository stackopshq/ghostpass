#!/usr/bin/env bash
# **Le troisième point du §7, rejoué par une machine.**
#
# `verifier-l-autonomie.sh` sait dire que l'APK ne vend rien et ne nomme aucun serveur de
# l'éditeur. Il écrit lui-même ce qu'il ne prouve pas : qu'un **premier lancement aboutit à
# un coffre utilisable contre une instance quelconque**. C'est le point sur lequel un
# relecteur juge, et le seul des trois qu'aucun scan de chaînes n'atteint.
#
#   tools/android/parcours-de-bout-en-bout.sh
#
# Ce script sème une instance locale, réinitialise l'application, et lui fait vivre le
# parcours entier : connexion, lecture du coffre, création, modification, verrouillage,
# redéverrouillage, remplissage d'un formulaire tiers. Les assertions sont dans
# `ParcoursDeBoutEnBoutTest`, qui pilote l'interface par UiAutomator.
#
# ─── Ce qui fait la force du parcours : la résolution de noms est coupée ───
#
# Pendant toute l'exécution, l'appareil est mis en **DNS privé strict vers un hôte
# inexistant** : plus aucun nom ne se résout. L'adresse du serveur est une IP littérale
# (`10.0.2.2`), donc le parcours doit continuer de marcher — mais tout ce qui dépendrait
# d'un nom de domaine, à commencer par celui de l'éditeur, échouerait.
#
# Vérifié en l'écrivant : `ping example.com` rend « unknown host », et une connexion TCP
# vers `10.0.2.2` passe toujours. C'est la meilleure preuve à notre portée que le premier
# lancement ne s'appuie sur aucun hôte extérieur, et elle vaut mieux qu'un `grep`.
#
# ─── Ce qu'il ne couvre pas ───
#
# La biométrie. Un test ne pose pas de doigt sur un capteur ; le raccourci a son propre
# témoin (`temoin-de-l-invalidation.sh`). Le chemin éprouvé ici est celui qui doit marcher
# **avant** toute biométrie, c'est-à-dire celui du premier lancement.
#
# ─── Et il doit savoir tomber ───
#
# `tools/android/temoin-du-parcours.sh` le perturbe et exige qu'il rougisse. Un parcours
# qui n'a jamais été rouge n'a rien prouvé.
set -euo pipefail

PRODUIT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
GRADLE="$PRODUIT/apps/android"
SERVEUR="$PRODUIT/apps/server"
SDK="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
ADB="$SDK/platform-tools/adb"
: "${JAVA_HOME:=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home}"
export JAVA_HOME

PAQUET="ch.stackops.ghostpass"
RUNNER="$PAQUET.test/androidx.test.runner.AndroidJUnitRunner"
EMAIL="${EMAIL_DESSAI:-clara@ghostpass.test}"
# Le mot de passe maître du compte semé. `temoin-du-parcours.sh` en impose un autre à
# l'application pour vérifier que le parcours sait tomber.
MOTDEPASSE="${MOTDEPASSE_DESSAI:-correct horse battery staple}"
# Ce que l'application recevra. Normalement identique à MOTDEPASSE ; le témoin les dissocie.
MOTDEPASSE_SAISI="${MOTDEPASSE_SAISI:-$MOTDEPASSE}"

[[ -x "$ADB" ]] || { echo "adb introuvable ($ADB). Réglez ANDROID_HOME." >&2; exit 1; }
"$ADB" shell true >/dev/null 2>&1 || {
  echo "Aucun appareil. Démarrez un émulateur :" >&2
  echo "  \$ANDROID_HOME/emulator/emulator -avd <nom> -no-window &" >&2
  exit 1
}

# Un port libre, pour ne pas se battre avec une instance déjà lancée.
PORT="$(python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1]);s.close()')"
BASE="$(mktemp -d)"
DB="$BASE/coffre.db"
JOURNAL="$BASE/serveur.log"
# **`10.0.2.2` est l'hôte vu de l'émulateur, et c'est une IP littérale** — c'est ce qui
# permet au parcours de traverser la coupure de résolution de noms.
ADRESSE="http://10.0.2.2:$PORT"

# Le service de remplissage d'origine, pour le remettre en partant : laisser l'appareil
# réglé sur GhostPass après un test le ferait passer pour le choix de l'utilisateur.
REMPLISSAGE_INITIAL="$("$ADB" shell settings get secure autofill_service | tr -d '\r')"
DNS_INITIAL="$("$ADB" shell settings get global private_dns_mode | tr -d '\r')"

# ─── L'écran, et pourquoi on l'agrandit ───
#
# Mesuré, et **invisible sur une capture d'écran** : l'AVD par défaut fait 320×640 points.
# Le formulaire de connexion complet y pousse « Se connecter » entre y=593 et y=640, or les
# quarante-huit derniers points appartiennent à la navigation par gestes du système, qui
# intercepte le toucher. Le bouton est parfaitement visible, parfaitement inerte, et le
# parcours échouait à l'étape suivante avec « le coffre n'affiche pas Forgejo » — un message
# qui accuse la connexion là où c'est le doigt qui n'arrivait pas.
#
# On agrandit donc l'écran logique le temps du parcours. La densité ne change pas : les
# tailles en points restent celles du produit, c'est la place qui augmente.
TAILLE_INITIALE="$("$ADB" shell wm size | sed -n 's/^Override size: //p' | tr -d '\r')"

ranger() {
  local code=$?
  [[ -n "${SERVEUR_PID:-}" ]] && kill "$SERVEUR_PID" 2>/dev/null || true
  # La langue imposée à l'application est rendue au système : la laisser en français
  # ferait passer un réglage de test pour le choix de l'utilisateur, exactement comme le
  # service de remplissage ci-dessous.
  "$ADB" shell cmd locale set-app-locales "$PAQUET" --locales "" >/dev/null 2>&1 || true
  if [[ -n "$TAILLE_INITIALE" ]]; then
    "$ADB" shell wm size "$TAILLE_INITIALE" >/dev/null 2>&1 || true
  else
    "$ADB" shell wm size reset >/dev/null 2>&1 || true
  fi
  "$ADB" shell settings put global private_dns_mode \
    "${DNS_INITIAL:-opportunistic}" >/dev/null 2>&1 || true
  if [[ "$REMPLISSAGE_INITIAL" == "null" || -z "$REMPLISSAGE_INITIAL" ]]; then
    "$ADB" shell settings delete secure autofill_service >/dev/null 2>&1 || true
  else
    "$ADB" shell settings put secure autofill_service \
      "$REMPLISSAGE_INITIAL" >/dev/null 2>&1 || true
  fi
  # Le journal du serveur est ce qu'on lit quand le parcours tombe : on le garde.
  if [[ $code -ne 0 && -f "$JOURNAL" ]]; then
    echo >&2
    echo "Journal du serveur (dernières lignes) : $JOURNAL" >&2
    tail -6 "$JOURNAL" >&2 || true
  else
    rm -rf "$BASE"
  fi
  exit $code
}
trap ranger EXIT

# ─── Ce que ce démarrage ne fournit pas, et ce que l'étape 6 y perd ───
#
# **Constaté le 2026-09-24, et non réparé ici.** Le serveur démarre sans `GHOSTBIT_URL`.
# Depuis que le partage délègue au relais (`feat(send): sharing a secret now delegates to
# ghostbit`, 2026-08-29), `POST /api/send` répond alors **503 « partage indisponible :
# GHOSTBIT_URL non configurée »**, et l'étape 6 tombe sur « aucun lien de partage n'est
# apparu ».
#
# Ce n'est pas un défaut du client, et le message le dit — mais il le dit **dans le
# formulaire**, au-dessus de la zone visible, si bien que le parcours ne le rapporte pas et
# accuse le partage. Le commentaire de `ParcoursDeBoutEnBoutTest.partager` décrit d'ailleurs
# encore le serveur d'avant ce changement : « le serveur de cette branche ne rend qu'un
# identifiant ». Le parcours n'a plus traversé cette étape depuis.
#
# Le réparer demande un relais, et donc une décision qui n'est pas de l'outillage : quel
# hôte doit-il annoncer ? Le même que le serveur, et la confirmation de destination du §4 ne
# se déclenche jamais ; un autre, et l'étape 6 doit la traverser — ce que
# `tools/android/temoin-de-la-destination.sh` fait déjà, avec
# `tools/android/partage-banc-ghostbit.ts`. C'est au propriétaire du §4 de trancher.

echo "== 1. Une instance locale, à nous =="
[[ -d "$SERVEUR/node_modules" ]] || { echo "  ✗ apps/server : npm install d'abord." >&2; exit 1; }
( cd "$SERVEUR" && PORT="$PORT" DB_PATH="$DB" LOG_LEVEL=info npm start >"$JOURNAL" 2>&1 ) &
SERVEUR_PID=$!
for _ in $(seq 1 40); do
  if curl -s -o /dev/null "http://127.0.0.1:$PORT/api/auth/prelogin" -X POST \
      -H 'Content-Type: application/json' -d '{"email":"x@y.z"}' 2>/dev/null; then break; fi
  sleep 1
done
curl -s -o /dev/null -X POST "http://127.0.0.1:$PORT/api/auth/prelogin" \
  -H 'Content-Type: application/json' -d '{"email":"x@y.z"}' \
  || { echo "  ✗ le serveur local n'a pas démarré." >&2; exit 1; }
echo "  · $ADRESSE (base de données jetable)"

echo
echo "== 2. Semer le compte et les éléments =="
# Le semeur passe par le **même cœur** que l'application. Si ce qu'il scelle s'ouvre
# là-bas, c'est que les deux parlent le même protocole.
( cd "$GRADLE" && ./gradlew :coeur-hote:semerLeServeur --console=plain -q \
    -Pserveur="http://127.0.0.1:$PORT" -Pemail="$EMAIL" -Pmotdepasse="$MOTDEPASSE" ) \
  | sed 's/^/  /'

echo
echo "== 3. Installer, et repartir d'un appareil vierge =="
( cd "$GRADLE" && ./gradlew :app:assembleDebug :app:assembleDebugAndroidTest \
    --console=plain -q ) >/dev/null
"$ADB" install -r -t "$GRADLE/app/build/outputs/apk/debug/app-debug.apk" >/dev/null
"$ADB" install -r -t \
  "$GRADLE/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk" >/dev/null
# **`pm clear` est ce qui fait de ce parcours un *premier* lancement.** Sans lui, une
# session laissée par une exécution précédente sauterait l'écran d'entrée, et le parcours
# mesurerait un second lancement en croyant mesurer le premier.
# L'écran **avant** la réinitialisation : un changement de taille est un changement de
# configuration, qui recrée les activités. Le faire pendant le parcours reviendrait à
# relancer l'écran sous les doigts du test.
"$ADB" shell wm size 540x1200 >/dev/null
sleep 3
"$ADB" shell pm clear "$PAQUET" >/dev/null
# `SANS_REMPLISSAGE` n'existe que pour `temoin-du-parcours.sh`, qui vérifie que la dernière
# étape tombe quand GhostPass n'est pas le service de remplissage de l'appareil. Sans cette
# porte, on ne saurait pas si cette étape mesure quelque chose.
if [[ -n "${SANS_REMPLISSAGE:-}" ]]; then
  "$ADB" shell settings delete secure autofill_service >/dev/null 2>&1 || true
else
  "$ADB" shell settings put secure autofill_service "$PAQUET/.autofill.ServiceDeRemplissage"
fi
"$ADB" shell input keyevent KEYCODE_WAKEUP >/dev/null 2>&1 || true

# ─── La langue de l'application, imposée — et pourquoi il a fallu la nommer ───
#
# Les assertions de `ParcoursDeBoutEnBoutTest` cherchent du **texte à l'écran** :
# « Élément illisible », « Enregistrer », « Verrouiller ». Tant que l'application n'existait
# qu'en français, la langue de l'appareil n'avait aucune importance et personne n'y pensait.
# Depuis qu'elle a un `values-en/`, elle suit l'appareil — et un émulateur par défaut est en
# anglais. Le parcours est alors tombé à l'étape 2 sur « l'élément scellé par un autre compte
# a disparu de la liste », c'est-à-dire en accusant la règle §5 là où c'était la langue.
#
# `cmd locale set-app-locales` est l'interface système du réglage *par application*
# qu'Android 13 a ajouté — celui-là même qu'alimente `AppCompatDelegate.setApplicationLocales`
# et que déclare `android:localeConfig`. L'imposer ici ne touche pas la langue de l'appareil,
# et `ranger` la rend en partant.
"$ADB" shell cmd locale set-app-locales "$PAQUET" --locales fr-FR >/dev/null 2>&1 || true
LANGUE_APP="$("$ADB" shell cmd locale get-app-locales "$PAQUET" 2>/dev/null | tr -d '\r')"
if [[ "$LANGUE_APP" != *"fr"* ]]; then
  # **Trois états, jamais deux.** Sur un appareil trop ancien pour le réglage par
  # application, on ne peut pas imposer la langue ; le parcours n'échouerait alors que si
  # l'appareil n'est pas en français, avec un message qui accuserait le produit. On s'arrête
  # en nommant la cause plutôt que de laisser courir un rouge trompeur.
  LANGUE_APPAREIL="$("$ADB" shell getprop persist.sys.locale 2>/dev/null | tr -d '\r')"
  if [[ "$LANGUE_APPAREIL" != fr* ]]; then
    echo "  ✗ impossible d'imposer le français à l'application (réglage par application" >&2
    echo "    indisponible : Android 13 requis), et l'appareil est en « ${LANGUE_APPAREIL:-inconnu} »." >&2
    echo "    Les assertions du parcours cherchent du texte français : elles seraient rouges" >&2
    echo "    pour une raison qui n'est pas le produit. Mettez l'émulateur en français." >&2
    exit 1
  fi
  echo "  · réglage par application indisponible — l'appareil est déjà en français"
fi

echo "  · application réinitialisée, remplissage réglé sur GhostPass, écran à 540x1200, langue fr"

echo
echo "== 4. Couper la résolution de noms =="
# **L'ordre compte, et il a coûté deux exécutions.** Poser le mode puis le spécificateur
# laisse `netd` sur sa configuration précédente : la résolution continuait de marcher, et le
# script refusait d'avancer — ce qui était le bon comportement, mais pour la mauvaise raison.
# Passer d'abord par `off` force la reconfiguration, et l'effet est alors immédiat.
"$ADB" shell settings put global private_dns_mode off
sleep 2
"$ADB" shell settings put global private_dns_specifier resolveur.invalide.invalid
"$ADB" shell settings put global private_dns_mode hostname
# Le réglage n'est pas instantané : `netd` reconfigure ses résolveurs de façon asynchrone.
# On **attend l'effet**, on ne dort pas une durée devinée — une temporisation fixe rend un
# témoin qui passe ou tombe selon la charge de la machine, ce qui est pire que pas de témoin.
# `|| true` autour de la capture, et ce n'est pas de la paresse : **`set -o pipefail` rendait
# ce contrôle aveugle**. `ping` sort en erreur *quand la coupure fonctionne* — c'est le cas
# qu'on cherche — et sous `pipefail` le pipeline `ping | grep -q` rapporte l'échec de `ping`
# plutôt que la correspondance de `grep`. La condition était donc fausse exactement dans le
# cas où elle devait être vraie, et le script refusait d'avancer sur un appareil
# parfaitement configuré. Deux exécutions perdues à chercher côté Android.
coupee=0
for _ in $(seq 1 20); do
  sortie="$("$ADB" shell "ping -c1 -W2 example.com 2>&1" || true)"
  case "$sortie" in
    *"unknown host"*|*"Temporary failure in name resolution"*) coupee=1; break ;;
  esac
  sleep 2
done
if [[ $coupee -eq 1 ]]; then
  echo "  · plus aucun nom ne se résout — vérifié"
else
  echo "  ✗ la résolution de noms fonctionne encore : ce parcours ne prouverait pas" >&2
  echo "    que le premier lancement se passe de tout hôte extérieur." >&2
  exit 1
fi

echo
echo "== 5. Le parcours =="
SORTIE="$BASE/parcours.log"
# **La méthode est nommée, pas seulement la classe.** La classe porte aussi
# `leSsoDepuisLEcran`, qui exige un appareil vierge et un banc à fournisseur d'identité :
# lancé ici, il échouait sur « champ field.server introuvable » — un message qui accuse
# l'écran d'entrée alors que le tort est de lancer le mauvais test.
#
# **Les guillemets sont pour le shell de l'appareil, pas pour le nôtre.** `adb shell`
# recolle ses arguments et les fait redécouper là-bas : un mot de passe maître qui contient
# des espaces — c'est-à-dire une phrase de passe, ce que le produit encourage — arrivait
# découpé en quatre arguments, et `am` répondait « Invalid userId -2 » avec son mode
# d'emploi. Le message n'a aucun rapport avec la cause, et c'est ce qui le rend coûteux.
set +e
"$ADB" shell "am instrument -w \
  -e class ch.stackops.ghostpass.ParcoursDeBoutEnBoutTest#leParcoursDePremierLancement \
  -e serveur '$ADRESSE' -e email '$EMAIL' -e motdepasse '$MOTDEPASSE_SAISI' \
  $RUNNER" > "$SORTIE" 2>&1
set -e

# `am instrument` rend toujours 0 : c'est sa sortie qui décide. « OK (n tests) » est le seul
# signe de succès ; un runner qui ne démarre pas ne dit ni OK ni FAILURES, et ce
# troisième cas est traité comme un échec — jamais comme un silence favorable.
if grep -q "^OK (" "$SORTIE"; then
  echo "  ✓ parcours complet : connexion, lecture du coffre personnel **et d'équipe**,"
  echo "    création, modification, registres, partage, corbeille, verrouillage,"
  echo "    lien otpauth reçu coffre fermé, remplissage — sans qu'aucun nom ne se résolve."
else
  echo "  ✗ le parcours a échoué. Ce qu'il rapporte :" >&2
  # Le bloc entier, et pas seulement la première ligne : le message porte l'étape, la
  # cause, **et ce que l'écran montrait**. C'est cette dernière ligne qui distingue « le
  # produit a mal réagi » de « on n'était pas sur l'écran qu'on croyait ».
  sed -n '/Error in/,/^$/p' "$SORTIE" | head -20 >&2 || tail -20 "$SORTIE" >&2
  exit 1
fi

echo
echo "== 6. Le partage traverse jusqu'au navigateur =="
# **Le seul contrôle qui vaille pour cette classe de défaut.** `contrat.json` le dit :
# « un témoin qui vérifie qu'un côté se relit lui-même passe au vert dans le monde cassé ».
# Le parcours vient de créer un partage depuis l'application ; on l'ouvre ici avec
# **WebCrypto**, l'implémentation du navigateur qui l'ouvrira chez le destinataire.
#
# C'est ce défaut-là qui a coûté plusieurs jours : le cœur produisait un nonce de 24 octets,
# le relais refusait « expected 12 bytes after decode, got 24 », et aucun aller-retour interne
# ne pouvait le voir.
LIEN="$("$ADB" shell cat \
  /storage/emulated/0/Android/data/$PAQUET/cache/lien-de-partage.txt 2>/dev/null | tr -d '\r')"
if [[ -z "$LIEN" ]]; then
  echo "  ✗ le parcours n'a déposé aucun lien de partage." >&2
  exit 1
fi
IDENTIFIANT="${LIEN%%\#*}"; IDENTIFIANT="${IDENTIFIANT##*/}"
CLE="${LIEN##*\#}"
echo "  · partage $IDENTIFIANT, clé de ${#CLE} caractères en base64url"

CHIFFRE="$(curl -s "http://127.0.0.1:$PORT/api/send/$IDENTIFIANT")"
CLAIR="$(node --input-type=module -e '
  const [cleUrl, charge] = process.argv.slice(1);
  const { webcrypto } = await import("node:crypto");
  const { ciphertext, iv } = JSON.parse(charge);
  // La clé voyage en base64url sans remplissage : la ramener au base64 standard est
  // exactement ce que fait la page du navigateur. Ne pas le faire échoue sur
  // « Invalid padding », un message qui accuse le format et laisse croire à une clé corrompue.
  const std = cleUrl.replace(/-/g, "+").replace(/_/g, "/").padEnd(
    cleUrl.length + ((4 - (cleUrl.length % 4)) % 4), "=");
  const cle = await webcrypto.subtle.importKey(
    "raw", Buffer.from(std, "base64"), "AES-GCM", false, ["decrypt"]);
  const clair = await webcrypto.subtle.decrypt(
    { name: "AES-GCM", iv: Buffer.from(iv, "base64") }, cle,
    Buffer.from(ciphertext, "base64"));
  process.stdout.write(Buffer.from(clair).toString("utf8"));
' "$CLE" "$CHIFFRE" 2>/dev/null || true)"

if [[ "$CLAIR" == "tr0ubad0ur" ]]; then
  echo "  ✓ un partage créé dans l'application s'ouvre avec WebCrypto"
else
  echo "  ✗ WebCrypto n'a pas ouvert le partage créé par l'application." >&2
  echo "    Reçu : « $CLAIR » — attendu le mot de passe de l'élément créé." >&2
  echo "    C'est exactement le défaut qui a rendu le partage mobile impossible." >&2
  exit 1
fi

echo
echo "== 7. Ce que le serveur a vu =="
# Le parcours pourrait passer sur un cache : on exige que le serveur ait vu chaque étape.
manquant=0
for route in "auth/prelogin" "auth/login" "vault/items"; do
  if grep -q "$route" "$JOURNAL"; then
    echo "  ✓ $route"
  else
    echo "  ✗ $route — le serveur local n'a jamais vu cette requête" >&2
    manquant=1
  fi
done
# La création et la modification doivent être **écrites** : une liste lue depuis un cache
# donnerait les mêmes écrans sans qu'aucun octet ne parte.
if grep -q '"method":"POST","url":"/api/vault/items"' "$JOURNAL"; then
  echo "  ✓ création (POST /api/vault/items)"
else
  echo "  ✗ aucune création n'a atteint le serveur" >&2; manquant=1
fi
if grep -q '"method":"PUT","url":"/api/vault/items/' "$JOURNAL"; then
  echo "  ✓ modification (PUT /api/vault/items/…)"
else
  echo "  ✗ aucune modification n'a atteint le serveur" >&2; manquant=1
fi
if grep -q '"method":"POST","url":"/api/send"' "$JOURNAL"; then
  echo "  ✓ partage (POST /api/send)"
else
  echo "  ✗ aucun partage n'a atteint le serveur" >&2; manquant=1
fi
# L'écriture d'équipe doit avoir atteint la route d'équipe, **et pas le coffre personnel**.
# C'est la seule façon de distinguer « enregistré » de « enregistré au bon endroit » : les
# deux donnent le même écran.
if grep -q '"method":"POST","url":"/api/orgs/[^"]*/collections/[^"]*/items"' "$JOURNAL"; then
  echo "  ✓ écriture d'équipe (POST /api/orgs/…/collections/…/items)"
else
  echo "  ✗ aucune écriture d'équipe n'a atteint le serveur : l'élément est peut-être" >&2
  echo "    parti dans le coffre personnel, où l'équipe ne le retrouvera jamais." >&2
  manquant=1
fi
# Et la clé courante est vérifiée avant chaque écriture d'équipe : le `GET .../membership`
# en est la trace.
if grep -q '"url":"/api/orgs/[^"]*/membership"' "$JOURNAL"; then
  echo "  ✓ clé d'équipe revérifiée avant écriture (GET /api/orgs/…/membership)"
else
  echo "  ✗ la clé d'équipe n'a jamais été revérifiée : une rotation passée inaperçue" >&2
  echo "    ferait sceller sous une génération retirée, illisible pour les autres." >&2
  manquant=1
fi
if grep -q '"url":"/api/vault/trash"' "$JOURNAL"; then
  echo "  ✓ corbeille (GET /api/vault/trash)"
else
  echo "  ✗ la corbeille n'a jamais été demandée au serveur" >&2; manquant=1
fi

# ─── Les registres : un seul par nom, jamais deux ───
#
# Le défaut que cette ligne attrape ne lève aucune erreur : écrire un registre sans
# réutiliser son identité en crée un **second** du même nom. Un seul est lu ; l'autre reste
# à contredire le premier chez le prochain client. On compte donc les créations : le
# parcours écrit trois fois des registres (favori, dossier ajouté, dossier retiré), et cela
# doit faire **deux** créations — un registre de favoris, un de dossiers — puis des
# remplacements.
creations="$(grep -c '"method":"POST","url":"/api/vault/items"' "$JOURNAL" || true)"
# Le semis en dépose quatre, l'application en crée un : cinq, plus les deux registres.
if [[ "$creations" -le 7 ]]; then
  echo "  ✓ registres écrits sans doublon ($creations créations d'éléments au total)"
else
  echo "  ✗ $creations créations : un registre a été créé plusieurs fois au lieu d'être" >&2
  echo "    remplacé. Un seul serait lu, l'autre resterait à le contredire." >&2
  manquant=1
fi
[[ $manquant -eq 0 ]] || exit 1

echo
echo "Parcours concluant : un premier lancement aboutit à un coffre utilisable contre une"
echo "instance quelconque, résolution de noms coupée, sans jamais nommer l'éditeur."
