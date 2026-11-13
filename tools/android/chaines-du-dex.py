#!/usr/bin/env python3
"""Imprime la table des chaînes d'un fichier `.dex`, une chaîne par ligne.

Utilisé par `verifier-l-autonomie.sh` à la place de `strings -a`, et pour une raison
mesurée : `strings` lit aussi le **code** du `.dex`, et le bytecode contient des suites
d'octets imprimables qui ressemblent à du texte. Sur le premier APK de diffusion construit
en CI (2026-11-13), il a lu `$57.57` dans `classes.dex` — un « prix » qu'aucune chaîne de
l'application ne porte : `dexdump -d` n'en montre aucune trace parmi 18 446 `const-string`.

La table des chaînes, elle, contient tout ce que l'application peut afficher ou nommer —
littéraux, noms de classes, de méthodes et de champs — et rien d'autre. On la lit
directement dans l'en-tête, sans dépendre d'un outil du SDK.

Format (https://source.android.com/docs/core/runtime/dex-format) : `string_ids_size` et
`string_ids_off` sont aux octets 0x38 et 0x3C ; chaque entrée pointe vers une longueur en
ULEB128 suivie de MUTF-8 terminé par un octet nul.
"""

import struct
import sys


def lire_uleb128(donnees: bytes, pos: int) -> int:
    """Retourne la position qui suit l'entier ULEB128 commençant à `pos`."""
    while donnees[pos] & 0x80:
        pos += 1
    return pos + 1


def chaines(donnees: bytes) -> list[str]:
    if donnees[:4] != b"dex\n":
        raise ValueError("pas un fichier dex")
    taille, decalage = struct.unpack_from("<II", donnees, 0x38)
    resultat = []
    for i in range(taille):
        (debut,) = struct.unpack_from("<I", donnees, decalage + 4 * i)
        pos = lire_uleb128(donnees, debut)
        fin = donnees.index(b"\x00", pos)
        # MUTF-8 : assez proche d'UTF-8 pour une recherche de motifs ; les rares séquences
        # propres au format (nul encodé, paires de substitution) deviennent U+FFFD.
        texte = donnees[pos:fin].decode("utf-8", errors="replace")
        # Une chaîne par ligne : un saut de ligne interne couperait un motif en deux.
        resultat.append(texte.replace("\n", " ").replace("\r", " "))
    return resultat


def main() -> int:
    if len(sys.argv) != 2:
        print(f"usage : {sys.argv[0]} fichier.dex", file=sys.stderr)
        return 2
    with open(sys.argv[1], "rb") as f:
        donnees = f.read()
    sortie = sys.stdout
    for texte in chaines(donnees):
        sortie.write(texte + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
