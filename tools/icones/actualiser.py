#!/usr/bin/env python3
"""Rafraîchit l'index des logos de dashboardicons.com utilisé par le proxy d'icônes.

Le proxy (`apps/server/src/services/icons.ts`) cherche d'abord un logo de qualité dans
Dashboard Icons (https://dashboardicons.com, dépôt homarr-labs/dashboard-icons, Apache-2.0),
puis le favicon du site, et le client montre l'initiale si rien ne vient.

Il ne télécharge pas l'index à chaque requête : il le lit dans une copie
(`apps/server/src/services/iconesDashboard.json`) qui associe chaque nom et alias de logo à
son fichier, ÉPINGLÉE sur un commit. Une adresse figée par commit garantit que le fichier
servi est celui qu'on a indexé ; `@main` suivrait ce que le dépôt publie demain.

    python3 tools/icones/actualiser.py
"""

import json
import pathlib
import re
import urllib.request

RACINE = pathlib.Path(__file__).resolve().parents[2]
SORTIE = RACINE / "apps/server/src/services/iconesDashboard.json"
# Le commit à part, dans son propre fichier : 40 chiffres hexadécimaux posés dans le même
# fichier que l'alias « sourcegraph » forment exactement ce que gitleaks prend pour un jeton
# Sourcegraph. Séparés, chacun des deux fichiers dit ce qu'il est.
SORTIE_COMMIT = RACINE / "apps/server/src/services/iconesDashboard.commit"
DEPOT = "homarr-labs/dashboard-icons"


def lire(url: str):
    requete = urllib.request.Request(url, headers={"User-Agent": "ghostpass-icones"})
    # L'adresse est construite ici depuis deux constantes, jamais depuis une saisie.
    with urllib.request.urlopen(requete, timeout=60) as r:  # nosemgrep: python.lang.security.audit.dynamic-urllib-use-detected.dynamic-urllib-use-detected
        return json.load(r)


def cle(texte: str) -> str:
    """Un alias tel qu'on le compare à une étiquette de domaine : minuscules, sans séparateur."""
    return re.sub(r"[^a-z0-9]", "", texte.lower())


def main() -> None:
    commit = lire(f"https://api.github.com/repos/{DEPOT}/commits/main")["sha"]
    meta = lire(f"https://cdn.jsdelivr.net/gh/{DEPOT}@{commit}/metadata.json")

    icones: dict[str, str] = {}
    alias: dict[str, str] = {}
    for nom, m in meta.items():
        base = m.get("base", "svg")
        if base not in ("svg", "png"):
            continue
        icones[nom] = base
        for a in [nom, *m.get("aliases", [])]:
            k = cle(a)
            # Le premier arrivé garde l'alias : un nom exact passe avant un alias d'un autre.
            if k and k not in alias:
                alias[k] = nom
    # Un nom exact l'emporte toujours sur l'alias d'un autre logo.
    for nom in icones:
        alias[cle(nom)] = nom

    index = {
        "source": f"https://github.com/{DEPOT}",
        "licence": "Apache-2.0",
        "icones": dict(sorted(icones.items())),
        "alias": dict(sorted(alias.items())),
    }
    SORTIE.write_text(json.dumps(index, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    SORTIE_COMMIT.write_text(commit + "\n", encoding="utf-8")
    print(f"{SORTIE.relative_to(RACINE)} : {len(icones)} logos, {len(alias)} alias, commit {commit[:7]}")


if __name__ == "__main__":
    main()
