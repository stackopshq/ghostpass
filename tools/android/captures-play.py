#!/usr/bin/env python3
"""Produit les cinq captures de la fiche Google Play, dans une langue.

Google Play veut des images 24 bits sans transparence, dont le grand côté ne dépasse pas
deux fois le petit. L'émulateur est donc réglé en 1080 × 1920 : un téléphone ordinaire
rend du 1080 × 2400, qu'il faudrait recadrer après coup — et recadrer, c'est décider
après coup ce qu'on montre.

Rien n'est piloté par les coordonnées : tout passe par l'arbre d'accessibilité, parce que
`FLAG_SECURE` rend toute capture noire tant que la variante `debug` n'a pas reçu l'extra
`captures-de-fiche`, et parce qu'un arbre nomme ce qu'il touche.

    ./captures-play.py fr   # ou en

Suppose un serveur GhostPass amorcé avec le coffre vitrine et l'application installée :
`captures-play.sh` s'occupe des deux.
"""

import re
import subprocess
import sys
import time

SERIE = "emulator-5554"
ADB = ["adb", "-s", SERIE]
PAQUET = "ch.stackops.ghostpass"
SERVEUR = "http://10.0.2.2:3122"
COMPTE = "clara@ghostpass.test"
MOT_DE_PASSE = "correct horse battery staple"

# Les libellés, par langue. L'application suit son propre réglage de langue, pas celui du
# système : un jeu par langue se prend donc sans toucher à l'émulateur.
MOTS = {
    "fr": {
        "langue": "Français", "fini": "Terminé", "menu": "⋯", "fermer": "Fermer",
        "sante": "Santé du coffre", "partage": "Partager un secret", "annuler": "Annuler",
        "nouveau": "Nouveau", "generer": "Générer un mot de passe", "coffre": "Coffre",
        "secret": "Code du local technique : 4821",
    },
    "en": {
        "langue": "English", "fini": "Done", "menu": "⋯", "fermer": "Close",
        "sante": "Vault health", "partage": "Share a secret", "annuler": "Cancel",
        "nouveau": "New", "generer": "Generate a password", "coffre": "Vault",
        "secret": "Server room door code: 4821",
    },
}


def sh(*args):
    return subprocess.run(ADB + list(args), capture_output=True, text=True).stdout


def arbre():
    sh("shell", "uiautomator", "dump", "/sdcard/ui.xml")
    brut = subprocess.run(ADB + ["exec-out", "cat", "/sdcard/ui.xml"], capture_output=True).stdout
    return brut.decode("utf-8", "replace")


def noeuds(xml):
    for m in re.finditer(r"<node[^>]*>", xml):
        yield dict(re.findall(r'(\w[\w-]*)="([^"]*)"', m.group(0)))


def trouver(xml, *, texte=None, id_=None, partiel=False):
    for a in noeuds(xml):
        if texte is not None:
            v = a.get("text", "")
            if (texte in v) if partiel else (v == texte):
                return a
        if id_ is not None and a.get("resource-id", "").endswith(id_):
            return a
    return None


def attendre(**critere):
    """Attend qu'un élément paraisse, et le rend. Les écrans de ce produit déchiffrent
    avant de s'afficher : une attente fixe serait tantôt trop courte, tantôt perdue."""
    for _ in range(40):
        n = trouver(arbre(), **critere)
        if n is not None:
            return n
        time.sleep(1)
    raise SystemExit(f"introuvable : {critere}")


