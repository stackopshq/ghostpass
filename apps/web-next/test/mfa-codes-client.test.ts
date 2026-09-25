// Le client sait-il demander, et surtout RENDRE, les codes de récupération ?
//
// Des codes que l'interface ne montre jamais ne sauvent personne. Le serveur ne
// les rend qu'une fois — il n'en garde que les empreintes — donc un client qui
// les reçoit sans les exposer les perd définitivement, et sans erreur nulle
// part : la requête a réussi, l'écran a l'air normal, et le filet n'existe pas.
//
// Ces tests regardent ce qui part sur le réseau et ce qui revient de `api.ts`,
// pas le code source : un test qui chercherait un motif dans `api.ts` passerait
// le jour où quelqu'un trouve une troisième façon de se tromper.

import { test } from "node:test";
import assert from "node:assert/strict";
import { api } from "../src/lib/api";

const JETON = "jeton-de-session-de-test";

interface Vue {
  url: string;
  methode: string;
  corps: unknown;
  autorisation: string | undefined;
}

/// Intercepte `fetch`, rend la requête vue et sert la réponse donnée.
async function intercepter<T>(
  reponse: unknown,
  appel: () => Promise<T>,
): Promise<{ vue: Vue; resultat: T }> {
  const origine = globalThis.fetch;
  let vue: Vue | undefined;
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const h = (init?.headers ?? {}) as Record<string, string>;
    vue = {
      url: String(url),
      methode: init?.method ?? "GET",
      corps: init?.body ? JSON.parse(String(init.body)) : undefined,
      autorisation: h["authorization"] ?? h["Authorization"],
    };
    return new Response(JSON.stringify(reponse), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  try {
    const resultat = await appel();
    return { vue: vue!, resultat };
  } finally {
    globalThis.fetch = origine;
  }
}

const DIX_CODES = [
  "ABCDE-FGHJK", "MNPQR-STUVW", "XYZ23-45678", "9ABCD-EFGHJ", "KMNPQ-RSTUV",
  "WXYZ2-34567", "89ABC-DEFGH", "JKMNP-QRSTU", "VWXYZ-23456", "789AB-CDEFG",
];

test("l'activation rend les codes de récupération à l'appelant", async () => {
  // Le point le plus facile à perdre : le serveur les renvoie, et si le type de
  // retour ne les déclare pas, personne ne pense à les afficher.
  const { vue, resultat } = await intercepter(
    { enabled: true, recoveryCodes: DIX_CODES },
    () => api.mfaActivate(JETON, "123456"),
  );
  assert.match(vue.url, /\/api\/mfa\/activate$/);
  assert.equal(vue.methode, "POST");
  assert.equal(vue.autorisation, `Bearer ${JETON}`);
  assert.deepEqual(resultat.recoveryCodes, DIX_CODES);
});

test("l'état rend le nombre de codes restants", async () => {
  const { vue, resultat } = await intercepter(
    { enabled: true, recoveryCodesRemaining: 7 },
    () => api.mfaStatus(JETON),
  );
  assert.match(vue.url, /\/api\/mfa$/);
  assert.equal(vue.autorisation, `Bearer ${JETON}`);
  assert.equal(resultat.recoveryCodesRemaining, 7);
});

test("refaire la réserve envoie le mot de passe ET le code, et rend les nouveaux", async () => {
  // Le mot de passe n'est pas facultatif côté serveur : l'oublier donnerait
  // « requête invalide » sur un bouton qui n'aurait jamais pu marcher — c'est
  // exactement ce qui était arrivé à `/api/mfa/setup`.
  const { vue, resultat } = await intercepter({ recoveryCodes: DIX_CODES }, () =>
    api.mfaRegenerateRecoveryCodes(JETON, "preuve-derivee", "123456"),
  );
  assert.match(vue.url, /\/api\/mfa\/recovery-codes$/);
  assert.equal(vue.methode, "POST");
  assert.equal(vue.autorisation, `Bearer ${JETON}`);
  assert.deepEqual(vue.corps, { masterPasswordHash: "preuve-derivee", code: "123456" });
  assert.deepEqual(resultat.recoveryCodes, DIX_CODES);
});

test("la connexion transmet un code de récupération tel quel, sans le filtrer", async () => {
  // Le champ de connexion sert aux deux : six chiffres ou un code de
  // récupération. Si le client n'envoyait que des chiffres, le filet serait
  // inutilisable là où il sert précisément — le téléphone perdu.
  const origine = globalThis.fetch;
  let corps: Record<string, unknown> | undefined;
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    corps = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({ token: "t", kdfParams: "{}", encryptedUserKey: "", encryptedPrivateKey: "" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  try {
    await api.login("kevin@stackops.ch", "hash", { totpCode: "ABCDE-FGHJK" });
  } finally {
    globalThis.fetch = origine;
  }
  assert.equal(corps?.totpCode, "ABCDE-FGHJK");
});
