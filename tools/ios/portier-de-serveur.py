#!/usr/bin/env python3
"""Allume et éteint le serveur GhostPass à la demande, par HTTP.

Un test XCUITest ne peut pas lancer de processus sur la machine hôte : il tourne dans le
simulateur. Mais lui seul sait à quel instant le bandeau « Hors ligne » est vraiment à
l'écran — une minuterie côté script rallumerait tantôt trop tôt, tantôt trop tard, selon
le temps qu'ont pris la compilation, l'installation et la dérivation du mot de passe
maître. Ce portier lui donne donc la main : `GET /allumer`, `GET /eteindre`, `GET /etat`.

Il n'écoute que sur 127.0.0.1, ne sert qu'à l'essai local, et n'arrête que le serveur
qu'il a lui-même démarré.

    ./portier-de-serveur.py --racine <dépôt> --db <fichier.sqlite> \
        [--port 3199] [--port-serveur 3111]
"""

import argparse
import http.server
import json
import os
import signal
import subprocess
import time
import urllib.error
import urllib.request

serveur = None  # Popen du serveur GhostPass, ou None.


def repond(port):
    """Le serveur GhostPass répond-il sur ce port ?"""
    requete = urllib.request.Request(
        f"http://127.0.0.1:{port}/api/auth/prelogin",
        data=json.dumps({"email": "sonde@example.com"}).encode(),
        headers={"Content-Type": "application/json"},
    )
    try:
        urllib.request.urlopen(requete, timeout=2)
        return True
    except urllib.error.HTTPError:
        # Une réponse d'erreur reste une réponse : le serveur est debout.
        return True
    except Exception:
        return False


def allumer(args):
    global serveur
    if repond(args.port_serveur):
        return True
    serveur = subprocess.Popen(
        ["npm", "start"],
        cwd=os.path.join(args.racine, "apps", "server"),
        env={**os.environ, "DB_PATH": args.db, "PORT": str(args.port_serveur)},
        stdout=open(args.journal, "ab"),
        stderr=subprocess.STDOUT,
        # Son propre groupe : on l'arrêtera avec sa descendance, sans jamais viser le
        # port — ce qui tuerait ce qu'on n'a pas lancé.
        start_new_session=True,
    )
    for _ in range(60):
        if repond(args.port_serveur):
            return True
        time.sleep(1)
    return False


def eteindre(args):
    global serveur
    if serveur is None:
        return not repond(args.port_serveur)
    try:
        os.killpg(os.getpgid(serveur.pid), signal.SIGTERM)
    except ProcessLookupError:
        pass
    serveur.wait(timeout=30)
    serveur = None
    for _ in range(30):
        if not repond(args.port_serveur):
            return True
        time.sleep(1)
    return False


def main():
    a = argparse.ArgumentParser()
    a.add_argument("--racine", required=True)
    a.add_argument("--db", required=True)
    a.add_argument("--journal", required=True)
    a.add_argument("--port", type=int, default=3199)
    a.add_argument("--port-serveur", type=int, default=3111)
    args = a.parse_args()

    class Portier(http.server.BaseHTTPRequestHandler):
        def do_GET(self):  # noqa: N802 — nom imposé par http.server
            if self.path == "/allumer":
                ok = allumer(args)
            elif self.path == "/eteindre":
                ok = eteindre(args)
            elif self.path == "/etat":
                ok = repond(args.port_serveur)
            else:
                self.send_error(404)
                return
            self.send_response(200 if ok else 503)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.end_headers()
            self.wfile.write(b"debout\n" if ok else b"eteint\n")

        def log_message(self, *_):
            pass

    # Le script arrête le portier par SIGTERM : sans ce relais, le processus mourrait
    # sans passer par le `finally`, et laisserait derrière lui un serveur qui tourne
    # encore — le run suivant trouverait alors le port occupé et refuserait de démarrer.
    def rendre_la_main(*_):
        raise KeyboardInterrupt

    signal.signal(signal.SIGTERM, rendre_la_main)
    signal.signal(signal.SIGINT, rendre_la_main)

    with http.server.HTTPServer(("127.0.0.1", args.port), Portier) as httpd:
        print(f"portier sur 127.0.0.1:{args.port}", flush=True)
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass
        finally:
            eteindre(args)


if __name__ == "__main__":
    main()
