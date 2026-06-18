import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/app.js";
import { openDatabase } from "../src/db/database.js";
import { normalizeDomain } from "../src/services/icons.js";

// Ces tests verrouillent la validation d'entrée du proxy de favicons (anti-SSRF), sans réseau :
// toute saisie qui n'est pas un domaine public est rejetée AVANT toute requête sortante.

test("normalizeDomain accepte un domaine public et nettoie www / URL complète", () => {
  assert.equal(normalizeDomain("github.com"), "github.com");
  assert.equal(normalizeDomain("https://github.com/login?x=1"), "github.com");
  assert.equal(normalizeDomain("WWW.Stripe.COM"), "stripe.com");
  assert.equal(normalizeDomain("sub.example.co.uk"), "sub.example.co.uk");
});

test("normalizeDomain rejette les cibles SSRF et saisies invalides", () => {
  const blocked = [
    "", // vide
    "   ", // espaces
    "localhost", // pas de point
    "metadata", // label unique
    "127.0.0.1", // loopback (IP littérale)
    "10.0.0.1", // privé
    "172.16.0.1", // privé
    "192.168.1.1", // privé
    "169.254.169.254", // link-local / métadonnées cloud
    "::1", // loopback IPv6
    "fd00::1", // ULA IPv6
    "file:///etc/passwd", // schéma non http
  ];
  for (const bad of blocked) {
    assert.equal(normalizeDomain(bad), null, `devrait rejeter: "${bad}"`);
  }
});

test("GET /api/icons → 400 sur domaine invalide / cible SSRF (aucun fetch sortant)", async () => {
  const app = buildApp(openDatabase(":memory:"));
  for (const bad of ["localhost", "127.0.0.1", "169.254.169.254", "192.168.0.1", ""]) {
    const res = await app.inject({
      method: "GET",
      url: `/api/icons?domain=${encodeURIComponent(bad)}`,
    });
    assert.equal(res.statusCode, 400, `devrait être 400 pour: "${bad}"`);
  }
  await app.close();
});
