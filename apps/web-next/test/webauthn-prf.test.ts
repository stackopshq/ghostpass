import { test } from "node:test";
import assert from "node:assert/strict";
import { base64urlEnOctets, withPrf } from "../src/lib/webauthn.js";

// Ce fichier existe à cause d'une panne signalée depuis un vrai navigateur le 2026-09-26.
// Cliquer « Ajouter une passkey » levait :
//
//     Failed to read the 'first' property from 'AuthenticationExtensionsPRFValues':
//     The provided value is not of type '(ArrayBuffer or ArrayBufferView)'
//
// Le sel partait en base64url, là où la spécification attend un `BufferSource`. Ni
// `registerPasskey` ni `authenticatePasskey` ne pouvaient donc aboutir : la connexion sans mot
// de passe, mise en avant sur l'écran d'entrée, n'avait jamais fonctionné.
//
// Rien ne l'a vu parce que la seule frontière capable de refuser cette valeur est
// `navigator.credentials`, que le navigateur seul possède. Ce test ne la simule pas : il vérifie
// ce que NOUS produisons, ce qui est la moitié qu'on peut tenir sans navigateur.

test("le sel PRF part en octets, jamais en chaîne", () => {
  const { extensions } = withPrf({ challenge: "abc" });
  const premier = extensions.prf.eval.first;
  assert.ok(
    premier instanceof Uint8Array || premier instanceof ArrayBuffer || ArrayBuffer.isView(premier),
    `prf.eval.first doit être un BufferSource, reçu ${typeof premier}`,
  );
  assert.ok(premier.byteLength > 0, "un sel vide ne dérive rien");
});

test("withPrf n'écrase pas les extensions que le serveur a déjà posées", () => {
  const { extensions } = withPrf({ extensions: { credProps: true } });
  assert.equal(extensions.credProps, true);
  assert.ok(extensions.prf, "l'extension PRF doit s'ajouter, pas remplacer");
});

test("le sel est stable : une passkey enrôlée doit se rouvrir", () => {
  // Si cette valeur change, tout secret PRF déjà dérivé devient irretrouvable.
  const a = withPrf({}).extensions.prf.eval.first;
  const b = withPrf({}).extensions.prf.eval.first;
  assert.deepEqual([...a], [...b]);
  assert.deepEqual([...a], [...base64urlEnOctets("Z2hvc3RwYXNzLXBhc3NrZXktcHJmLXYx")]);
});

test("base64urlEnOctets décode l'alphabet URL et le remplissage absent", () => {
  assert.deepEqual([...base64urlEnOctets("YQ")], [0x61]); // "a", sans « = »
  assert.deepEqual([...base64urlEnOctets("-_8")], [0xfb, 0xff]); // « - » et « _ »
});
