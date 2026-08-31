#!/usr/bin/env bash
# Le témoin **croisé** de l'enveloppe de partage : le cœur Rust d'un côté, WebCrypto de
# l'autre.
#
#   tools/android/temoin-du-partage-croise.sh
#
# ─── Pourquoi croisé, et pourquoi rien d'autre ne vaut ───
#
# `contrat.json`, bloc `share_envelope`, le dit sans détour : « un témoin qui vérifie qu'un
# côté se relit lui-même passe au vert dans le monde cassé ». C'est le piège central de
# cette classe de défaut. Sceller puis rouvrir avec la **même** implémentation réussit
# aussi bien en XChaCha20 qu'en AES-GCM — le test est vert, et aucun partage ne traverse.
#
# C'est ce qui est arrivé : le cœur produisait un nonce de 24 octets, le relais refusait
# « expected 12 bytes after decode, got 24 », le serveur traduisait en 502, et l'application
# mobile ne pouvait créer aucun partage. Plusieurs jours.
#
# Ce témoin fait donc les **deux** traversées :
#
#   1. le cœur scelle       → WebCrypto ouvre     (un partage créé sur mobile s'ouvre
#                                                  dans le navigateur du destinataire)
#   2. WebCrypto scelle     → le cœur ouvre       (un partage créé sur le web s'ouvre
#                                                  dans l'application)
#
# WebCrypto, et non la bibliothèque `crypto` de Node : c'est **exactement** l'API que le
# navigateur exécutera. `node:crypto` aurait été une troisième implémentation, ce qui est
# déjà mieux qu'une seule, mais pas celle qui décide.
#
# ─── Et il doit savoir tomber ───
#
# Une troisième traversée, volontairement fausse, vérifie que ce script sait rougir : on
# donne à WebCrypto le nonce du **coffre** (24 octets) et l'ouverture doit échouer. Sans
# elle, on ne saurait pas si les deux premières mesurent quelque chose.
set -euo pipefail

PRODUIT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
GRADLE="$PRODUIT/apps/android"
: "${JAVA_HOME:=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home}"
export JAVA_HOME

command -v node >/dev/null || { echo "node introuvable — nécessaire pour WebCrypto." >&2; exit 1; }

CLAIR="un mot de passe partage"
echec=0

# **`--args` est une seule chaîne que Gradle redécoupe aux espaces.** Le premier jet passait
# « sceller un mot de passe partage » : le cœur ne scellait que « un », et le témoin
# accusait l'enveloppe d'une divergence qui n'existait pas — direction 1 rouge, direction 2
# verte, ce qui n'a aucun sens pour un même algorithme. C'est l'asymétrie qui a mis sur la
# piste. On entoure donc chaque argument de quotes simples, pour le shell de Gradle.
coeur() {
  local assemble=""
  for a in "$@"; do assemble+="'${a//\'/\'\\\'\'}' "; done
  (cd "$GRADLE" && ./gradlew :coeur-hote:partageCroise --console=plain -q "--args=$assemble")
}

# WebCrypto, tel qu'un navigateur l'exécute. Tout arrive et repart en base64 standard.
webcrypto() {
  node --input-type=module -e '
    const [action, a, b, c] = process.argv.slice(1);
    const { webcrypto } = await import("node:crypto");
    const d = (s) => Buffer.from(s, "base64");
    const e = (u) => Buffer.from(u).toString("base64");

    if (action === "ouvrir") {
      const cle = await webcrypto.subtle.importKey("raw", d(a), "AES-GCM", false, ["decrypt"]);
      // Le tag est **collé au chiffré**, comme le dit le contrat : WebCrypto attend
      // exactement cette disposition, et le cœur la produit.
      const clair = await webcrypto.subtle.decrypt(
        { name: "AES-GCM", iv: d(b) }, cle, d(c));
      process.stdout.write(Buffer.from(clair).toString("utf8"));
    } else if (action === "sceller") {
      const brut = webcrypto.getRandomValues(new Uint8Array(32));
      const nonce = webcrypto.getRandomValues(new Uint8Array(12));
      const cle = await webcrypto.subtle.importKey("raw", brut, "AES-GCM", false, ["encrypt"]);
      const chiffre = await webcrypto.subtle.encrypt(
        { name: "AES-GCM", iv: nonce }, cle, new TextEncoder().encode(a));
      process.stdout.write(JSON.stringify(
        { key: e(brut), nonce: e(nonce), ciphertext: e(new Uint8Array(chiffre)) }));
    }
  ' "$@"
}

champ() { python3 -c "import json,sys; print(json.load(sys.stdin)['$1'])"; }

echo "== 1. Le cœur scelle, WebCrypto ouvre =="
SCELLE="$(coeur sceller "$CLAIR")"
K="$(echo "$SCELLE" | champ key)"; N="$(echo "$SCELLE" | champ nonce)"; C="$(echo "$SCELLE" | champ ciphertext)"
echo "  · nonce de $(python3 -c "import base64;print(len(base64.b64decode('$N')))") octets, clé de $(python3 -c "import base64;print(len(base64.b64decode('$K')))") octets"
if RETOUR="$(webcrypto ouvrir "$K" "$N" "$C" 2>/dev/null)" && [[ "$RETOUR" == "$CLAIR" ]]; then
  echo "  ✓ un partage créé par l'application s'ouvre dans un navigateur"
else
  echo "  ✗ WebCrypto n'ouvre pas ce que le cœur a scellé." >&2
  echo "    C'est exactement le défaut qui a rendu le partage mobile impossible." >&2
  echec=1
fi

echo
echo "== 2. WebCrypto scelle, le cœur ouvre =="
SCELLE2="$(webcrypto sceller "$CLAIR")"
K2="$(echo "$SCELLE2" | champ key)"; N2="$(echo "$SCELLE2" | champ nonce)"; C2="$(echo "$SCELLE2" | champ ciphertext)"
if RETOUR2="$(coeur ouvrir "$K2" "$N2" "$C2" 2>/dev/null)" && [[ "$RETOUR2" == "$CLAIR" ]]; then
  echo "  ✓ un partage créé sur le web s'ouvre dans l'application"
else
  echo "  ✗ le cœur n'ouvre pas ce que WebCrypto a scellé." >&2
  echec=1
fi

echo
echo "== 3. Le contrôle : le nonce du coffre doit échouer =="
# 24 octets — celui de XChaCha20, parfaitement valide ailleurs dans le même cœur. Si cette
# traversée réussissait, les deux précédentes ne mesureraient pas la taille du nonce.
NONCE24="$(python3 -c "import base64;print(base64.b64encode(bytes(24)).decode())")"
if webcrypto ouvrir "$K" "$NONCE24" "$C" >/dev/null 2>&1; then
  echo "  ✗ WebCrypto a ouvert avec un nonce de 24 octets — ce témoin ne mesure rien." >&2
  echec=1
else
  echo "  ✓ refusé, comme il se doit : ce témoin sait tomber"
fi

echo
if [[ $echec -ne 0 ]]; then
  echo "Témoin en échec : les deux côtés ne parlent pas la même enveloppe." >&2
  exit 1
fi
echo "Témoin concluant : l'enveloppe de partage traverse dans les deux sens, et le nonce du"
echo "coffre est bien refusé."
