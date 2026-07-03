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
