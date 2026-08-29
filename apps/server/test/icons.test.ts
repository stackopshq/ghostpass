import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/app.js";
import { openDatabase } from "../src/db/database.js";
import { candidateUrls, domainesParents, normalizeDomain } from "../src/services/icons.js";

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

test("domainesParents remonte du sous-domaine vers le site, sans aller trop loin", () => {
  // Le cas mesuré : `app.indy.fr` répond 404 sur les quatre chemins, `indy.fr` rend
  // une image. Sans remontée, l'entrée reste sans logo alors que le site en a un.
  assert.deepEqual(domainesParents("app.indy.fr"), ["indy.fr"]);
  assert.deepEqual(domainesParents("manager.infomaniak.com"), ["infomaniak.com"]);

  // Un domaine déjà à deux labels n'a pas de parent utile : on n'interroge pas le TLD.
  assert.deepEqual(domainesParents("indy.fr"), []);

  // Bornage à deux parents : au-delà on ne ferait qu'ajouter des appels sortants.
  assert.deepEqual(domainesParents("a.b.c.d.example.com"), [
    "b.c.d.example.com",
    "c.d.example.com",
  ]);

  // Les suffixes publics courants sont écartés : `co.uk` n'appartient à personne, et
  // l'interroger était une requête sortante garantie inutile sur tout domaine britannique.
  assert.deepEqual(domainesParents("shop.example.co.uk"), ["example.co.uk"]);
  assert.deepEqual(domainesParents("example.co.uk"), []);
  assert.deepEqual(domainesParents("login.example.com.au"), ["example.com.au"]);
});

test("candidateUrls garde les chemins de l'hôte exact avant de remonter au site", () => {
  const urls = candidateUrls("app.indy.fr");
  // Les quatre chemins d'avant restent, et restent en tête : une icône propre au
  // sous-domaine doit toujours l'emporter sur celle du site.
  assert.deepEqual(urls.slice(0, 4), [
    "https://app.indy.fr/favicon.ico",
    "https://www.app.indy.fr/favicon.ico",
    "https://app.indy.fr/apple-touch-icon.png",
    "https://app.indy.fr/favicon.svg",
  ]);
  assert.equal(urls[4], "https://indy.fr/favicon.ico");
});
