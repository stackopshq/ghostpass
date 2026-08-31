// La liste blanche PAR DÉFAUT, c'est-à-dire celle qui s'applique quand le déploiement ne
// définit pas `SSO_MOBILE_REDIRECT_URIS`.
//
// Pourquoi un fichier à part : `sso-mobile.test.ts` pose cette variable dans son `before`, donc
// tout ce qu'il mesure passe par la liste explicite. Le défaut du code n'y est jamais exercé, et
// une erreur dedans y serait invisible. Or c'est lui qui s'applique en production, où la
// variable n'est pas posée.
import { test } from "node:test";
import assert from "node:assert/strict";

const PROD = "ch.stackops.ghostpass://sso";
const RECETTE = "ch.stackops.ghostpass.essai://sso";

/// Import dynamique : le module lit `process.env` à l'appel, pas au chargement, mais on garde
/// l'isolation pour ne dépendre d'aucun ordre de fichiers.
async function chargerAvec(env: Record<string, string | undefined>) {
  const avant = new Map<string, string | undefined>();
  for (const [k, v] of Object.entries(env)) {
    avant.set(k, process.env[k]);
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  const mod = await import("../src/services/oidc.js");
  return {
    mod,
    restaurer: () => {
      for (const [k, v] of avant) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    },
  };
}

test("défaut: les deux schémas iOS sont acceptés, production en tête", async () => {
  const { mod, restaurer } = await chargerAvec({
    OIDC_MOBILE_REDIRECT_URI: "https://vault.example.test/api/auth/sso/mobile/callback",
    SSO_MOBILE_REDIRECT_URIS: undefined,
  });
  try {
    const cfg = mod.getMobileConfig();
    assert.ok(cfg, "le SSO mobile doit être actif dès que l'adresse de retour IdP est posée");
    assert.deepEqual(cfg.allowedAppRedirects, [PROD, RECETTE]);

    // L'ordre n'est pas cosmétique : une requête qui ne demande rien repart sur le premier.
    assert.equal(mod.pickAppRedirect(cfg, undefined), PROD);
    assert.equal(mod.pickAppRedirect(cfg, PROD), PROD);
    assert.equal(mod.pickAppRedirect(cfg, RECETTE), RECETTE);
  } finally {
    restaurer();
  }
});

test("défaut: un schéma voisin reste refusé, préfixe compris", async () => {
  const { mod, restaurer } = await chargerAvec({
    OIDC_MOBILE_REDIRECT_URI: "https://vault.example.test/api/auth/sso/mobile/callback",
    SSO_MOBILE_REDIRECT_URIS: undefined,
  });
  try {
    const cfg = mod.getMobileConfig();
    assert.ok(cfg);
    for (const usurpateur of [
      "ch.stackops.ghostpass.evil://sso",
      "ch.stackops.ghostpass.essai.evil://sso",
      "ch.stackops.ghostpass://sso/../evil",
      "CH.STACKOPS.GHOSTPASS://sso",
      "ch.stackops.ghostpas://sso",
    ]) {
      assert.equal(mod.pickAppRedirect(cfg, usurpateur), null, usurpateur);
    }
  } finally {
    restaurer();
  }
});

test("une liste explicite remplace le défaut, elle ne s'y ajoute pas", async () => {
  const { mod, restaurer } = await chargerAvec({
    OIDC_MOBILE_REDIRECT_URI: "https://vault.example.test/api/auth/sso/mobile/callback",
    SSO_MOBILE_REDIRECT_URIS: PROD,
  });
  try {
    const cfg = mod.getMobileConfig();
    assert.ok(cfg);
    assert.deepEqual(cfg.allowedAppRedirects, [PROD]);
    assert.equal(mod.pickAppRedirect(cfg, RECETTE), null);
  } finally {
    restaurer();
  }
});

test("sans adresse de retour IdP, le SSO mobile reste éteint", async () => {
  const { mod, restaurer } = await chargerAvec({
    OIDC_MOBILE_REDIRECT_URI: undefined,
    SSO_MOBILE_REDIRECT_URIS: undefined,
  });
  try {
    assert.equal(mod.getMobileConfig(), null);
  } finally {
    restaurer();
  }
});
