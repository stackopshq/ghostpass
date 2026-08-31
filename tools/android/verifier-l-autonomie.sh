#!/usr/bin/env bash
# Vérifie que l'APK livré ne vend rien et ne dépend de personne.
#
# Pendant Android de `tools/ios/verifier-l-autonomie.sh`, et même raisonnement : GhostPass
# est **gratuit**. Ce qui se paie, chez ceux qui ne veulent pas auto-héberger, est la mise
# à disposition d'une VM — pas le logiciel. C'est une qualification juridique, et aucun
# relecteur ne juge sur la qualification : il juge sur ce que **contient l'application**.
#
#   ./tools/android/verifier-l-autonomie.sh [chemin/vers/app.apk]
#
# ─── Pourquoi on scanne le paquet et pas les sources ───
#
# `docs/appstore.md` parle légitimement de tarif, `docs/adr/` d'abonnement, et ce fichier-ci
# écrit les mots qu'il interdit. Un grep sur le dépôt exigerait une liste d'exclusions qui
# pourrit — et c'est exactement ainsi qu'un garde-fou de la suite a expédié en production la
# classe CSS qu'il interdisait : il a scanné son propre texte.
#
# ─── Le piège propre à l'APK, mesuré en écrivant ce script ───
#
# **`strings` sur le fichier `.apk` ne voit presque rien**, et rend pourtant un résultat.
#
# Un APK est une archive ZIP dont les entrées sont *dégonflées*. Les chaînes du code vivent
# dans les `classes*.dex`, celles de l'interface dans `resources.arsc` — tous compressés.
# `strings monapk.apk` lit donc des octets compressés et n'y trouve, par accident, que
# quelques fragments. Le contrôle passerait au vert en croyant avoir tout lu.
#
# C'est la version Android de ce qui a été mesuré sur iOS : là-bas, `strings` ne lisait pas
# ce qui suit le dernier segment d'un Mach-O, et un témoin qui ajoutait des octets à la fin
# du binaire passait au vert. Même leçon, autre format — **il faut décompresser d'abord**,
# et c'est ce que fait ce script.
#
# ─── Ce que ce script ne prouve pas ───
#
# L'absence de vitrine n'est pas l'autonomie. Ce qui prouve qu'on fonctionne sans StackOps,
# c'est un parcours de premier lancement qui aboutit à un coffre utilisable contre une
# instance quelconque. Ce parcours **n'existe pas encore côté Android** : il demande un
# émulateur et un serveur local, et tant qu'il manque, ce script reste vert sans rien dire
# du troisième point. C'est écrit ici plutôt que passé sous silence.
#
# Enfin : les règles de Google sur les paiements hors application sont **voisines de celles
# d'Apple, pas identiques**, et les deux ont bougé plusieurs fois. Elles sont à relire sur
# le texte en vigueur avant chaque soumission, pas à transposer.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
APK="${1:-}"
if [[ -z "$APK" ]]; then
  # **Jamais l'APK de test.** Le dossier de construction en contient un, et il n'est jamais
  # soumis : il embarque les tests de contrat, qui nomment légitimement `git.stackops.ch`
  # dans leurs jeux d'essai et font rougir un contrôle sur du code qui ne part pas.
  # Constaté en écrivant ce script — le premier lancement a examiné
  # `app-debug-androidTest.apk` et signalé deux fautes inexistantes.
  #
  # C'est le pendant exact de l'exclusion `*Tests*` du script iOS, pour la même raison.
  APK="$(find "$ROOT/apps/android/app/build/outputs/apk" -name '*.apk' \
    ! -name '*androidTest*' ! -path '*/androidTest/*' 2>/dev/null | head -1)"
fi
if [[ -z "$APK" || ! -f "$APK" ]]; then
  echo "Aucun APK à examiner. Construisez d'abord :" >&2
  echo "  JAVA_HOME=…/openjdk@21 apps/android/gradlew -p apps/android :app:assembleDebug" >&2
  echo "ou passez le chemin en argument." >&2
  exit 2
