import { test } from "node:test";
import assert from "node:assert/strict";
import { serialiserLaRequete } from "../src/app.js";

// Sans ce test, quelqu'un « simplifierait » un jour `url.split("?")[0]` en `url` —
// la forme courte est toujours la plus tentante — et rien n'échouerait. Or ce
// `?` est ce qui sépare un journal d'exploitation d'un relevé des domaines que
// contient le coffre de chaque utilisateur.
test("le journal garde le chemin, jamais la chaîne de requête", () => {
  assert.deepEqual(
    serialiserLaRequete({ method: "GET", url: "/api/icons?domain=banque-privee.example" }),
    { method: "GET", url: "/api/icons" },
  );
});

test("un chemin sans chaîne de requête traverse inchangé", () => {
  assert.deepEqual(
    serialiserLaRequete({ method: "POST", url: "/api/auth/login" }),
    { method: "POST", url: "/api/auth/login" },
  );
});

// Une chaîne vide reste une chaîne : `/x?` ne doit pas devenir `/x?`.
test("un point d'interrogation nu est retiré lui aussi", () => {
  assert.equal(serialiserLaRequete({ method: "GET", url: "/api/icons?" }).url, "/api/icons");
});
