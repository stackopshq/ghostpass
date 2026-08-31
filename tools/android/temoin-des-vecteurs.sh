#!/usr/bin/env bash
# Le garde-fou du garde-fou : prouve que `ContratTest` **lit** les vecteurs de contrat.
#
# Un client peut lire `assets/vecteurs/contrat.json` **et** garder les mêmes valeurs en dur
# à côté. Ses tests passeraient, et la divergence resterait — c'est exactement le cas que
# décrit `suite/docs/adr/0002` §4. Chercher les duplications par `grep` ne tient pas : cela
# échoue sur le formatage, sur la casse, sur une chaîne coupée en deux, et cela se prend les
# pieds dans son propre texte. Un garde-fou de la suite a déjà expédié en production la
# classe CSS qu'il interdisait, pour avoir scanné son propre fichier de test.
#
# On prouve donc la **consommation**, pas l'absence de duplication : on perturbe un octet
# du fichier et on vérifie que la suite de contrat tombe. C'est langage-agnostique et
# insensible au formatage.
#
# Chaque perturbation porte sur une valeur différente, et nomme le test qui doit rougir.
# Une perturbation qui ne fait rien tomber signale un vecteur lu par personne.
set -euo pipefail

PRODUIT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
VECTEURS="$PRODUIT/assets/vecteurs/contrat.json"
GRADLE="$PRODUIT/apps/android"
: "${JAVA_HOME:=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home}"
export JAVA_HOME

if [[ ! -f "$VECTEURS" ]]; then
  echo "Vecteurs introuvables : $VECTEURS" >&2
  exit 1
fi

SAUVEGARDE="$(mktemp)"
cp "$VECTEURS" "$SAUVEGARDE"
# Quoi qu'il arrive — succès, échec, interruption — le fichier revient à son état d'origine.
# Un témoin qui laisse le dépôt perturbé derrière lui est pire que pas de témoin.
trap 'cp "$SAUVEGARDE" "$VECTEURS"; rm -f "$SAUVEGARDE"' EXIT

# `--rerun-tasks` est indispensable : sans lui Gradle considère `processTestResources` à
# jour et le test relit l'ancienne copie. Le témoin passerait au vert en croyant prouver
# quelque chose — la même erreur que les octets ajoutés à la fin d'un Mach-O, où `strings`
# ne lit pas ce qui suit le dernier segment.
lancer_les_tests() {
  (cd "$GRADLE" && ./gradlew :coeur-hote:test --rerun-tasks --console=plain -q) >/dev/null 2>&1
}

echec=0

# Vérifie qu'une perturbation fait bien tomber la suite.
#   $1 : ce qu'on perturbe        $2 : le motif à remplacer      $3 : son remplaçant
temoin() {
  local intitule="$1" avant="$2" apres="$3"
  cp "$SAUVEGARDE" "$VECTEURS"
  python3 - "$VECTEURS" "$avant" "$apres" <<'PYTHON'
import sys
chemin, avant, apres = sys.argv[1], sys.argv[2], sys.argv[3]
source = open(chemin, encoding="utf-8").read()
if avant not in source:
    sys.exit(f"motif absent du fichier de vecteurs : {avant!r}")
open(chemin, "w", encoding="utf-8").write(source.replace(avant, apres, 1))
PYTHON
  if lancer_les_tests; then
    echo "  ✗ $intitule — la suite reste VERTE avec un vecteur perturbé"
    echo "    Ce vecteur n'est lu par aucun test, ou le test en garde une copie en dur."
    echec=1
  else
    echo "  ✓ $intitule — la suite tombe, comme elle le doit"
  fi
}

echo "D'abord, la suite doit être verte telle quelle."
cp "$SAUVEGARDE" "$VECTEURS"
if lancer_les_tests; then
  echo "  ✓ suite verte au départ"
else
  echo "  ✗ la suite est déjà rouge sans perturbation — corrigez cela d'abord." >&2
  exit 1
fi

echo
echo "Puis chaque vecteur, perturbé là où le test le lit :"

