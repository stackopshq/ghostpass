// L'oracle de cache du proxy de favicons.
//
// Le défaut était mesurable sans rien casser : la route était publique et le
// cache indexé sur le seul domaine, donc n'importe qui pouvait demander
// `?domain=banque-x.example` et lire dans le temps de réponse si le serveur
// l'avait récemment cherché — donc si QUELQU'UN D'AUTRE avait cette entrée.
//
// On ne teste pas le temps, qui est instable en intégration continue. On teste
// ce qui le produisait : l'absence d'authentification, et le partage du cache.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/app.js";
import { openDatabase } from "../src/db/database.js";
import { creerJetonIcone, lireJetonIcone } from "../src/services/icons.js";

const INSCRIPTION = {
  email: "clara@stackops.ch",
  masterPasswordHash: "client-auth-hash-AAA",
  kdfParams: JSON.stringify({ mem_cost_kib: 65536, time_cost: 3, parallelism: 4 }),
  encryptedUserKey: "2.bm9uY2U.Y2lwaGVy",
  encryptedPrivateKey: "2.bm9uY2Uy.Y2lwaGVyMg",
  publicKey: "cHVibGlja2V5LWJhc2U2NA",
};

test("sans jeton, le proxy ne répond pas — la route n'est plus un oracle public", async () => {
  const app = buildApp(openDatabase(":memory:"));
  const res = await app.inject({ method: "GET", url: "/api/icons?domain=github.com" });
  assert.equal(res.statusCode, 401);
  await app.close();
});

test("un jeton forgé ou expiré est refusé", async () => {
  assert.equal(lireJetonIcone("nimportequoi"), null);
  assert.equal(lireJetonIcone(""), null);

  const vrai = creerJetonIcone("u1").token;
  // Une signature altérée d'un seul caractère.
  const sep = vrai.lastIndexOf(".");
  const altere = vrai.slice(0, sep + 1) + (vrai[sep + 1] === "A" ? "B" : "A") + vrai.slice(sep + 2);
  assert.equal(lireJetonIcone(altere), null, "une signature altérée passe");

  // Une charge modifiée pour se faire passer pour quelqu'un d'autre.
  const charge = Buffer.from(`u2.${Date.now() + 60_000}`).toString("base64url");
  assert.equal(lireJetonIcone(`${charge}.${vrai.slice(sep + 1)}`), null, "l'identité est usurpable");
});

test("un jeton valide nomme son porteur, et lui seul", async () => {
  const a = creerJetonIcone("utilisateur-a").token;
  const b = creerJetonIcone("utilisateur-b").token;
  assert.equal(lireJetonIcone(a), "utilisateur-a");
  assert.equal(lireJetonIcone(b), "utilisateur-b");
  assert.notEqual(a, b, "deux utilisateurs partagent le même jeton : le cache resterait commun");
});

test("le jeton s'obtient avec une session, pas sans", async () => {
  const app = buildApp(openDatabase(":memory:"));

  const sans = await app.inject({ method: "GET", url: "/api/icons/token" });
  assert.equal(sans.statusCode, 401);

  const reg = await app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: INSCRIPTION,
  });
  const session = reg.json().token as string;

  const avec = await app.inject({
    method: "GET",
    url: "/api/icons/token",
    headers: { authorization: `Bearer ${session}` },
  });
  assert.equal(avec.statusCode, 200);
  const { token, expiresAt } = avec.json();
  assert.ok(lireJetonIcone(token), "le jeton rendu n'est pas lisible par le serveur qui l'a émis");
  assert.ok(expiresAt > Date.now(), "le jeton naît expiré");
  // Il ne doit PAS être le jeton de session : le mettre dans une URL en ferait
  // une clé d'API dans l'historique du navigateur.
  assert.notEqual(token, session, "le jeton d'icône est le jeton de session");

  await app.close();
});
