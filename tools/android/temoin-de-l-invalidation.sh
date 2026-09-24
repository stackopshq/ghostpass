#!/usr/bin/env bash
# Le témoin qu'exige `docs/adr/0002` : la clé du coffre est-elle **vraiment** invalidée par
# l'enrôlement d'une nouvelle empreinte ?
#
# ─── Pourquoi ce script existe, et pas seulement un test ───
#
# L'ADR nomme `setInvalidatedByBiometricEnrollment(true)` comme le réglage dont l'oubli ne se
# voit jamais. Le premier témoin écrit pour lui lisait `KeyInfo` et affirmait `true`. Son
# contrôle l'a démoli : **la même clé construite avec `false` rapporte `true` elle aussi**.
# `KeyInfo` dérive cette propriété du type d'authentificateur de la clé, pas de la consigne.
# Le témoin était vert quoi qu'on écrive dans le code — le piège exact du témoin dont les
# deux branches de la mutation produisent la même sortie.
#
# Ce qui reste, et qui est en fait la seule preuve qui vaille : **enrôler une empreinte de
# plus, pour de vrai, et regarder si la clé sert encore**. Aucun test ne peut enrôler une
# empreinte ; il faut un script autour. Le voici.
#
#   1. il prépare l'émulateur : code de verrouillage, puis une première empreinte ;
#   2. `poserLesCles` pose deux clés et montre qu'elles s'initialisent ;
#   3. le script enrôle une **seconde** empreinte ;
#   4. `relireLesCles` exige que la clé de production soit morte, et que la clé témoin vive.
#
# ─── Le contrôle, et pourquoi il est là ───
#
# Une clé morte après un enrôlement ne prouve rien si quelque chose d'autre a pu la tuer :
# une réinstallation, un effacement du magasin, un `-wipe-data`. La seconde clé porte la même
# politique avec une **durée de validité** au lieu d'une authentification par usage : elle
# est attachée à l'horloge du système, pas aux empreintes, et doit **survivre**. Si les deux
# meurent, on mesure le script ; si les deux vivent, on ne mesure rien.
#
#   tools/android/temoin-de-l-invalidation.sh
#
# Il faut un émulateur en marche. Le script ne réinstalle pas l'application entre les deux
# temps — une réinstallation efface les clés du magasin et rendrait le témoin vert pour la
# mauvaise raison.
set -euo pipefail

PRODUIT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
GRADLE="$PRODUIT/apps/android"
SDK="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
ADB="$SDK/platform-tools/adb"
: "${JAVA_HOME:=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home}"
export JAVA_HOME

CODE="${CODE_DE_VERROUILLAGE:-1234}"

if [[ ! -x "$ADB" ]]; then
  echo "adb introuvable ($ADB). Réglez ANDROID_HOME." >&2
  exit 1
fi
if ! "$ADB" shell true >/dev/null 2>&1; then
  echo "Aucun appareil. Démarrez un émulateur :" >&2
  echo "  \$ANDROID_HOME/emulator/emulator -avd <nom> -no-window &" >&2
  exit 1
fi

echo "== 0. Préparer l'appareil =="

# `locksettings set-pin` refuse un code vide quand un code existe déjà : on essaie les deux
# formes plutôt que de deviner l'état de l'appareil.
if "$ADB" shell locksettings verify --old "$CODE" 2>&1 | grep -q "verified successfully"; then
  echo "  · code de verrouillage déjà posé"
else
  "$ADB" shell locksettings set-pin "$CODE" >/dev/null 2>&1 \
    || { echo "  ✗ impossible de poser un code de verrouillage" >&2; exit 1; }
  echo "  · code de verrouillage posé"
fi

# Déverrouiller la session : l'assistant d'enrôlement demande le code, et la clé exige
# `setUnlockedDeviceRequired`.
deverrouiller() {
  "$ADB" shell input keyevent KEYCODE_WAKEUP >/dev/null 2>&1 || true
  sleep 1
  "$ADB" shell input swipe 360 900 360 300 >/dev/null 2>&1 || true
  sleep 1
  "$ADB" shell input text "$CODE" >/dev/null 2>&1 || true
  "$ADB" shell input keyevent KEYCODE_ENTER >/dev/null 2>&1 || true
  sleep 2
}

