#!/usr/bin/env bash
# Découverte de l'appareil et de l'équipe de signature.
#
# Écrit pour être partagé entre deux poseurs — `appareil.sh` et son cousin en équipe
# personnelle — parce que corriger un piège d'un seul côté laisse l'autre le garder, et
# que c'est le côté qu'on n'a pas regardé qui pose la mauvaise application sur le mauvais
# appareil. Le cousin a depuis disparu, l'adhésion payante l'ayant rendu inutile ; ce
# fichier reste séparé, la découverte n'ayant rien à voir avec la construction.
#
# Ce fichier se source, il ne s'exécute pas.

say() { printf "\n\033[1m▸ %s\033[0m\n" "$*" >&2; }

# ── L'appareil ────────────────────────────────────────────────────────────────
#
# Découvert, pas codé en dur : ces scripts doivent servir à quelqu'un d'autre, avec un
# autre appareil.
#
# `GHOSTPASS_APPAREIL` choisit par le nom quand plusieurs sont branchés. Sans lui, le
# script prenait le premier venu **en silence** — on croyait poser sur l'iPhone et l'on
# posait sur l'iPad. Il affiche donc le nom de celui qu'il retient, et refuse de choisir
# seul quand il y a plusieurs candidats.
#
# Pose `NOM` et `DEVICE`.
trouver_l_appareil() {
  local candidats nombre
  candidats="$(xcrun devicectl list devices 2>/dev/null |
    awk '$0 ~ /connected/ && $0 !~ /no DDI/ && $0 !~ /unavailable/ {
           nom = $1; for (i = 2; $i !~ /coredevice\.local/; i++) nom = nom " " $i
           print nom "\t" $(i+1) }')"

  if [[ -n "${GHOSTPASS_APPAREIL:-}" ]]; then
    candidats="$(printf '%s\n' "$candidats" | grep -i -- "$GHOSTPASS_APPAREIL" || true)"
  fi

  nombre="$(printf '%s' "$candidats" | grep -c . || true)"
  if [[ "$nombre" -gt 1 ]]; then
    echo "Plusieurs appareils sont branchés — précisez lequel :" >&2
    printf '%s\n' "$candidats" | cut -f1 | sed 's/^/  /' >&2
    echo >&2
    echo "  GHOSTPASS_APPAREIL=\"iPad\" $0" >&2
    exit 1
  fi

  NOM="$(printf '%s' "$candidats" | cut -f1)"
  DEVICE="$(printf '%s' "$candidats" | cut -f2)"
  if [[ -z "$DEVICE" ]]; then
    echo "Aucun iPhone utilisable n'est branché." >&2
    echo >&2
    echo "  1. Brancher le téléphone en USB — avec un câble de données, pas d'alimentation." >&2
    echo "  2. Le déverrouiller et répondre « Se fier » à l'alerte." >&2
    echo "  3. Activer Réglages > Confidentialité et sécurité > Mode développeur." >&2
    echo "     Ce menu n'apparaît qu'après une première tentative depuis Xcode." >&2
    echo >&2
    echo "État vu par le Mac :" >&2
    xcrun devicectl list devices 2>&1 | sed -n '1,6p' >&2
    exit 1
  fi
  say "Appareil : ${NOM:-inconnu} ($DEVICE)"
}

# ── L'équipe ──────────────────────────────────────────────────────────────────
#
# Lue depuis les certificats de développement, dont le champ OU porte l'identifiant
# d'équipe.
#
# **Elle refuse de choisir quand il y en a plusieurs**, et c'est le point de ce
# refactoring. Le code précédent prenait le premier certificat rendu par le trousseau,
# dans un ordre que rien ne définit. Tant qu'il n'y avait qu'une équipe personnelle, cela
# marchait. Dès qu'une équipe d'entreprise s'ajoute — c'est-à-dire maintenant — les deux
# coexistent, et signer avec la personnelle produit une application qui **s'installe et se
# lance**, mais dont le remplissage automatique ne voit rien : le groupe d'applications
# n'est pas provisionnable en équipe personnelle, et `SharedStore` retombe silencieusement
# sur son conteneur privé. Le symptôme serait « l'extension ne trouve aucun mot de passe »,
# à mille lieues de la cause.
#
# Pose `EQUIPE`.
trouver_l_equipe() {
  EQUIPE="${DEVELOPMENT_TEAM:-}"
  [[ -n "$EQUIPE" ]] && { say "Équipe : $EQUIPE (imposée)"; return 0; }

  # `-a` rend **tous** les certificats. Sans lui, `find-certificate` n'en rend qu'un,
  # dans un ordre que rien ne définit — et c'est ainsi qu'on choisit une équipe au hasard
  # en croyant n'en avoir qu'une.
  local atelier equipes nombre
  atelier="$(mktemp -d)"
  security find-certificate -a -c "Apple Development" -p >"$atelier/tous.pem" 2>/dev/null || true
  # Découpage à l'awk plutôt qu'au `csplit` : celui de BSD **échoue** quand le motif
  # n'apparaît qu'une fois — `{*}` n'a alors rien à répéter — et il efface les fichiers
  # qu'il venait d'écrire. Le cas « un seul certificat » est le cas courant ; le script
  # annonçait donc « aucun certificat » sur une machine qui en avait un. Mesuré.
  awk -v d="$atelier" '/BEGIN CERTIFICATE/ {n++} n {print > (d "/cert-" n)}' \
    "$atelier/tous.pem" 2>/dev/null || true
  equipes="$(for c in "$atelier"/cert-*; do
    [[ -e "$c" ]] || continue
    openssl x509 -noout -subject -in "$c" 2>/dev/null |
      tr ',/' '\n\n' | awk -F= '/^ *OU/ {gsub(/ /, "", $2); print $2; exit}'
  done | sort -u | grep -v '^$' || true)"
  rm -rf "$atelier"

  nombre="$(printf '%s' "$equipes" | grep -c . || true)"
  if [[ "$nombre" -eq 0 ]]; then
    echo "Aucun certificat « Apple Development » dans le trousseau." >&2
    echo "Xcode le crée quand un compte est ajouté : ouvrez Xcode, Réglages > Comptes," >&2
    echo "ajoutez ou rafraîchissez le compte, puis revenez ici." >&2
    exit 1
  fi
  if [[ "$nombre" -gt 1 ]]; then
    echo "Plusieurs équipes de signature sont dans le trousseau :" >&2
    printf '%s\n' "$equipes" | sed 's/^/  /' >&2
    echo >&2
    echo "Choisir au hasard produirait une application qui s'installe et se lance, mais" >&2
    echo "dont le remplissage automatique ne verrait rien. Précisez :" >&2
    echo >&2
    echo "  DEVELOPMENT_TEAM=XXXXXXXXXX $0" >&2
    exit 1
  fi
  EQUIPE="$equipes"
  say "Équipe : $EQUIPE"
}
