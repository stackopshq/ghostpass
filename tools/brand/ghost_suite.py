#!/usr/bin/env python3
"""Générateur de la charte ghost-suite.

Les produits de la suite partagent une même silhouette de fantôme ; seuls le glyphe
qu'elle porte et ses trois teintes les distinguent. Ce script tient cette silhouette une
fois pour toutes et en tire, pour chaque produit, les deux variantes de la charte :

  logo  — la silhouette au trait, avec ses trois tirets détachés. Le trait fait 4 % de la
          hauteur et disparaît en dessous de 16 px ; c'est la variante des en-têtes.
  icone — la même courbe refermée et remplie, le glyphe découpé en creux, cadrée au carré.
          C'est la variante des favicons et des icônes d'application, qui tient petit.

Usage :
    python3 tools/brand/ghost_suite.py ghostpass          # écrit les deux SVG
    python3 tools/brand/ghost_suite.py --liste            # produits déclarés

Les SVG produits sont des *sorties* : on ne les retouche pas à la main, on change la
déclaration du produit ici et on régénère. C'est ce qui permet à un changement de teinte
de rester une opération d'une ligne.
"""

from __future__ import annotations

import argparse
import sys
from dataclasses import dataclass
from pathlib import Path

# ─── Ce qui est commun à toute la suite ───────────────────────────────────────

# La silhouette, en coordonnées d'un cadre 421 × 548. Tracé ouvert : la variante logo le
# caresse au trait, la variante icône le referme et le remplit.
SILHOUETTE = 'M 240.0 9.0 C 245.3 9.3 262.5 9.7 272.0 11.0 C 281.5 12.3 288.0 13.8 297.0 17.0 C 306.0 20.2 317.8 25.7 326.0 30.0 C 334.2 34.3 338.5 36.8 346.0 43.0 C 353.5 49.2 365.2 60.8 371.0 67.0 C 376.8 73.2 377.0 73.5 381.0 80.0 C 385.0 86.5 390.8 96.2 395.0 106.0 C 399.2 115.8 403.5 129.0 406.0 139.0 C 408.5 149.0 409.3 154.0 410.0 166.0 C 410.7 178.0 410.8 195.8 410.0 211.0 C 409.2 226.2 407.0 244.0 405.0 257.0 C 403.0 270.0 401.2 277.5 398.0 289.0 C 394.8 300.5 391.0 313.2 386.0 326.0 C 381.0 338.8 374.7 353.0 368.0 366.0 C 361.3 379.0 354.8 390.8 346.0 404.0 C 337.2 417.2 322.2 436.2 315.0 445.0 C 307.8 453.8 308.0 454.0 303.0 457.0 C 298.0 460.0 290.7 462.5 285.0 463.0 C 279.3 463.5 273.7 462.0 269.0 460.0 C 264.3 458.0 259.7 453.8 257.0 451.0 C 254.3 448.2 253.8 446.5 253.0 443.0 C 252.2 439.5 251.5 434.3 252.0 430.0 C 252.5 425.7 253.0 422.3 256.0 417.0 C 259.0 411.7 267.2 403.2 270.0 398.0 C 272.8 392.8 272.7 389.7 273.0 386.0 C 273.3 382.3 272.7 378.8 272.0 376.0 C 271.3 373.2 271.2 371.5 269.0 369.0 C 266.8 366.5 263.7 362.3 259.0 361.0 C 254.3 359.7 244.8 360.5 241.0 361.0 C 237.2 361.5 238.5 361.7 236.0 364.0 C 233.5 366.3 234.0 363.0 226.0 375.0 C 218.0 387.0 199.5 419.3 188.0 436.0 C 176.5 452.7 164.3 466.3 157.0 475.0 C 149.7 483.7 147.8 484.8 144.0 488.0 C 140.2 491.2 137.2 492.7 134.0 494.0 C 130.8 495.3 129.2 495.8 125.0 496.0 C 120.8 496.2 113.2 495.8 109.0 495.0 C 104.8 494.2 102.5 492.7 100.0 491.0 C 97.5 489.3 95.7 487.3 94.0 485.0 C 92.3 482.7 90.7 482.0 90.0 477.0 C 89.3 472.0 88.7 461.0 90.0 455.0 C 91.3 449.0 92.5 447.8 98.0 441.0 C 103.5 434.2 116.5 421.8 123.0 414.0 C 129.5 406.2 134.0 400.2 137.0 394.0 C 140.0 387.8 141.2 382.5 141.0 377.0 C 140.8 371.5 138.3 364.8 136.0 361.0 C 133.7 357.2 131.5 355.2 127.0 354.0 C 122.5 352.8 113.8 352.7 109.0 354.0 C 104.2 355.3 101.8 357.7 98.0 362.0 C 94.2 366.3 89.3 375.7 86.0 380.0 C 82.7 384.3 81.0 385.5 78.0 388.0 C 75.0 390.5 71.8 393.0 68.0 395.0 C 64.2 397.0 60.5 399.0 55.0 400.0 C 49.5 401.0 40.0 401.2 35.0 401.0 C 30.0 400.8 28.5 400.7 25.0 399.0 C 21.5 397.3 16.5 394.0 14.0 391.0 C 11.5 388.0 10.7 384.5 10.0 381.0 C 9.3 377.5 9.3 373.7 10.0 370.0 C 10.7 366.3 11.2 363.0 14.0 359.0 C 16.8 355.0 22.0 351.8 27.0 346.0 C 32.0 340.2 38.8 332.0 44.0 324.0 C 49.2 316.0 54.0 306.5 58.0 298.0 C 62.0 289.5 65.0 282.0 68.0 273.0 C 71.0 264.0 74.0 253.2 76.0 244.0 C 78.0 234.8 78.8 233.3 80.0 218.0 C 81.2 202.7 82.0 165.5 83.0 152.0 C 84.0 138.5 84.5 143.2 86.0 137.0 C 87.5 130.8 88.3 123.8 92.0 115.0 C 95.7 106.2 102.8 92.5 108.0 84.0 C 113.2 75.5 118.2 69.7 123.0 64.0 C 127.8 58.3 130.8 55.2 137.0 50.0 C 143.2 44.8 150.3 38.5 160.0 33.0 C 169.7 27.5 185.0 20.7 195.0 17.0 C 205.0 13.3 212.7 12.2 220.0 11.0 C 227.3 9.8 235.8 10.2 239.0 10.0'

