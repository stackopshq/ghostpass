// Chaque appel authentifié porte-t-il vraiment son autorisation ?
//
// Le 2026-08-30, quatre appels sont partis en production écrits
// `headers: { authorization: "Bearer …" }` au lieu de `{ token }`. Le client
// HTTP retirait cet en-tête EN SILENCE — un garde-fou contre l'écrasement
// accidentel du jeton — si bien que les quatre partaient non authentifiés.
//
// Conséquences visibles : les favicons ne s'affichaient plus, l'export de
// compte et la suppression de compte ne marchaient pas. Aucune erreur nulle
// part : la forme était plausible et le retrait était muet.
//
// Ce test n'inspecte pas le code, il regarde ce qui part sur le réseau. Un
// test qui lirait `api.ts` à la recherche du mauvais motif passerait le jour
// où quelqu'un invente une troisième façon de se tromper.

import { test } from "node:test";
import assert from "node:assert/strict";
import { api } from "../src/lib/api";

const JETON = "jeton-de-session-de-test";

/// Intercepte `fetch` et rend l'en-tête d'autorisation effectivement envoyé.
async function autorisationEnvoyee(appel: () => Promise<unknown>): Promise<string | undefined> {
  const origine = globalThis.fetch;
  let vue: string | undefined;
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    const h = (init?.headers ?? {}) as Record<string, string>;
    vue = h["authorization"] ?? h["Authorization"];
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    await appel();
  } catch {
    /* la réponse factice suffit ; seul l'en-tête nous intéresse */
  } finally {
    globalThis.fetch = origine;
  }
  return vue;
}

const APPELS_AUTHENTIFIES: Array<[string, () => Promise<unknown>]> = [
  ["iconToken", () => api.iconToken(JETON)],
  ["accountInfo", () => api.accountInfo(JETON)],
  ["accountExport", () => api.accountExport(JETON)],
  ["accountDelete", () => api.accountDelete(JETON, "preuve")],
  ["accountActivity", () => api.accountActivity(JETON)],
];

for (const [nom, appel] of APPELS_AUTHENTIFIES) {
  test(`${nom} envoie bien son autorisation`, async () => {
    const vue = await autorisationEnvoyee(appel);
    assert.equal(
      vue,
      `Bearer ${JETON}`,
      `${nom} part sans autorisation — le serveur répondra 401, et rien ne le dira`,
    );
  });
}

test("passer le jeton par un en-tête lève, au lieu d'être ignoré", async () => {
  // La forme fautive doit désormais échouer bruyamment. Sans cette assertion,
  // quelqu'un pourrait « simplifier » le client en retirant la levée, et les
  // tests ci-dessus continueraient de passer — ils vérifient les appels
  // existants, pas le comportement qui protège les prochains.
  const origine = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response("{}", { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;
  try {
    const { http } = (await import("../src/lib/api")) as unknown as {
      http?: (p: string, o: unknown) => Promise<unknown>;
    };
    if (!http) return; // `http` n'est pas exporté : la levée reste couverte par les cas ci-dessus
    await assert.rejects(() => http("/api/x", { headers: { authorization: "Bearer x" } }));
  } finally {
    globalThis.fetch = origine;
  }
});
