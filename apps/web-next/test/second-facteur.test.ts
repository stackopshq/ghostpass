// Le panneau de sécurité se contredisait lui-même.
//
// POURQUOI CE FICHIER EXISTE
// --------------------------
// Après avoir activé la 2FA, scanné le QR et enregistré ses dix codes de
// récupération, l'écran affichait toujours le bouton « Activer la 2FA » —
// juste à côté de « 10 codes de récupération restants sur 10 » et d'un bouton
// « Nouveaux codes de récupération », qui n'ont de sens que si elle est active.
//
// La cause : la condition d'affichage du bouton ne consultait PAS l'état du
// second facteur. Elle valait `!mfa && motDePasse2fa === null` — c'est-à-dire
// « aucune configuration en cours », rien de plus. L'information existait
// pourtant deux fois dans le même composant, `infoCompte.mfaEnabled` et la
// réponse de `mfaStatus`, et le bouton ne lisait ni l'une ni l'autre.
//
// Encore le motif de la maison : la chose existait, rien ne la lisait.
//
// DEUXIÈME DÉFAUT, TROUVÉ EN CORRIGEANT LE PREMIER
// -------------------------------------------------
// `POST /api/mfa/disable` existe côté serveur — `apps/server/src/routes/mfa.ts`,
// testée — et AUCUN client web ne l'appelait. Il n'y avait donc aucun moyen de
// désactiver la 2FA depuis le web. L'absence ne se voyait pas : on ne cherche
// pas un bouton dont on ignore qu'il devrait exister.
//
// CE QUE CES TESTS SURVEILLENT
// -----------------------------
// La décision est sortie du JSX pour être tenable. Une condition en ligne dans
// un rendu n'est éprouvable que par un rendu complet, et c'est bien ce qui
// l'avait laissée fausse tout ce temps.

import { test } from "node:test";
import assert from "node:assert/strict";
import { actionSecondFacteur } from "../src/lib/mfa";
import { api } from "../src/lib/api";

// LE test de ce fichier : c'est cette ligne-là qui était fausse en production.
test("second facteur actif : on ne propose plus de l'activer", () => {
  assert.equal(actionSecondFacteur(true), "desactiver");
});

test("second facteur inactif : on propose de l'activer", () => {
  assert.equal(actionSecondFacteur(false), "activer");
});

// Trois états, jamais deux. `mfaStatus` a son propre `.catch` : un état
// illisible n'est pas un état inactif, et le dire serait remettre le défaut.
test("état illisible : on ne propose rien plutôt que d'affirmer", () => {
  assert.equal(actionSecondFacteur(null), null);
});

/// Intercepte `fetch` et rend le chemin et le corps effectivement envoyés.
async function envoye(appel: () => Promise<unknown>) {
  const origine = globalThis.fetch;
  let chemin = "";
  let corps: unknown = null;
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    chemin = String(url);
    corps = init?.body ? JSON.parse(String(init.body)) : null;
    return new Response('{"enabled":false}', {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  try {
    await appel();
  } finally {
    globalThis.fetch = origine;
  }
  return { chemin, corps };
}

// Le serveur exige le mot de passe maître ET un second facteur : retirer une
// porte demande d'en franchir une. Un appel qui n'enverrait que l'un des deux
// rendrait 400, et l'écran afficherait « requête invalide » sans dire lequel.
test("la désactivation porte la preuve du mot de passe et le code", async () => {
  const { chemin, corps } = await envoye(() =>
    api.mfaDisable("jeton", "preuve-du-mot-de-passe", "123456"),
  );
  assert.ok(chemin.endsWith("/api/mfa/disable"), chemin);
  assert.deepEqual(corps, {
    masterPasswordHash: "preuve-du-mot-de-passe",
    code: "123456",
  });
});

// Les quatre libellés doivent exister dans LES DEUX dictionnaires. La charte
// l'exige, et une clé absente s'affiche en clair à l'écran.
test("les libellés du second facteur sont traduits des deux côtés", async () => {
  const source = await import("node:fs").then((fs) =>
    fs.readFileSync(new URL("../src/lib/i18n.ts", import.meta.url), "utf8"),
  );
  for (const cle of [
    "app.disable2fa",
    "app.twoFactorOn",
    "app.twoFactorUnknown",
    "app.disable2faWarning",
  ]) {
    const n = source.split(`"${cle}":`).length - 1;
    assert.equal(n, 2, `${cle} apparaît ${n} fois, il en faut 2 (en + fr)`);
  }
});
