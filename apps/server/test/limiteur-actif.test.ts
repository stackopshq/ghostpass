/// Le limiteur par IP est-il seulement branché ?
///
/// Il ne l'était pas. `app.register(rateLimit, …)` figurait bien dans `app.ts`,
/// avant les routes dans l'ordre du fichier — mais `register` est différé
/// jusqu'à `ready()`, alors que les `registerXxxRoutes(app, db)` s'exécutent
/// tout de suite. Toutes les routes étaient donc déclarées AVANT que le hook du
/// limiteur n'existe, et un hook Fastify ne s'applique qu'à ce qui vient après
/// lui. Résultat : ni le plafond global, ni les `config.rateLimit` posés route
/// par route sur /api/auth/login, /api/auth/prelogin et /api/auth/recover.
///
/// Rien ne le signalait. Le serveur répondait 200 à tout, ce qu'on attend d'un
/// serveur qui va bien ; la configuration était présente et lisible dans le
/// code ; et aucun test ne comptait jamais assez de requêtes pour s'en
/// apercevoir. Mesuré : 130 requêtes de suite sans un seul 429.
///
/// Ce test est bon marché et il rougit dès que l'ordre se défait. C'est le seul
/// moyen de distinguer « limité » de « on n'a pas regardé ».
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/app.js";
import { openDatabase } from "../src/db/database.js";

/// Le plafond déclaré sur /api/auth/login dans `routes/auth.ts`.
const PLAFOND_LOGIN = 10;

test("le plafond par route sur /api/auth/login est réellement appliqué", async () => {
  const app = buildApp(openDatabase(":memory:"));
  const codes: number[] = [];
  for (let i = 0; i < PLAFOND_LOGIN + 2; i++) {
    const r = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      remoteAddress: "10.42.0.1",
      payload: { email: "inconnu@example.org", masterPasswordHash: "peu-importe" },
    });
    codes.push(r.statusCode);
  }

  // Les dix premières passent (401 : compte inconnu), la onzième est coupée.
  assert.equal(codes.filter((c) => c === 429).length, 2, `codes obtenus : ${codes.join(",")}`);
  assert.equal(codes[PLAFOND_LOGIN - 1], 401);
  assert.equal(codes[PLAFOND_LOGIN], 429);
  await app.close();
});

test("le limiteur compte par adresse : une autre IP n'hérite pas du plafond", async () => {
  // La contrepartie, et la raison pour laquelle il ne suffit pas à protéger un
  // compte : un attaquant qui change d'adresse repart à zéro. C'est le compteur
  // par compte de `services/mfa.ts` qui s'en charge, pas celui-ci.
  const app = buildApp(openDatabase(":memory:"));
  for (let i = 0; i < PLAFOND_LOGIN + 1; i++) {
    await app.inject({
      method: "POST",
      url: "/api/auth/login",
      remoteAddress: "10.42.0.2",
      payload: { email: "inconnu@example.org", masterPasswordHash: "peu-importe" },
    });
  }
  const ailleurs = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    remoteAddress: "10.42.0.3",
    payload: { email: "inconnu@example.org", masterPasswordHash: "peu-importe" },
  });
  assert.equal(ailleurs.statusCode, 401);
  await app.close();
});