# Les trois tirets détachés qui accompagnent la silhouette dans la variante logo. Ils
# disparaissent de la variante icône, où ils deviendraient des salissures à 16 px.
TIRETS = 'M 201.0 509.0 L 227.0 478.0 M 38.0 537.0 L 63.0 508.0 M 50.0 442.0 L 26.0 470.0'

LARGEUR, HAUTEUR = 421, 548
EPAISSEUR = 22  # 4 % de la hauteur


@dataclass(frozen=True)
class Produit:
    """Un produit de la suite : son nom, ses trois teintes, son glyphe.

    `glyphe_trait` est dessiné au trait par-dessus la silhouette (variante logo) ;
    `glyphe_plein` est découpé en creux dans la silhouette remplie (variante icône).
    Les deux décrivent la même figure, dans les deux techniques que réclament les deux
    variantes — un tracé au trait ne se remplit pas, et l'inverse non plus.
    """

    nom: str
    claire: str
    primaire: str
    profonde: str
    glyphe_trait: str
    # `None` quand aucune variante icône n'a été publiée pour ce produit : on ne devine
    # pas un glyphe plein à partir d'un glyphe au trait.
    glyphe_plein: str | None


PRODUITS = {
    "ghostpass": Produit(
        nom="GhostPass",
        claire="#9CC3FF",
        primaire="#2E7DFF",
        profonde="#143F8F",
        # Une clé : l'anneau, la tige, et deux dents.
        glyphe_trait='<circle cx="214" cy="187" r="26"/>\n      <path d="M 240 187 L 336 187"/>\n      <path d="M 310 187 L 310 213"/>\n      <path d="M 334 187 L 334 207"/>',
        glyphe_plein='M 142 196 A 48 48 0 1 0 238 196 A 48 48 0 1 0 142 196 Z M 170 196 A 20 20 0 1 0 210 196 A 20 20 0 1 0 170 196 Z M 243 181 H 325 A 15 15 0 0 1 340 196 V 196 A 15 15 0 0 1 325 211 H 243 A 15 15 0 0 1 228 196 V 196 A 15 15 0 0 1 243 181 Z M 298 205 H 298 A 12 12 0 0 1 310 217 V 235 A 12 12 0 0 1 298 247 H 298 A 12 12 0 0 1 286 235 V 217 A 12 12 0 0 1 298 205 Z M 328 205 H 328 A 12 12 0 0 1 340 217 V 225 A 12 12 0 0 1 328 237 H 328 A 12 12 0 0 1 316 225 V 217 A 12 12 0 0 1 328 205 Z',
    ),
    "ghostauth": Produit(
        nom="GhostAuth",
        claire="#FFA05C",
        primaire="#FF6A00",
        profonde="#A34400",
        # Orange à 25°, dans le plus large intervalle libre restant — 55° de ghostlink
        # (330°) et 29° de ghostmail (54°). Son `brand.css` déclare #00E6A8, un vert d'eau :
        # comme le logo de ghostboard, ce fichier a dérivé et devra suivre.
        #
        # Un bouclier portant une coche. La clé de ghostpass dit « un secret que tu
        # détiens » ; l'authentification dit « on a vérifié qui tu es » — c'est un verdict,
        # pas un objet. Aucun autre glyphe de la suite ne l'occupe, et il tient à 16 px là
        # où un trousseau ou une empreinte se brouillent.
        glyphe_trait='<path d="M 192 150 L 260 132 L 328 150 L 328 192 A 88 88 0 0 1 260 252 A 88 88 0 0 1 192 192 Z"/>\n      <path d="M 226 190 L 250 216 L 298 164"/>',
        # Bouclier plein, coche découpée en creux : au contour, il se refermerait en tache.
        glyphe_plein='M 175.0 140.0 L 260.0 117.5 L 345.0 140.0 L 345.0 192.5 A 110.0 110.0 0 0 1 260.0 267.5 A 110.0 110.0 0 0 1 175.0 192.5 Z M 207.4 199.4 L 247.5 242.8 L 317.6 166.9 L 297.4 148.1 L 247.5 202.2 L 227.6 180.6 Z',
    ),
    "ghostbit": Produit(
        nom="GhostBit",
        claire="#F050FF",
        primaire="#A93BFF",
        profonde="#6C1BD8",
        glyphe_trait='<path d="M 224 138 L 188 178 L 222 220"/>\n      <path d="M 295 138 L 332 180 L 295 222"/>',
        glyphe_plein='M 250 122 L 190 180 L 250 238 L 222 238 L 162 180 L 222 122 Z M 268 122 L 328 180 L 268 238 L 296 238 L 356 180 L 296 122 Z',
    ),
    "ghostmon": Produit(
        nom="GhostMon",
        claire="#CFFF5E",
        primaire="#A3FF00",
        profonde="#5BC800",
        glyphe_trait='<path d="M 198 224 L 198 186"/>\n      <path d="M 260 224 L 260 158"/>\n      <path d="M 322 224 L 322 134"/>',
        glyphe_plein='M 168.7 198.8 A 13.8 13.8 0 0 1 196.3 198.8 L 196.3 218.7 A 13.8 13.8 0 0 1 168.7 218.7 Z M 246.2 163.8 A 13.8 13.8 0 0 1 273.8 163.8 L 273.8 218.7 A 13.8 13.8 0 0 1 246.2 218.7 Z M 323.7 133.8 A 13.8 13.8 0 0 1 351.3 133.8 L 351.3 218.7 A 13.8 13.8 0 0 1 323.7 218.7 Z',
    ),
    "ghostboard": Produit(
        nom="GhostBoard",
        claire="#5CFF7F",
        primaire="#00FF37",
        profonde="#00A323",
        # Vert à 133°, décidé après avoir constaté que le logo publié (#3D7BFF) et le
        # `style.css` (#FF6B1A) se contredisaient — et qu'aucune des deux teintes n'allait :
        # le bleu se confondait avec ghostpass à quatre points près, l'orange est pris.
        # 133° tombe dans le plus large intervalle libre de la suite : 51° de ghostmon (82°)
        # et 31° de ghostauth (164°).
        #
        # Ce script ne reproduit donc plus le logo publié de ghostboard : c'est le logo qui
        # doit être régénéré, pas cette déclaration qui doit revenir en arrière.
        glyphe_trait='<path d="M 200 136 L 236 136 A 14 14 0 0 1 250 150 L 250 172 A 14 14 0 0 1 236 186 L 200 186 A 14 14 0 0 1 186 172 L 186 150 A 14 14 0 0 1 200 136 Z"/>\n      <path d="M 282 136 L 318 136 A 14 14 0 0 1 332 150 L 332 172 A 14 14 0 0 1 318 186 L 282 186 A 14 14 0 0 1 268 172 L 268 150 A 14 14 0 0 1 282 136 Z"/>\n      <path d="M 200 196 L 236 196 A 14 14 0 0 1 250 210 L 250 232 A 14 14 0 0 1 236 246 L 200 246 A 14 14 0 0 1 186 232 L 186 210 A 14 14 0 0 1 200 196 Z"/>\n      <path d="M 282 196 L 318 196 A 14 14 0 0 1 332 210 L 332 232 A 14 14 0 0 1 318 246 L 282 246 A 14 14 0 0 1 268 232 L 268 210 A 14 14 0 0 1 282 196 Z"/>',
        glyphe_plein='M 185.0 122.5 L 230.0 122.5 A 17.5 17.5 0 0 1 247.5 140.0 L 247.5 167.5 A 17.5 17.5 0 0 1 230.0 185.0 L 185.0 185.0 A 17.5 17.5 0 0 1 167.5 167.5 L 167.5 140.0 A 17.5 17.5 0 0 1 185.0 122.5 Z M 287.5 122.5 L 332.5 122.5 A 17.5 17.5 0 0 1 350.0 140.0 L 350.0 167.5 A 17.5 17.5 0 0 1 332.5 185.0 L 287.5 185.0 A 17.5 17.5 0 0 1 270.0 167.5 L 270.0 140.0 A 17.5 17.5 0 0 1 287.5 122.5 Z M 185.0 197.5 L 230.0 197.5 A 17.5 17.5 0 0 1 247.5 215.0 L 247.5 242.5 A 17.5 17.5 0 0 1 230.0 260.0 L 185.0 260.0 A 17.5 17.5 0 0 1 167.5 242.5 L 167.5 215.0 A 17.5 17.5 0 0 1 185.0 197.5 Z M 287.5 197.5 L 332.5 197.5 A 17.5 17.5 0 0 1 350.0 215.0 L 350.0 242.5 A 17.5 17.5 0 0 1 332.5 260.0 L 287.5 260.0 A 17.5 17.5 0 0 1 270.0 242.5 L 270.0 215.0 A 17.5 17.5 0 0 1 287.5 197.5 Z',
    ),
    "ghostlink": Produit(
        nom="GhostLink",
        claire="#FF8FC6",
        primaire="#FF2D95",
        profonde="#B00A5E",
        glyphe_trait='<path d="M 212 206 L 244 174 A 30 30 0 0 1 286 216 L 254 248 A 30 30 0 0 1 212 206 Z"/>\n      <path d="M 236 144 L 268 112 A 30 30 0 0 1 310 154 L 278 186 A 30 30 0 0 1 236 144 Z"/>',
        glyphe_plein='M 200.0 210.0 L 240.0 170.0 A 37.5 37.5 0 0 1 292.5 222.5 L 252.5 262.5 A 37.5 37.5 0 0 1 200.0 210.0 Z M 213.8 223.8 L 253.8 183.8 A 9.9 9.9 0 0 1 278.7 208.7 L 238.7 248.7 A 9.9 9.9 0 0 1 213.8 223.8 Z M 230.0 132.5 L 270.0 92.5 A 37.5 37.5 0 0 1 322.5 145.0 L 282.5 185.0 A 37.5 37.5 0 0 1 230.0 132.5 Z M 243.8 146.3 L 283.8 106.3 A 9.9 9.9 0 0 1 308.7 131.2 L 268.7 171.2 A 9.9 9.9 0 0 1 243.8 146.3 Z',
    ),
    "ghostcal": Produit(
        nom="GhostCal",
        claire="#9CFBFF",
        primaire="#00F0FF",
        profonde="#0E8FA8",
        glyphe_trait='<path d="M 194 152 L 326 152 A 14 14 0 0 1 340 166 L 340 212 A 14 14 0 0 1 326 226 L 194 226 A 14 14 0 0 1 180 212 L 180 166 A 14 14 0 0 1 194 152 Z"/>\n      <path d="M 180 182 L 340 182"/>\n      <path d="M 216 134 L 216 158"/>\n      <path d="M 304 134 L 304 158"/>',
        glyphe_plein='M 164 140 L 356 140 L 356 174 L 164 174 Z M 164 192 L 356 192 L 356 268 L 164 268 Z M 190 112 L 216 112 L 216 156 L 190 156 Z M 304 112 L 330 112 L 330 156 L 304 156 Z',
    ),
    "ghostmail": Produit(
        nom="GhostMail",
        claire="#FFF48A",
        primaire="#FFE500",
        profonde="#D9A800",
        glyphe_trait='<path d="M 194 146 L 326 146 A 14 14 0 0 1 340 160 L 340 214 A 14 14 0 0 1 326 228 L 194 228 A 14 14 0 0 1 180 214 L 180 160 A 14 14 0 0 1 194 146 Z"/>\n      <path d="M 186 154 L 260 208 L 334 154"/>',
        glyphe_plein='M 160 138 L 360 138 L 260 226 Z M 160 170 L 160 268 L 360 268 L 360 170 L 260 254 Z',
    ),
}

