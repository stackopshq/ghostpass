import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/app.js";
import { openDatabase } from "../src/db/database.js";

// L'adresse de la politique de confidentialité doit venir du **déploiement**.
//
// Ce test existe parce que le contraire a été livré : une `NEXT_PUBLIC_PRIVACY_URL`,
// que Next grave dans le paquet à la construction — et ce client est un export
// statique, donc tout y est figé. Un auto-hébergeur tire l'image publiée ; poser la
// variable chez lui n'aurait rien changé, et rien ne le lui aurait dit.
//
// Le mode de défaillance est le pire : la dérogation *paraît* exister, elle est
// documentée, et elle ne fait rien. Personne ne vient signaler que la page de
// confidentialité qu'il sert décrit la mauvaise entreprise.
async function configAvec(valeur: string | undefined) {
  const avant = process.env.GHOSTPASS_PRIVACY_URL;
  if (valeur === undefined) delete process.env.GHOSTPASS_PRIVACY_URL;
  else process.env.GHOSTPASS_PRIVACY_URL = valeur;
  try {
    const app = buildApp(openDatabase(":memory:"));
    const res = await app.inject({ method: "GET", url: "/api/config" });
    await app.close();
    return { statut: res.statusCode, corps: res.json() as { privacyUrl?: string } };
  } finally {
    if (avant === undefined) delete process.env.GHOSTPASS_PRIVACY_URL;
    else process.env.GHOSTPASS_PRIVACY_URL = avant;
  }
}

test("sans réglage, la page servie par l'application", async () => {
  const { statut, corps } = await configAvec(undefined);
  assert.equal(statut, 200);
  assert.equal(corps.privacyUrl, "/confidentialite");
});

test("un hébergeur peut désigner sa propre politique", async () => {
  const { corps } = await configAvec("https://exemple.org/vie-privee");
  assert.equal(corps.privacyUrl, "https://exemple.org/vie-privee");
});

// Une variable vide est ce qu'écrit n'importe quel gabarit de configuration pour une
// valeur absente — même piège que `CORS_ORIGIN=""`, qui rendait 500 sur tout. Elle
// doit valoir « non réglé », pas « chaîne vide », sinon le lien ne mène nulle part.
test("une valeur vide ou blanche retombe sur le défaut", async () => {
  assert.equal((await configAvec("")).corps.privacyUrl, "/confidentialite");
  assert.equal((await configAvec("   ")).corps.privacyUrl, "/confidentialite");
});
