import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/app.js";
import { openDatabase } from "../src/db/database.js";

const KDF = JSON.stringify({ mem_cost_kib: 65536, time_cost: 3, parallelism: 4 });
const CHIFFRE = { ciphertext: "Y2lwaGVydGV4dA==", iv: "MTIzNDU2Nzg5MDEy", expiresInHours: 24, maxViews: 1 };

async function connecte(app: ReturnType<typeof buildApp>): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: {
      email: "relay@stackops.ch",
      masterPasswordHash: "hash",
      kdfParams: KDF,
      encryptedUserKey: "2.dWsx.dWsy",
      encryptedPrivateKey: "2.cGsx.cGsy",
      publicKey: "pub",
    },
  });
  return res.json().token as string;
}

/// Remplace `fetch` le temps d'un test et retient ce qui a été demandé.
function interceptefetch(reponse: { status: number; body?: unknown }) {
  const vrai = globalThis.fetch;
  const appels: Array<{ url: string; init: RequestInit }> = [];
  globalThis.fetch = (async (url: string | URL, init: RequestInit = {}) => {
    appels.push({ url: String(url), init });
    return new Response(reponse.body === undefined ? null : JSON.stringify(reponse.body), {
      status: reponse.status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return { appels, rends: () => { globalThis.fetch = vrai; } };
}

test("sans GHOSTBIT_URL, le partage refuse au lieu de retomber sur un stockage local", async () => {
  // Un repli silencieux créerait des liens qu'on ne peut plus révoquer, et
  // personne ne s'en apercevrait avant d'en avoir besoin.
  const avant = process.env.GHOSTBIT_URL;
  delete process.env.GHOSTBIT_URL;
  const app = buildApp(openDatabase(":memory:"));
  const token = await connecte(app);
  const res = await app.inject({
    method: "POST",
    url: "/api/send",
    headers: { authorization: `Bearer ${token}` },
    payload: CHIFFRE,
  });
  assert.equal(res.statusCode, 503);
  if (avant !== undefined) process.env.GHOSTBIT_URL = avant;
  await app.close();
});

test("le relais renomme les champs et rend l'URL ET le jeton de révocation", async () => {
  process.env.GHOSTBIT_URL = "https://ghostbit.example/";
  const i = interceptefetch({
    status: 201,
    body: { id: "abc123", url: "https://ghostbit.example/abc123", delete_token: "jeton-secret", expires_at: 1788000000 },
  });
  const app = buildApp(openDatabase(":memory:"));
  const token = await connecte(app);
  const res = await app.inject({
    method: "POST",
    url: "/api/send",
    headers: { authorization: `Bearer ${token}` },
    payload: CHIFFRE,
  });
  i.rends();

  assert.equal(res.statusCode, 201);
  const corps = res.json();
  // L'URL vient du SERVEUR, pas d'une déduction du client : l'iOS fabriquait
  // le lien lui-même à partir de l'identifiant et de son adresse de serveur,
  // ce qui aurait produit des liens morts sans lever d'erreur.
  assert.equal(corps.url, "https://ghostbit.example/abc123");
  assert.equal(corps.deleteToken, "jeton-secret");
  assert.equal(corps.expiresAt, 1788000000);

  assert.equal(i.appels.length, 1);
  assert.equal(i.appels[0]!.url, "https://ghostbit.example/api/v1/pastes");
  const envoye = JSON.parse(String(i.appels[0]!.init.body));
  // Renommage : `ciphertext`/`iv` chez nous, `content`/`nonce` chez ghostbit.
  assert.equal(envoye.content, CHIFFRE.ciphertext);
  assert.equal(envoye.nonce, CHIFFRE.iv);
  assert.equal(envoye.expires_in, 24 * 3600, "des heures vers des secondes");
  // Une seule vue se dit `burn`, pas `max_views: 1` : envoyer les deux
  // laisserait ghostbit arbitrer ce qu'on voulait.
  assert.equal(envoye.burn, true);
  assert.equal(envoye.max_views, undefined);
  await app.close();
});

test("un refus de ghostbit devient 502, sans relayer son message", async () => {
  process.env.GHOSTBIT_URL = "https://ghostbit.example";
  const i = interceptefetch({ status: 422, body: { detail: "ciphertext too short to be AES-GCM output" } });
  const app = buildApp(openDatabase(":memory:"));
  const token = await connecte(app);
  const res = await app.inject({
    method: "POST",
    url: "/api/send",
    headers: { authorization: `Bearer ${token}` },
    payload: CHIFFRE,
  });
  i.rends();
  assert.equal(res.statusCode, 502);
  // Le message de ghostbit parle de « paste » à quelqu'un qui partage un mot
  // de passe : on ne le relaie pas tel quel.
  assert.doesNotMatch(JSON.stringify(res.json()), /paste/i);
  await app.close();
});

test("la révocation transmet le jeton et ne distingue pas les refus", async () => {
  process.env.GHOSTBIT_URL = "https://ghostbit.example";
  const i = interceptefetch({ status: 403 });
  const app = buildApp(openDatabase(":memory:"));
  const token = await connecte(app);
  const res = await app.inject({
    method: "DELETE",
    url: "/api/send/abc123",
    headers: { authorization: `Bearer ${token}`, "x-delete-token": "jeton-secret" },
  });
  i.rends();

  // 204 même sur un 403 de ghostbit : il répond 403 pour un jeton faux comme
  // pour un paste absent ou expiré, exprès, afin qu'on ne puisse pas énumérer.
  // Relayer la nuance annulerait la garde.
  assert.equal(res.statusCode, 204);
  assert.equal(i.appels[0]!.url, "https://ghostbit.example/api/v1/pastes/abc123");
  assert.equal((i.appels[0]!.init.headers as Record<string, string>)["x-delete-token"], "jeton-secret");
  await app.close();
});

test("sans jeton, la révocation refuse avant d'appeler quoi que ce soit", async () => {
  process.env.GHOSTBIT_URL = "https://ghostbit.example";
  const i = interceptefetch({ status: 204 });
  const app = buildApp(openDatabase(":memory:"));
  const token = await connecte(app);
  const res = await app.inject({
    method: "DELETE",
    url: "/api/send/abc123",
    headers: { authorization: `Bearer ${token}` },
  });
  i.rends();
  assert.equal(res.statusCode, 400);
  assert.equal(i.appels.length, 0, "aucun appel réseau sans jeton");
  await app.close();
});
