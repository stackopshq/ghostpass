import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/app.js";
import { openDatabase } from "../src/db/database.js";
import { candidateUrls, normalizeDomain } from "../src/services/icons.js";

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

// Le proxy ne tentait que `/favicon.ico` et renonçait au premier échec, d'où des
// entrées sans logo alors que le site en sert un ailleurs. Ces tests verrouillent
// la LISTE, pas le réseau : ils n'émettent aucune requête sortante.
test("candidateUrls : plusieurs chemins, et le www. en second", () => {
  const urls = candidateUrls("indy.fr");
  assert.equal(urls[0], "https://indy.fr/favicon.ico");
  assert.equal(urls[1], "https://www.indy.fr/favicon.ico");
  assert.ok(urls.includes("https://indy.fr/apple-touch-icon.png"));
  assert.ok(urls.length >= 3, "une seule tentative est précisément le défaut corrigé");
});

test("candidateUrls : pas de www.www. sur un domaine qui en porte déjà un", () => {
  const urls = candidateUrls("www.indy.fr");
  assert.ok(!urls.some((u) => u.includes("www.www.")), "doublon de sous-domaine");
});

test("candidateUrls : que du HTTPS, et jamais un autre hôte que celui demandé", () => {
  for (const u of candidateUrls("indy.fr")) {
    const parsed = new URL(u);
    assert.equal(parsed.protocol, "https:");
    assert.ok(
      parsed.hostname === "indy.fr" || parsed.hostname === "www.indy.fr",
      `hôte inattendu : ${parsed.hostname}`,
    );
  }
});
