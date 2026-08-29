import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/app.js";
import { openDatabase } from "../src/db/database.js";
import { getAllowedOrigins } from "../src/services/webauthn.js";

function makeApp() {
  return buildApp(openDatabase(":memory:"));
}

test("/.well-known/webauthn expose l'origine principale", async () => {
  const app = makeApp();
  const res = await app.inject({ method: "GET", url: "/.well-known/webauthn" });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.ok(Array.isArray(body.origins));
  assert.ok(body.origins.includes("http://localhost:5173"), "ORIGIN par défaut attendue");
  await app.close();
});

test("WEBAUTHN_EXTRA_ORIGINS ajoute les origines liées (extension)", async () => {
  const prev = process.env.WEBAUTHN_EXTRA_ORIGINS;
  process.env.WEBAUTHN_EXTRA_ORIGINS = "chrome-extension://abc123 , chrome-extension://def456";
  try {
    const app = makeApp();
    const res = await app.inject({ method: "GET", url: "/.well-known/webauthn" });
    const body = res.json();
    assert.deepEqual(body.origins, [
      "http://localhost:5173",
      "chrome-extension://abc123",
      "chrome-extension://def456",
    ]);
    assert.deepEqual(getAllowedOrigins(), body.origins);
    await app.close();
  } finally {
    if (prev === undefined) delete process.env.WEBAUTHN_EXTRA_ORIGINS;
    else process.env.WEBAUTHN_EXTRA_ORIGINS = prev;
  }
});

test("les quatre points de vérification acceptent les origines liées, pas seulement /.well-known", async () => {
  // Le garde-fou de ce fichier mesurait ce que le serveur ANNONCE, pas ce
  // qu'il accepte. Deux des quatre vérifications validaient contre `ORIGIN`
  // seul : une clé de sécurité était donc refusée depuis l'extension, alors
  // que le TOTP passait et que `/.well-known/webauthn` promettait le contraire.
  //
  // On mesure ici la source, faute de pouvoir forger une assertion FIDO2
  // valide en test : chaque appel à `verify…` doit recevoir la LISTE, pas la
  // constante. Grossier, mais il crie sur l'état fautif — vérifié en
  // remettant `expectedOrigin: ORIGIN` dans l'un des deux fichiers.
  const { readFile } = await import("node:fs/promises");
  const fichiers = ["src/routes/auth.ts", "src/routes/webauthn.ts", "src/routes/passkey.ts"];
  for (const f of fichiers) {
    const src = await readFile(new URL(`../${f}`, import.meta.url), "utf8");
    const seul = src.match(/expectedOrigin:\s*ORIGIN\b/g) ?? [];
    assert.equal(
      seul.length,
      0,
      `${f} valide encore contre l'origine principale seule — une clé de sécurité y sera refusée depuis l'extension`,
    );
    assert.ok(
      /expectedOrigin:\s*getAllowedOrigins\(\)/.test(src),
      `${f} doit valider contre getAllowedOrigins()`,
    );
  }
});