fi

# ─── Deux vocabulaires, et c'est ce qui distingue ce script de son jumeau iOS ───
#
# Un APK ne contient pas que notre code. Il embarque AndroidX, Compose, kotlinx.coroutines
# et JNA, et **le vocabulaire du commerce recoupe celui de ces bibliothèques**. Mesuré sur
# le premier APK construit, quatre alertes, toutes fausses :
#
#   « subscription »  → `kotlinx/coroutines/flow/internal/SubscriptionCountStateFlow`,
#                       `onSubscription`, `androidx/core/telephony/SubscriptionManagerCompat`
#   « premium »       → `isPremiumVibratorEnabled`, une API de vibreur
#   « upgrade »       → une phrase de documentation de Compose sur le chargement des polices
#   « $5.17 »         → la chaîne de version de JNA, `$5.17.0 (package information missing)`,
#                       que le motif de prix lisait comme un montant en dollars
#
# C'est la même leçon que le « eur » d'« erreur33 » sur iOS, en plus fréquent : là-bas le
# binaire est presque entièrement à nous, ici il est aux trois quarts aux autres. Élargir le
# motif jusqu'à taire ces quatre-là le rendrait aveugle ; on sépare donc selon ce que chaque
# mot peut honnêtement vouloir dire.

# Ce qui n'a aucun autre sens que commercial. Cherché **partout**, code compris : aucune
# bibliothèque de plateforme ne nomme une classe « essai gratuit ».
VITRINE_SANS_AMBIGUITE='abonnement|s.abonner|abonnez|essai gratuit|free trial|pricing|tarifs?|forfait|passer .+ la version|in-app purchase|billingclient'

# Ce qui est commercial **quand un utilisateur le lit**, et anodin dans un nom de symbole.
# Cherché seulement dans les ressources et dans les chaînes de l'application, jamais dans
# l'index des classes — voir les quatre faux positifs ci-dessus.
VITRINE_SI_VISIBLE='subscription|premium|upgrade|acheter|purchase|checkout'

# Un prix affiché. Le symbole seul est trop fréquent : on exige un chiffre.
#
# Sensible à la casse, codes de devise bornés par des limites de mot — sans quoi « eur » se
# trouve dans « erreur ». Et le montant en dollars **ne doit pas être suivi d'un point ni
# d'un chiffre** : sans cette précaution, « $5.17.0 » — un numéro de version — se lit comme
# cinq dollars dix-sept.
PRIX='\b(CHF|EUR|USD)\b[[:space:]]*[0-9]|[0-9][[:space:]]*\b(CHF|EUR|USD)\b|[€£][0-9]|\$[0-9]+[.,][0-9]{2}([^0-9.]|$)'

# Une dépendance à l'infrastructure de l'éditeur. L'application doit marcher contre
# n'importe quelle instance ; un point de terminaison en dur dirait le contraire.
#
# `ch.stackops.ghostpass` est l'identifiant du paquet — il est partout, légitimement. On
# cherche donc `stackops.ch` sous sa forme d'adresse, que l'identifiant inversé ne produit
# jamais.
EDITEUR='stackops\.ch'

# La facturation de Google. Sa seule présence dans l'APK contredit « l'application ne vend
# rien », même si aucun écran ne l'utilise.
FACTURATION='com\.android\.billingclient|com\.android\.vending\.BILLING'

DEBALLE="$(mktemp -d)"
trap 'rm -rf "$DEBALLE"' EXIT

# **Décompresser d'abord** — voir le piège en tête de fichier.
unzip -q -o "$APK" -d "$DEBALLE"

