import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/app.js";
import { openDatabase } from "../src/db/database.js";
import { sends } from "../src/db/repositories.js";

const REG = {
  email: "kevin@stackops.ch",
  masterPasswordHash: "client-auth-hash-AAA",
  kdfParams: JSON.stringify({ mem_cost_kib: 65536, time_cost: 3, parallelism: 4 }),
  encryptedUserKey: "2.bm9uY2U.Y2lwaGVy",
  encryptedPrivateKey: "2.bm9uY2Uy.Y2lwaGVyMg",
  publicKey: "cHVibGlja2V5LWJhc2U2NA",
};

async function tokenOf(app: ReturnType<typeof buildApp>): Promise<string> {
  const res = await app.inject({ method: "POST", url: "/api/auth/register", payload: REG });
  return res.json().token as string;
}

test("les liens déjà émis restent lisibles, et s'épuisent, après la délégation à ghostbit", async () => {
  // Depuis le 2026-08-29, la CRÉATION passe par ghostbit (voir
  // `ghostbit-relay.test.ts`). La lecture, elle, doit continuer de servir les
  // liens émis avant la bascule : ils vivent jusqu'à 30 jours, et les couper
  // le jour du déploiement casserait des partages en cours sans prévenir
  // personne.
  //
  // On dépose donc directement en base, comme le faisait l'ancienne route, et
  // on mesure la lecture — ce qui est exactement ce qui reste vrai.
  const db = openDatabase(":memory:");
  const app = buildApp(db);
  await sends.create(db, {
    id: "ancien-lien",
    ciphertext: "Y2lwaGVy",
    iv: "aXY=",
    expiresAt: Date.now() + 3_600_000,
    maxViews: 1,
  });

  // Récupération publique (sans jeton) : c'est le destinataire qui lit.
  const get1 = await app.inject({ method: "GET", url: "/api/send/ancien-lien" });
  assert.equal(get1.statusCode, 200);
  assert.equal(get1.json().ciphertext, "Y2lwaGVy");

  // One-time : la 2e vue est épuisée.
  const get2 = await app.inject({ method: "GET", url: "/api/send/ancien-lien" });
  assert.equal(get2.statusCode, 404);

  // Identifiant inconnu → 404, indistinguable d'un lien épuisé.
  const get3 = await app.inject({ method: "GET", url: "/api/send/inconnu" });
  assert.equal(get3.statusCode, 404);

  await app.close();
});

test("la création reste refusée sans authentification", async () => {
  // Vérifié avant même que ghostbit soit configuré : l'ordre des gardes
  // compte, un 503 « non configuré » à un appelant anonyme lui apprendrait
  // que la route existe.
  const app = buildApp(openDatabase(":memory:"));
  const res = await app.inject({
    method: "POST",
    url: "/api/send",
    payload: { ciphertext: "x", iv: "y", expiresInHours: 1, maxViews: 1 },
  });
  assert.equal(res.statusCode, 401);
  await app.close();
});

