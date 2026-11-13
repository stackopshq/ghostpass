#!/usr/bin/env python3
"""Retire le canal alpha d'un PNG, sur place.

Google Play exige des captures « 24 bits, sans transparence ». `adb exec-out screencap -p`
rend toujours du RGBA — type de couleur 6 —, même quand toutes les valeurs alpha valent
255 : c'est le type déclaré qui compte, pas le contenu. Le fichier est donc réécrit en
type 2, trois octets par pixel.

Aucune dépendance : ni Pillow ni ImageMagick ne sont installés sur la machine de prise de
vue, et en ajouter une pour un changement d'en-tête serait disproportionné.

    ./png-sans-alpha.py capture.png [autre.png …]
"""

import struct
import sys
import zlib


def morceaux(donnees):
    """Les chunks d'un PNG, dans l'ordre, après la signature."""
    i = 8
    while i < len(donnees):
        (taille,) = struct.unpack(">I", donnees[i : i + 4])
        nom = donnees[i + 4 : i + 8]
        corps = donnees[i + 8 : i + 8 + taille]
        yield nom, corps
        i += 8 + taille + 4


def chunk(nom, corps):
    return (
        struct.pack(">I", len(corps))
        + nom
        + corps
        + struct.pack(">I", zlib.crc32(nom + corps) & 0xFFFFFFFF)
    )


def defiltrer(brut, largeur, hauteur, canaux):
    """Défait les cinq filtres de ligne du PNG et rend les pixels bruts."""
    pas = largeur * canaux
    sortie = bytearray()
    precedente = bytearray(pas)
    i = 0
    for _ in range(hauteur):
        filtre = brut[i]
        i += 1
        ligne = bytearray(brut[i : i + pas])
        i += pas
        for x in range(pas):
            a = ligne[x - canaux] if x >= canaux else 0
            b = precedente[x]
            c = precedente[x - canaux] if x >= canaux else 0
            if filtre == 1:
                ligne[x] = (ligne[x] + a) & 0xFF
            elif filtre == 2:
                ligne[x] = (ligne[x] + b) & 0xFF
            elif filtre == 3:
                ligne[x] = (ligne[x] + (a + b) // 2) & 0xFF
            elif filtre == 4:
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                pred = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                ligne[x] = (ligne[x] + pred) & 0xFF
        sortie += ligne
        precedente = ligne
    return sortie


def sans_alpha(chemin):
    donnees = open(chemin, "rb").read()
    if donnees[:8] != b"\x89PNG\r\n\x1a\n":
        raise SystemExit(f"{chemin} n'est pas un PNG")

    entete, pixels = None, bytearray()
    for nom, corps in morceaux(donnees):
        if nom == b"IHDR":
            entete = corps
        elif nom == b"IDAT":
            pixels += corps
    largeur, hauteur, profondeur, couleur = struct.unpack(">IIBB", entete[:10])
    if couleur == 2:
        return False  # déjà sans alpha
    if (couleur, profondeur) != (6, 8):
        raise SystemExit(f"{chemin} : seul le RGBA 8 bits est traité (type {couleur})")

    plats = defiltrer(zlib.decompress(bytes(pixels)), largeur, hauteur, 4)
    rgb = bytearray()
    for y in range(hauteur):
        rgb.append(0)  # filtre « aucun » : la recompression s'en charge
        base = y * largeur * 4
        for x in range(largeur):
            p = base + x * 4
            rgb += plats[p : p + 3]

    nouvel_entete = struct.pack(">IIBB", largeur, hauteur, 8, 2) + entete[10:]
    sortie = bytearray(b"\x89PNG\r\n\x1a\n")
    sortie += chunk(b"IHDR", nouvel_entete)
    sortie += chunk(b"IDAT", zlib.compress(bytes(rgb), 9))
    sortie += chunk(b"IEND", b"")
    open(chemin, "wb").write(sortie)
    return True


if __name__ == "__main__":
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    for chemin in sys.argv[1:]:
        print(f"{chemin} : {'aplati' if sans_alpha(chemin) else 'déjà sans alpha'}")