# La suite est complète : sept produits, sept teintes, sept glyphes. Ceux de ghostbit,
# ghostcal, ghostmail, ghostmon, ghostboard et ghostlink ont été relevés sur leurs logos
# publiés ; celui de ghostauth a été composé ici, faute de tracé publié.


# ─── Rendu ────────────────────────────────────────────────────────────────────


def indente(tracé: str, marge: str = "    ") -> str:
    """Aligne un bloc de tracés sur l'indentation du SVG produit."""
    return "\n".join(marge + l.strip() for l in tracé.strip().split("\n"))


def degrade(produit: Produit) -> str:
    """Le dégradé diagonal de la charte : claire en haut à droite, profonde en bas à gauche."""
    return (
        f'  <defs>\n'
        f'    <linearGradient id="g" x1="{LARGEUR}" y1="0" x2="0" y2="{HAUTEUR}"'
        f' gradientUnits="userSpaceOnUse">\n'
        f'      <stop offset="0" stop-color="{produit.claire}"/>\n'
        f'      <stop offset="0.5" stop-color="{produit.primaire}"/>\n'
        f'      <stop offset="1" stop-color="{produit.profonde}"/>\n'
        f'    </linearGradient>\n'
        f'  </defs>'
    )


def logo(produit: Produit) -> str:
    """La silhouette au trait, ses tirets, et le glyphe par-dessus."""
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {LARGEUR} {HAUTEUR}" fill="none">
  <!-- Charte ghost-suite, variante logo — produit par tools/brand/ghost_suite.py.
       Ne pas retoucher : régénérer. -->
{degrade(produit)}
  <g stroke="url(#g)" stroke-width="{EPAISSEUR}" stroke-linecap="round" stroke-linejoin="round">
    <path d="{SILHOUETTE}"/>
    <path d="{TIRETS}"/>
  </g>
  <g stroke="url(#g)" stroke-width="{EPAISSEUR}" stroke-linecap="round" stroke-linejoin="round"
     opacity="0.92">
{indente(produit.glyphe_trait)}
  </g>
