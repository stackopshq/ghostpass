#!/usr/bin/env bash
# Prouve que `verifier-l-autonomie.sh` sait rougir — et qu'il rougit pour la bonne raison.
#
# Un contrôle qui n'a jamais été rouge n'a rien prouvé. Celui-ci est éprouvé de deux façons,
# et **l'ordre compte** : la première perturbation doit le laisser vert, la seconde doit le
# faire tomber.
#
#   1. **Ajouter des octets à la fin de l'APK ne suffit pas.** C'est la perturbation
#      commode, celle qu'on écrit quand on veut se rassurer — et elle ne prouve rien. Un
#      APK est une archive ZIP : ce qu'on colle après le commentaire final n'est lu par
#      personne, et surtout pas par `unzip`, qui suit l'index central. Le contrôle reste
#      vert, à juste titre.
#
#      C'est la version Android de ce qui a été mesuré sur iOS : un témoin qui injectait des
#      octets à la fin d'un Mach-O passait au vert, parce que `strings` ne lit pas ce qui
#      suit le dernier segment. Même piège, autre format. On le rejoue ici pour qu'il reste
#      documenté par l'exécution plutôt que par un commentaire.
#
#   2. **Écrire un prix dans le source et reconstruire, si.** C'est la perturbation qui
#      ressemble à la faute réelle : quelqu'un ajoute un écran de tarif. Elle doit faire
#      rougir le contrôle, et à l'endroit où le relecteur le lirait.
set -euo pipefail

PRODUIT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
GRADLE="$PRODUIT/apps/android"
CONTROLE="$PRODUIT/tools/android/verifier-l-autonomie.sh"
APK="$GRADLE/app/build/outputs/apk/debug/app-debug.apk"
SOURCE="$GRADLE/app/src/main/kotlin/ch/stackops/ghostpass/ui/EcranDeDeverrouillage.kt"
: "${JAVA_HOME:=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home}"
export JAVA_HOME

construire() { (cd "$GRADLE" && ./gradlew :app:assembleDebug --console=plain -q) >/dev/null 2>&1; }

SAUVEGARDE="$(mktemp)"
cp "$SOURCE" "$SAUVEGARDE"
trap 'cp "$SAUVEGARDE" "$SOURCE"; rm -f "$SAUVEGARDE"; construire || true' EXIT

echec=0

echo "0. Au départ, le contrôle doit être vert."
construire
if "$CONTROLE" >/dev/null 2>&1; then
  echo "  ✓ vert"
else
  echo "  ✗ déjà rouge sans perturbation — corrigez cela d'abord." >&2
  exit 1
fi

echo
echo "1. Des octets collés à la fin de l'APK — la perturbation qui ne prouve rien."
printf 'CHF 9.90 abonnement premium' >> "$APK"
if "$CONTROLE" >/dev/null 2>&1; then
  echo "  ✓ le contrôle reste vert, et c'est correct : ces octets ne sont dans aucune"
  echo "    entrée de l'archive. Un témoin qui s'arrêterait ici se croirait concluant."
else
  echo "  ✗ le contrôle rougit sur des octets hors archive — il lit l'APK brut, pas ses"
  echo "    entrées décompressées."
  echec=1
fi
# La preuve que ces octets sont bien présents dans le fichier, et pourtant invisibles à qui
# lit l'archive correctement : sans elle, on pourrait croire que l'ajout a échoué.
if strings -a "$APK" | grep -q 'CHF 9.90 abonnement premium'; then
  echo "  · vérifié : les octets SONT dans le fichier (« strings » les voit)…"
else
  echo "  ✗ les octets n'ont pas été ajoutés — le témoin ne prouve rien." >&2
  echec=1
fi
if unzip -l "$APK" >/dev/null 2>&1; then
  echo "  · …et l'archive reste lisible : c'est bien l'index central qui fait foi."
fi

echo
echo "2. Un prix écrit dans le source, puis reconstruit — la perturbation qui compte."
# La perturbation doit produire du Kotlin **valide** : un source qui ne compile plus ferait
# échouer la construction, et un témoin qui confond « ça ne compile pas » avec « le contrôle
# a rougi » ne prouve rien. On remplace donc le sous-titre de l'enseigne par une ligne de
# vitrine — la faute exacte que le contrôle est censé attraper, à l'endroit le plus visible
# de l'application.
python3 - "$SOURCE" <<'PYTHON'
import sys
chemin = sys.argv[1]
source = open(chemin, encoding="utf-8").read()
ancre = '"Coffre chiffré de bout en bout"'
if ancre not in source:
    sys.exit("ancre introuvable dans l'écran de déverrouillage")
source = source.replace(ancre, '"Passer à la version premium — CHF 9.90 par mois"', 1)
open(chemin, "w", encoding="utf-8").write(source)
PYTHON
if ! construire; then
  echo "  ✗ la perturbation ne compile pas — le témoin ne mesure alors que le compilateur." >&2
  exit 1
fi
if "$CONTROLE" >/dev/null 2>&1; then
  echo "  ✗ le contrôle reste VERT avec un prix dans l'application livrée."
  echo "    Il ne mesure pas ce qu'il prétend mesurer."
  echec=1
else
  echo "  ✓ le contrôle tombe, comme il le doit"
  echo
  echo "  Ce qu'il rapporte :"
  "$CONTROLE" 2>&1 | grep -E '✗|CHF|premium' | sed 's/^/    /' || true
fi

echo
if [[ $echec -ne 0 ]]; then
  echo "Témoin en échec : le contrôle d'autonomie ne mesure pas ce qu'il annonce." >&2
  exit 1
fi
echo "Témoin concluant : le contrôle ignore les octets hors archive et tombe sur un vrai prix."