# Ce qu'on examine : le code (`classes*.dex`), les ressources compilées
# (`resources.arsc`), et le manifeste. Les images sont écartées : elles n'ont pas de
# chaînes, et `strings` sur un PNG produit du bruit qui masquerait le reste.
#
# `ch.stackops.ghostpass` est l'identifiant du paquet — il est partout, légitimement, et
# n'est pas un point de terminaison. On ne cherche donc `stackops.ch` que sous une forme
# d'adresse, pas dans un nom de classe inversé.
# Le périmètre large : tout ce qui porte du texte dans l'APK livré. Les images sont
# écartées — elles n'ont pas de chaînes, et `strings` sur un PNG produit du bruit.
lister_tout() {
  find "$DEBALLE" -type f \
    \( -name '*.dex' -o -name 'resources.arsc' -o -name 'AndroidManifest.xml' \) \
    -print0
}

# Le périmètre restreint : ce qu'un utilisateur peut lire. Les ressources compilées portent
# les chaînes déclarées en XML ; le manifeste porte les libellés.
#
# **Ce périmètre a un trou connu**, et il vaut mieux l'écrire que le laisser découvrir :
# les écrans sont en Compose, et leurs textes sont des littéraux Kotlin qui finissent dans
# les `.dex`, pas dans `resources.arsc`. Un prix écrit en dur dans un `Text("CHF 9.90")`
# serait donc vu par le contrôle des prix — qui, lui, balaie tout — mais un mot comme
# « premium » dans un littéral Compose échapperait à ce contrôle-ci.
#
# Le corriger proprement demande de distinguer nos chaînes de celles des bibliothèques dans
# un `.dex`, ce que le format ne permet pas simplement. Déplacer les textes de l'interface
# vers `strings.xml` le refermerait, et c'est de toute façon ce qu'exige la traduction.
lister_le_visible() {
  find "$DEBALLE" -type f \
    \( -name 'resources.arsc' -o -name 'AndroidManifest.xml' \) \
    -print0
}

fautes=0
controler() {
  local nom="$1" motif="$2" casse="${3:-insensible}" perimetre="${4:-tout}" trouve=""
  local drapeaux='-aoE'
  [[ "$casse" == insensible ]] && drapeaux='-aioE'
  while IFS= read -r -d '' fichier; do
    local lignes
    lignes="$(strings -a "$fichier" 2>/dev/null | grep $drapeaux "$motif" | sort -u | head -5 || true)"
    if [[ -n "$lignes" ]]; then
      trouve+=$'\n'"  ${fichier#"$DEBALLE"/} :"$'\n'"$(echo "$lignes" | sed 's/^/    /')"
    fi
  done < <(if [[ "$perimetre" == visible ]]; then lister_le_visible; else lister_tout; fi)

  if [[ -n "$trouve" ]]; then
    printf '\033[31m✗ %s\033[0m%s\n\n' "$nom" "$trouve"
    fautes=$((fautes + 1))
  else
    printf '\033[32m✓ %s\033[0m\n' "$nom"
  fi
}

echo "Paquet examiné : ${APK#"$ROOT"/}"
echo "Entrées décompressées : $(find "$DEBALLE" -type f | wc -l | tr -d ' ')"
echo

controler "aucun mot de vitrine sans ambiguïté"      "$VITRINE_SANS_AMBIGUITE" insensible tout
controler "aucun mot de vitrine visible"            "$VITRINE_SI_VISIBLE"     insensible visible
controler "aucun prix affiché"                      "$PRIX"                   sensible   tout
controler "aucun point de terminaison de l'éditeur" "$EDITEUR"                insensible tout
controler "aucune bibliothèque de facturation"      "$FACTURATION"            insensible tout

echo
if [[ $fautes -ne 0 ]]; then
  echo "L'application livrée porte $fautes trace(s) de vitrine ou de dépendance." >&2
  exit 1
fi
cat <<'FIN'
L'APK ne vend rien et ne nomme aucun serveur de l'éditeur.

Rappel de ce qui n'est PAS prouvé ici : qu'un premier lancement aboutit à un coffre
utilisable contre une instance quelconque. Cela demande un test de bout en bout contre un
serveur local, qui reste à écrire côté Android. Sans lui, ce contrôle reste vert et ne dit
rien du troisième point du §7.
FIN