</svg>
"""


def icone(produit: Produit) -> str:
    """La même courbe, refermée et remplie, le glyphe en creux, cadrée au carré.

    Le cadre passe de 421 × 548 à 548 × 548 : on écarte le viewBox de part et d'autre
    plutôt que de déformer la silhouette.
    """
    if produit.glyphe_plein is None:
        raise ValueError(
            f"{produit.nom} n'a pas de glyphe plein : la variante icône ne peut pas être"
            " produite sans lui, et l'approcher donnerait un logo faux."
        )
    marge = (HAUTEUR - LARGEUR) / 2
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="{-marge} 0 {HAUTEUR} {HAUTEUR}" fill="none">
  <!-- Charte ghost-suite, variante icône — produit par tools/brand/ghost_suite.py.
       La silhouette pleine, sans les tirets détachés : ils deviendraient des salissures
       à 16 px, alors que la silhouette, elle, tient. Ne pas retoucher : régénérer. -->
{degrade(produit)}
  <path fill="url(#g)" fill-rule="evenodd" clip-rule="evenodd"
        d="{SILHOUETTE} Z {produit.glyphe_plein}"/>
</svg>
"""


def verifier(repertoire: Path) -> int:
    """Les SVG du dépôt sont-ils bien ce que ce script produit ?

    Un générateur qui a dérivé de ses propres sorties ne sert plus à rien : on croit tenir
    la source, on tient un fichier écrit à la main à côté d'un script qui dit autre chose.
    Cette vérification ne demande pas le réseau et tient en une seconde.
    """
    import re

    def normalise(svg: str) -> str:
        return re.sub(r"\s+", " ", re.sub(r"<!--.*?-->", "", svg, flags=re.S)).strip()

    ecarts = []
    for cle, produit in sorted(PRODUITS.items()):
        variantes = [("brand", logo(produit))]
        if produit.glyphe_plein is not None:
            variantes.append(("icon", icone(produit)))
        for suffixe, attendu in variantes:
            chemin = repertoire / f"{cle}-{suffixe}.svg"
            if not chemin.exists():
                continue  # seuls les produits dont le dépôt porte les SVG sont comparés
            if normalise(chemin.read_text(encoding="utf-8")) != normalise(attendu):
                ecarts.append(chemin.name)
            else:
                print(f"{chemin.name:28} conforme")

    if ecarts:
        print(f"\nont dérivé : {', '.join(ecarts)}", file=sys.stderr)
        return 1
    print("\nLes SVG du dépôt sont bien ceux que ce script produit.")
    return 0