def taper(n):
    x1, y1, x2, y2 = map(int, re.findall(r"\d+", n["bounds"]))
    sh("shell", "input", "tap", str((x1 + x2) // 2), str((y1 + y2) // 2))
    time.sleep(1.4)


def frapper(texte):
    """Caractère par caractère : `input text` en perd sur une saisie longue."""
    for c in texte:
        if c == " ":
            sh("shell", "input", "keyevent", "62")
        else:
            sh("shell", "input", "text", re.sub(r"([()<>|;&*\\~\"'`$])", r"\\\1", c))
        time.sleep(0.12)


def fermer_le_clavier():
    """Le clavier logiciel couvre le bas de l'écran, et un `tap` sur ce qu'il cache appuie
    sur une touche : quatre « y » sont ainsi entrés dans l'adresse de courriel avant qu'on
    ne comprenne. `BACK` le referme ; `ESC` ne le fait pas."""
    sh("shell", "input", "keyevent", "4")
    time.sleep(1.5)


def capture(chemin):
    brut = subprocess.run(ADB + ["exec-out", "screencap", "-p"], capture_output=True).stdout
    open(chemin, "wb").write(brut)
    print(f"  {chemin} — {len(brut)} octets")
    if len(brut) < 40_000:
        raise SystemExit("capture quasi vide : FLAG_SECURE n'a pas été levé")


def se_connecter():
    sh("shell", "am", "force-stop", PAQUET)
    time.sleep(2)
    sh("shell", "am", "start", "-n", f"{PAQUET}/.ActivitePrincipale",
       "--ez", "captures-de-fiche", "true")
    time.sleep(7)
    if trouver(arbre(), id_="field.server") is None:
        # Une session est enregistrée : l'écran ne demande plus que le mot de passe
        # maître. C'est l'état de tous les passages après le premier, et l'oublier
        # laissait le script chercher le menu du coffre sur l'écran de déverrouillage.
        taper(attendre(id_="field.master"))
        frapper(MOT_DE_PASSE)
        fermer_le_clavier()
        taper(attendre(id_="button.submit"))
        time.sleep(10)
        return
    taper(attendre(id_="field.server"))
    frapper(SERVEUR)
    # La tabulation plutôt qu'un `tap` : les champs suivants sont sous le clavier.
    sh("shell", "input", "keyevent", "61")
    time.sleep(0.8)
    frapper(COMPTE)
    sh("shell", "input", "keyevent", "61")
    time.sleep(0.8)
    frapper(MOT_DE_PASSE)
    fermer_le_clavier()
    taper(attendre(id_="button.submit"))
    time.sleep(10)


def choisir_la_langue(mots):
    taper(attendre(texte=mots["menu"]))
    cible = "Settings" if trouver(arbre(), texte="Settings") else "Réglages"
    taper(attendre(texte=cible))
    for _ in range(6):
        n = trouver(arbre(), texte=mots["langue"])
        if n is not None:
            taper(n)
            break
        sh("shell", "input", "swipe", "540", "1500", "540", "600", "400")
        time.sleep(1)
    for _ in range(6):
        n = trouver(arbre(), texte=mots["fini"])
        if n is not None:
            taper(n)
            return
        sh("shell", "input", "swipe", "540", "600", "540", "1500", "300")
        time.sleep(0.8)
    raise SystemExit("impossible de refermer les réglages")


def parcours(langue, sortie):
    mots = MOTS[langue]
    se_connecter()
    choisir_la_langue(mots)
    attendre(texte=mots["coffre"])

    capture(f"{sortie}/01-coffre.png")

    taper(attendre(texte="Gmail"))
    attendre(texte=mots["fermer"])
    capture(f"{sortie}/02-fiche.png")
    taper(attendre(texte=mots["fermer"]))

    taper(attendre(texte=mots["menu"]))
    taper(attendre(texte=mots["sante"]))
    attendre(texte=mots["fermer"])
    capture(f"{sortie}/03-sante.png")
    taper(attendre(texte=mots["fermer"]))

    taper(attendre(texte=mots["menu"]))
    taper(attendre(texte=mots["partage"]))
    taper(attendre(id_="field.sendSecret"))
    frapper(mots["secret"])
    fermer_le_clavier()
    capture(f"{sortie}/04-partage.png")
    taper(attendre(texte=mots["annuler"]))

    taper(attendre(texte=mots["nouveau"]))
    taper(attendre(texte=mots["generer"]))
    attendre(texte=mots["annuler"])
    capture(f"{sortie}/05-generateur.png")
    # Deux feuilles à refermer, le générateur puis la création — mais la seconde peut
    # s'être refermée avec la première selon l'ordre des animations. On ferme ce qui est
    # encore là plutôt que d'exiger les deux : la dernière capture est déjà prise, et
    # échouer ici donnerait à croire que le parcours a raté.
    for _ in range(2):
        n = trouver(arbre(), texte=mots["annuler"])
        if n is None:
            break
        taper(n)


if __name__ == "__main__":
    if len(sys.argv) != 3 or sys.argv[1] not in MOTS:
        raise SystemExit("usage : captures-play.py <fr|en> <répertoire de sortie>")
    parcours(sys.argv[1], sys.argv[2].rstrip("/"))
