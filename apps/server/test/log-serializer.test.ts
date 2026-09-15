import { test } from "node:test";
import assert from "node:assert/strict";
import { serialiserLaRequete } from "../src/app.js";

// Deux fuites du même jour, deux formes différentes — et le gabarit de route
// ferme les deux. Sans ces cas, quelqu'un « simplifierait » un jour le
// sérialiseur vers `req.url`, la forme la plus courte étant la plus tentante,
// et rien n'échouerait.

test("la chaîne de requête ne rejoint jamais le journal", () => {
  assert.deepEqual(
    serialiserLaRequete({ method: "GET", url: "/api/icons?domain=banque-privee.example" }),
    { method: "GET", route: "/api/icons" },
  );
});

test("un jeton porté DANS le chemin ne rejoint pas le journal non plus", () => {
  assert.deepEqual(
    serialiserLaRequete({
      method: "GET",
      url: "/api/send/le-jeton-en-clair",
      routeOptions: { url: "/api/send/:id" },
    }),
    { method: "GET", route: "/api/send/:id" },
  );
});

test("sans route correspondante, on garde le chemin nu — un 404 reste visible", () => {
  assert.deepEqual(
    serialiserLaRequete({ method: "GET", url: "/nexiste-pas?x=1" }),
    { method: "GET", route: "/nexiste-pas" },
  );
});

test("un point d'interrogation nu est retiré lui aussi", () => {
  assert.equal(serialiserLaRequete({ method: "GET", url: "/api/icons?" }).route, "/api/icons");
});