def main() -> int:
    analyseur = argparse.ArgumentParser(description=__doc__)
    analyseur.add_argument("produit", nargs="?", help="nom du produit à générer")
    analyseur.add_argument("--liste", action="store_true", help="produits déclarés")
    analyseur.add_argument(
        "--verifier",
        action="store_true",
        help="régénère et compare aux SVG du dépôt, sans rien écrire",
    )
    analyseur.add_argument(
        "--sortie", type=Path, default=Path(__file__).parent, help="répertoire de sortie"
    )
    args = analyseur.parse_args()

    if args.verifier:
        return verifier(args.sortie)

    if args.liste or not args.produit:
        for cle, p in sorted(PRODUITS.items()):
            print(f"{cle:12} {p.nom:12} {p.primaire}")
        return 0

    produit = PRODUITS.get(args.produit)
    if produit is None:
        connus = ", ".join(sorted(PRODUITS))
        print(f"produit inconnu : {args.produit} (connus : {connus})", file=sys.stderr)
        return 1

    args.sortie.mkdir(parents=True, exist_ok=True)
    variantes = [("brand", logo(produit))]
    try:
        variantes.append(("icon", icone(produit)))
    except ValueError as refus:
        print(f"variante icône non produite — {refus}", file=sys.stderr)

    for suffixe, contenu in variantes:
        chemin = args.sortie / f"{args.produit}-{suffixe}.svg"
        chemin.write_text(contenu, encoding="utf-8")
        print(f"écrit {chemin}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