# §1 — l'empreinte de dérivation. Celle-ci vient du navigateur : si elle bouge, plus
# personne n'ouvre sa session.
temoin "l'empreinte Argon2id (zk_derivation.expected_hex)" \
  '"expected_hex": "7b985d8fa00c9eccccf918c8cb9feaa8036af381caf6f498e099b5b849b8c18a"' \
  '"expected_hex": "0000000000000000000000000000000000000000000000000000000000000000"'

# §2 — l'octet NUL du préfixe de registre. Remplacé par une espace : indiscernable à
# l'œil, et c'est tout le problème.
temoin "l'octet NUL du préfixe de registre (registries.prefix)" \
  '"prefix": "\u0000gp:"' \
  '"prefix": " gp:"'

# §2 — le nom d'un registre.
temoin "le nom du registre des partages (registries.names.shares)" \
  '"shares": "\u0000gp:shares"' \
  '"shares": "\u0000gp:partages"'

# §3 — une couleur de la palette.
temoin "la première couleur de la palette (org_colors.palette[0])" \
  '"#4C8DFF",
      "#B57BFF"' \
  '"#4C8DF0",
      "#B57BFF"'

# §3 — un vecteur d'attribution.
temoin "un vecteur d'attribution de couleur (org_colors.vectors)" \
  '"org_stackops": "#7A8CFF"' \
  '"org_stackops": "#00C2A8"'

# §4 — le piège du suffixe. Le déplacer des refusés vers les acceptés doit faire rougir :
# c'est le cas qui livrerait la clé de déchiffrement à un tiers.
temoin "le piège de suffixe des domaines de partage (share_link_domains.rejected)" \
  '["https://ghostpass.example.com", "https://ghostpass.example.com.attaquant.example/p/abc"]' \
  '["https://ghostpass.example.com", "https://ghostpass.example.com/p/abc"]'

# §4 bis — l'enveloppe de partage. Le chiffré du vecteur croisé vient du **navigateur** :
# le perturber doit faire tomber le test qui vérifie que le cœur l'ouvre. C'est le seul
# témoin de cette classe qui vaille, puisqu'un aller-retour par le cœur seul reste vert
# quel que soit l'algorithme employé des deux côtés.
temoin "le chiffré du vecteur croisé (share_envelope.crossed_vector)" \
  '"ciphertext_b64": "UJCDbjVcfiYfYDM9mCSaLJ1dkpvV8vFzXQ/RugKmkurGUzXj/HrD"' \
  '"ciphertext_b64": "UJCDbjVcfiYfYDM9mCSaLJ1dkpvV8vFzXQ/RugKmkurGUzXj/HrA"'

# §4 bis — la taille du nonce. 24 est celle du coffre, et c'est l'erreur qui a coûté les
# jours : elle est parfaitement valide ailleurs dans le même cœur.
temoin "la taille du nonce de l'enveloppe (share_envelope.nonce_bytes)" \
  '"nonce_bytes": 12,' \
  '"nonce_bytes": 24,'

# Horodatages — l'unité du registre des partages.
temoin "l'écart d'horodatage (timestamps.difference_check)" \
  '"expected_difference_seconds": 86400' \
  '"expected_difference_seconds": 86399'

# Le troisième état de l'ADR-0002 §2 : ne pas avoir pu regarder n'est pas « conforme ».
echo
echo "Enfin, le fichier absent — « pas pu regarder » doit échouer, jamais avertir :"
cp "$SAUVEGARDE" "$VECTEURS"
rm -f "$VECTEURS"
if lancer_les_tests; then
  echo "  ✗ la suite reste VERTE sans vecteurs du tout — elle ne les lit pas."
  echec=1
else
  echo "  ✓ la suite tombe quand les vecteurs manquent"
fi
cp "$SAUVEGARDE" "$VECTEURS"

echo
if [[ $echec -ne 0 ]]; then
  echo "Témoin en échec : au moins un vecteur n'est lu par personne." >&2
  exit 1
fi
echo "Témoin concluant : chaque vecteur perturbé fait tomber la suite."