# Lit l'écran courant : `texte | x | y`, coordonnées au centre de l'élément.
lire_ecran() {
  "$ADB" shell uiautomator dump /sdcard/temoin-ui.xml >/dev/null 2>&1 || true
  "$ADB" shell cat /sdcard/temoin-ui.xml 2>/dev/null | python3 -c '
import sys, re
t = sys.stdin.read()
for m in re.finditer(r"text=\"([^\"]*)\"[^>]*?bounds=\"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", t):
    if m.group(1).strip():
        print(m.group(1), "|", (int(m.group(2)) + int(m.group(4))) // 2,
              "|", (int(m.group(3)) + int(m.group(5))) // 2)
'
}

toucher() { "$ADB" shell input tap "$1" "$2" >/dev/null 2>&1; sleep 2; }

# L'assistant d'enrôlement d'AOSP, piloté à l'écran.
#
# Trois écarts mesurés en l'écrivant, et le deuxième a rendu le témoin faussement rassurant :
#
#  - `am start -a android.settings.FINGERPRINT_ENROLL` **redemande le code de verrouillage**
#    avant tout. Il faut le retaper, sinon la boucle tourne à vide sur un écran de saisie ;
#  - **quand une empreinte existe déjà, cette intention n'ouvre pas l'assistant** : elle
#    ouvre la *liste* des empreintes, où le bouton s'appelle « Add fingerprint ». Sans ce
#    libellé dans la liste des cibles, le second enrôlement n'avait tout simplement pas
#    lieu — et le témoin concluait « la clé a survécu » sur un appareil où rien n'avait
#    changé. C'était un faux négatif, mais la même cécité aurait pu donner un faux positif ;
#  - le capteur virtuel veut **un identifiant de doigt différent** pour un second
#    enrôlement : `adb emu finger touch 2`. Le même identifiant rejoue le doigt déjà connu.
enroler_une_empreinte() {
  local doigt="${1:-1}"
  "$ADB" shell am start -a android.settings.FINGERPRINT_ENROLL >/dev/null 2>&1 || true
  sleep 3

  # Le code de verrouillage, si l'assistant le redemande.
  if lire_ecran | grep -qiE "Enter your PIN|Re-enter your PIN|Confirm your PIN"; then
    "$ADB" shell input text "$CODE" >/dev/null 2>&1 || true
    "$ADB" shell input keyevent KEYCODE_ENTER >/dev/null 2>&1 || true
    sleep 3
  fi

  # Les écrans de consentement, puis « Add fingerprint » si la liste s'est ouverte.
  for _ in $(seq 1 10); do
    local ligne
    ligne="$(lire_ecran \
      | grep -iE "^(MORE|I AGREE|AGREE|NEXT|CONTINUE|START|GOT IT|ADD FINGERPRINT|ADD ANOTHER)\b" \
      | head -1 || true)"
    if [[ -z "$ligne" ]]; then break; fi
    toucher "$(echo "$ligne" | awk -F'|' '{print $2}' | tr -d ' ')" \
            "$(echo "$ligne" | awk -F'|' '{print $3}' | tr -d ' ')"
    # Une fois sur l'écran du capteur, on arrête de chercher des boutons.
    if lire_ecran | grep -qiE "Touch the sensor|Lift, then touch again"; then break; fi
  done

  # Le capteur virtuel : chaque « touch » compte pour un passage.
  local vu=1
  for _ in $(seq 1 40); do
    "$ADB" emu finger touch "$doigt" >/dev/null 2>&1 || true
    sleep 1
    if lire_ecran | grep -qiE "Fingerprint added"; then vu=0; break; fi
  done

  local fini
  fini="$(lire_ecran | grep -iE "^DONE\b" | head -1 || true)"
  if [[ -n "$fini" ]]; then
    toucher "$(echo "$fini" | awk -F'|' '{print $2}' | tr -d ' ')" \
            "$(echo "$fini" | awk -F'|' '{print $3}' | tr -d ' ')"
  fi
  # Refermer ce qui traîne : l'assistant laisse parfois une boîte de renommage ouverte, et
  # l'écran suivant compterait alors « Finger 1 » deux fois — une fois dans la liste, une
  # fois dans le titre de la boîte. C'est comme cela qu'un compte de 1 s'est lu 2, et qu'un
  # enrôlement qui n'avait pas eu lieu a paru avoir eu lieu.
  "$ADB" shell input keyevent KEYCODE_BACK >/dev/null 2>&1 || true
  sleep 1
  return $vu
}

# Combien d'empreintes l'appareil connaît-il ?
#
# Lu dans la liste des réglages, faute de mieux : ni `dumpsys fingerprint` ni
# `cmd fingerprint` ne rendent le compte des enrôlements sur cette image système. C'est
# fragile, et c'est pourquoi ce compte ne sert qu'à **refuser d'avancer** — jamais à
# conclure que tout va bien.
compter_les_empreintes() {
  # Refermer une boîte éventuellement ouverte : son titre reprend le nom de l'empreinte et
  # ferait compter deux fois la même.
  "$ADB" shell input keyevent KEYCODE_BACK >/dev/null 2>&1 || true
  sleep 1
  "$ADB" shell am start -a android.settings.FINGERPRINT_SETTINGS >/dev/null 2>&1 || true
  sleep 3
  if lire_ecran | grep -qiE "Enter your PIN|Re-enter your PIN"; then
    "$ADB" shell input text "$CODE" >/dev/null 2>&1 || true
    "$ADB" shell input keyevent KEYCODE_ENTER >/dev/null 2>&1 || true
    sleep 3
  fi
  # `sort -u` : on compte des empreintes distinctes, pas des occurrences d'un libellé.
  #
  # `|| true` sur le `grep`, et c'est **le même piège que la coupure de résolution de noms**
  # : sous `set -o pipefail`, un `grep` qui ne trouve rien rend 1, le pipeline entier rend 1,
  # et la substitution de commande fait tomber le script sous `set -e`. Zéro empreinte est
  # pourtant un résultat parfaitement normal — c'est même celui du premier passage.
  # Le script s'arrêtait après « code de verrouillage posé », sans un mot.
  { lire_ecran | grep -oiE "^Finger [0-9]+" || true; } | sort -u | wc -l | tr -d " "
}

# ─── Pourquoi `am instrument` et non `connectedAndroidTest` ───
#
# Mesuré en écrivant ce script, et c'est le genre d'écart qui rend un témoin vert pour rien :
# `:app:connectedDebugAndroidTest` **désinstalle l'application** à la fin de son exécution.
# Or les entrées de l'`AndroidKeyStore` appartiennent à l'UID de l'application et partent
# avec elle. Les deux temps ne se voyaient donc pas : le second retrouvait un magasin vide et
# se plaignait qu'aucune clé n'avait été posée — ce qui, au passage, est mieux que de
# conclure « la clé a bien été invalidée » sur une clé qui n'existait plus.
#
# On installe donc une fois, et on lance l'instrumentation à la main.
PAQUET="ch.stackops.ghostpass"
RUNNER="$PAQUET.test/androidx.test.runner.AndroidJUnitRunner"

installer() {
  (cd "$GRADLE" && ./gradlew :app:assembleDebug :app:assembleDebugAndroidTest \
      --console=plain -q) >/dev/null
  "$ADB" install -r -t "$GRADLE/app/build/outputs/apk/debug/app-debug.apk" >/dev/null
  "$ADB" install -r -t \
    "$GRADLE/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk" >/dev/null
}

# `am instrument` rend toujours 0 : c'est sa sortie qu'il faut lire. « OK (n tests) » est le
# seul signe de succès ; un `FAILURES!!!` en est le contraire, et un runner qui ne démarre
# pas ne dit ni l'un ni l'autre — ce troisième cas est traité comme un échec, jamais comme
# un silence favorable.
lancer() {
  local sortie
  sortie="$("$ADB" shell am instrument -w \
    -e class "ch.stackops.ghostpass.InvalidationDeLaCleTest#$1" "$RUNNER" 2>&1)"
  echo "$sortie" > "/tmp/temoin-invalidation-$1.log"
  echo "$sortie" | grep -q "^OK (" 
}

deverrouiller
avant="$(compter_les_empreintes)"
if [[ "$avant" -eq 0 ]]; then
  echo "  · enrôlement d'une première empreinte"
  enroler_une_empreinte 1 >/dev/null 2>&1 || true
  deverrouiller
  avant="$(compter_les_empreintes)"
fi
echo "  · empreintes connues : $avant"
if [[ "$avant" -eq 0 ]]; then
  echo "  ✗ aucune empreinte n'a pu être enrôlée — le témoin ne peut rien mesurer." >&2
  exit 1
fi

echo "  · installation (une seule fois, pour les deux temps)"
installer

echo
echo "== 1. Poser les trois clés =="
if lancer poserLesCles; then
  echo "  ✓ les trois clés existent, et la clé de production s'initialise sans rien demander"
else
  echo "  ✗ impossible de poser les clés. Ce que le test rapporte :" >&2
  grep -E "AssertionError|Error in|junit" /tmp/temoin-invalidation-poserLesCles.log | head -6 >&2 || true
  exit 1
fi

echo
echo "== 2. Enrôler une empreinte de plus =="
deverrouiller
# Un identifiant de doigt différent : le capteur virtuel rejouerait sinon le doigt connu,
# et l'enrôlement n'aurait pas lieu. Le compte ci-dessous est ce qui le vérifie.
enroler_une_empreinte $((avant + 1)) >/dev/null 2>&1 || true
deverrouiller
apres="$(compter_les_empreintes)"
echo "  · empreintes connues : $avant → $apres"
if [[ "$apres" -le "$avant" ]]; then
  echo "  ✗ AUCUNE EMPREINTE N'A ÉTÉ AJOUTÉE." >&2
  echo "    Le troisième temps conclurait « la clé a survécu » sur un appareil où rien" >&2
  echo "    n'a changé — c'est-à-dire qu'il ne mesurerait rien. On s'arrête ici." >&2
  exit 1
fi

echo
echo "== 3. Relire les clés =="
if lancer relireLesCles; then
  echo "  ✓ la clé du coffre a été invalidée par l'enrôlement, et les contrôles ont survécu."
  echo
  echo "Témoin concluant : l'exigence d'ADR-0002 est tenue, et elle est mesurée sur le"
  echo "comportement — pas sur ce que le magasin rapporte de lui-même."
else
  echo "  ✗ ÉCHEC. Ce que le test rapporte :" >&2
  grep -E "AssertionError|États relevés|A SURVÉCU|Error in" \
    /tmp/temoin-invalidation-relireLesCles.log | head -10 >&2 || true
  exit 1
fi
