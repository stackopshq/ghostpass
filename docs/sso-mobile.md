# SSO mobile — intégration côté application

Deux routes permettent à l'application iPhone d'ouvrir une session par SSO. Ce document décrit
le contrat ; le *pourquoi* de la forme est en tête de `apps/server/src/services/oidc.ts`.

## Pourquoi ce n'est pas un flux OIDC natif

L'IdP est **Cloudflare Access for SaaS**, dont l'API n'enregistre **aucun client OIDC public** :
chaque application reçoit un `client_secret`, et `grant_types` vaut `authorization_code` seul.
L'application ne peut donc pas mener elle-même l'échange.

Le danger propre au mobile est par ailleurs ailleurs : **sur iOS, n'importe quelle application
peut revendiquer un schéma d'URL personnalisé**. Une application malveillante installée sur le
téléphone peut recevoir le retour destiné à GhostPass — s'il portait un jeton de session, elle
aurait le compte.

D'où la conception : **le PKCE couvre le saut application ↔ serveur**, qui est exactement le saut
interceptable. Le serveur, lui, reste client confidentiel face à l'IdP, comme le chemin web.
Le code qui revient dans le schéma d'URL ne vaut rien sans le vérificateur que seule
l'application détient.

## Le flux

```
1.  l'app tire un code_verifier aléatoire, calcule
      code_challenge = base64url(sha256(code_verifier))
    puis ouvre une ASWebAuthenticationSession sur

      GET /api/auth/sso/mobile/start
          ?code_challenge=<43 caractères base64url>
          &code_challenge_method=S256
          &state=<opaque, choisi par l'app>
          [&redirect_uri=ch.stackops.ghostpass://sso]

    → 302 vers l'IdP. L'app n'a rien d'autre à faire : le navigateur suit.

2.  le serveur mène l'échange OIDC avec l'IdP

3.  au retour, le serveur redirige vers

      ch.stackops.ghostpass://sso?code=<code à usage unique>&state=<celui du start>

    (c'est ce schéma que l'ASWebAuthenticationSession attend en callbackURLScheme)

4.  POST /api/auth/sso/exchange
      { "code": "<reçu à l'étape 3>", "codeVerifier": "<celui de l'étape 1>" }

5.  → 200 { token, email, kdfParams, encryptedUserKey, encryptedPrivateKey }
```

À l'étape 3, l'application **doit vérifier que le `state` reçu est celui qu'elle a envoyé** à
l'étape 1, et abandonner sinon : c'est ce qui lui garantit que le retour répond à *sa* demande.
Le serveur, lui, le reprend de l'enregistrement du `start` — il n'est jamais lu depuis le corps de
l'échange.

**Le `state` doit être opaque et non identifiant** — une valeur aléatoire tirée par l'application,
et rien d'autre. Le serveur le stocke tel quel pendant dix minutes dans `auth_ephemeral` ; une
adresse de courriel ou un identifiant de compte glissé dedans y atterrirait, et le serveur ne peut
pas l'en empêcher. Ce n'est pas une faille — la table est purgée et la valeur est éphémère — mais
c'est une donnée personnelle écrite dans un réceptacle qui n'est pas prévu pour en porter, et donc
qui n'est déclaré nulle part. Rien d'autre du parcours n'écrit d'adresse : le code émis ne porte
que `{ userId, appChallenge }`, et le courriel ne transite qu'en mémoire pendant le callback.

La réponse de l'étape 5 a **exactement la forme du callback web** : un seul chemin de session à
écrire côté client. Le mot de passe maître reste requis pour déverrouiller le coffre — le SSO
authentifie l'identité, il n'ouvre pas le coffre.

`GET /api/auth/sso/status` rend `{ "enabled": true|false }` et décide de l'affichage du bouton.
Rien d'autre : le client ne fait aucune découverte OIDC.

## Ce que le serveur refuse

| Cas | Réponse |
|---|---|
| `code_challenge_method` absent, ou `plain` | `400` au `start` |
| `code_challenge` mal formé (≠ 43 caractères base64url) | `400` au `start` |
| `redirect_uri` hors liste blanche serveur | `400` au `start` |
| code rejoué, ou déjà présenté **même sur un échange qui a échoué** | `400` à l'échange |
| vérificateur ne correspondant pas au challenge de **son** `start` | `400` à l'échange |
| code de plus de 2 minutes | `400` à l'échange |
| `email_verified` faux côté IdP | retour vers l'app avec `error=sso_failed`, **sans** `code` |
| adresse inconnue de GhostPass | retour avec `error=not_provisioned`, **sans** `code` |

Un compte n'est **jamais** créé par le SSO : le coffre étant scellé sous le mot de passe maître,
un compte provisionné à la volée n'aurait rien à ouvrir — l'utilisateur verrait un coffre vide et
croirait avoir perdu ses données.

Les échecs postérieurs au `start` reviennent **par le schéma d'URL de l'application**, avec un
`error` et le `state` d'origine : la session web ne se referme que là, et une page d'erreur y
laisserait l'utilisateur bloqué. Traiter l'absence de `code` comme un échec, jamais la seule
présence de `error`.

## Côté déploiement

```
OIDC_MOBILE_REDIRECT_URI=https://<hôte>/api/auth/sso/mobile/callback   # à enregistrer chez l'IdP
SSO_MOBILE_REDIRECT_URIS=ch.stackops.ghostpass://sso,ch.stackops.ghostpass.essai://sso
```

Le défaut, quand `SSO_MOBILE_REDIRECT_URIS` n'est pas posée, porte les deux schémas iOS : celui
de la build distribuée et celui de la build de recette (`.essai`), qui ne peuvent pas partager un
identifiant de paquet. Le second n'affaiblit pas le premier : le code rendu à l'application est
inerte sans le vérificateur PKCE, que seule l'application ayant ouvert la session détient. Poser
la variable **remplace** le défaut ; une instance qui ne veut que la production l'écrit seule.

Sans `OIDC_MOBILE_REDIRECT_URI`, les trois routes répondent `404` et `status` reste inchangé pour
le chemin web.
