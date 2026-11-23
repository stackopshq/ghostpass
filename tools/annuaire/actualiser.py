#!/usr/bin/env python3
"""Rafraîchit l'annuaire des sites qui proposent un second facteur ou une clé d'accès.

La vue « Surveillance » de l'interface web dit, pour chaque identifiant du coffre, si le site
propose un code à usage unique ou une clé d'accès. Elle le lit dans une COPIE de l'annuaire,
servie avec l'interface (`apps/web-next/public/annuaire-2fa.json`), et non en interrogeant un
service : demander « ce site propose-t-il la 2FA ? » apprendrait au service la liste des sites du
coffre, exactement ce que GhostPass promet de ne dire à personne.

Sources, et leurs licences (reprises dans le fichier produit, et affichées dans la vue) :
- 2fa.directory, https://github.com/2factorauth/twofactorauth : MIT ;
- passkeys.2fa.directory, https://github.com/2factorauth/passkeys : CC BY 4.0, qui demande
  d'attribuer la source.

    python3 tools/annuaire/actualiser.py

La copie se rafraîchit à la main : un annuaire un peu ancien rate un site récent, ce qui ne
fait que taire une suggestion. Rien ne casse.
"""

import datetime
import json
import pathlib
import urllib.request

RACINE = pathlib.Path(__file__).resolve().parents[2]
SORTIE = RACINE / "apps/web-next/public/annuaire-2fa.json"

SOURCE_2FA = "https://api.2fa.directory/v3/tfa.json"
SOURCE_CLES = "https://passkeys-api.2fa.directory/v1/supported.json"


def lire(url: str):
    # L'URL est l'une des deux constantes ci-dessus, jamais une saisie : la règle vise un
    # `file://` qu'un tiers glisserait dans l'adresse, ce qui n'a pas de chemin ici. Et
    # l'écrire en dur dans l'appel ne suffit pas : sans `User-Agent`, les deux serveurs
    # répondent 403.
    requete = urllib.request.Request(url, headers={"User-Agent": "ghostpass-annuaire"})
    with urllib.request.urlopen(requete, timeout=60) as r:  # nosemgrep: python.lang.security.audit.dynamic-urllib-use-detected
        return json.load(r)


def domaine(d: str) -> str:
    d = d.strip().lower()
    return d[4:] if d.startswith("www.") else d


def main() -> None:
    tfa: dict[str, list[str]] = {}
    docs: dict[str, str] = {}
    for _nom, site in lire(SOURCE_2FA):
        methodes = sorted(set(site.get("tfa", [])))
        if not methodes:
            continue
        for d in [site["domain"], *site.get("additional-domains", [])]:
            tfa[domaine(d)] = methodes
            if site.get("documentation"):
                docs.setdefault(domaine(d), site["documentation"])

    cles: dict[str, list[str]] = {}
    for d, site in lire(SOURCE_CLES).items():
        usages = [u for u in ("passwordless", "mfa") if site.get(u) == "allowed"]
        if usages:
            cles[domaine(d)] = usages

    annuaire = {
        "genere": datetime.date.today().isoformat(),
        "sources": [
            {"nom": "2fa.directory", "url": "https://2fa.directory", "licence": "MIT"},
            {"nom": "passkeys.2fa.directory", "url": "https://passkeys.2fa.directory", "licence": "CC BY 4.0"},
        ],
        "tfa": dict(sorted(tfa.items())),
        "cles": dict(sorted(cles.items())),
        "documentation": dict(sorted(docs.items())),
    }
    SORTIE.write_text(json.dumps(annuaire, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"{SORTIE.relative_to(RACINE)} : {len(tfa)} sites 2FA, {len(cles)} sites à clé d'accès")


if __name__ == "__main__":
    main()
