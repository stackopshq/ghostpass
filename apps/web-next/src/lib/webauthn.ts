// Fines enveloppes autour de @simplewebauthn/browser.
// ⚠️ navigator.credentials exige un contexte sécurisé (https ou localhost). Hors de ce cadre,
// startRegistration/startAuthentication lèvent — l'appelant doit afficher un message clair.
import { startAuthentication, startRegistration } from "@simplewebauthn/browser";

export function webAuthnSupported(): boolean {
  return typeof window !== "undefined" && !!window.PublicKeyCredential && window.isSecureContext;
}

/// Crée une credential (enregistrement d'une clé) à partir des options serveur.
export function createCredential(optionsJSON: unknown): Promise<unknown> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return startRegistration({ optionsJSON: optionsJSON as any });
}

/// Produit une assertion (login) à partir des options serveur.
export function getAssertion(optionsJSON: unknown): Promise<unknown> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return startAuthentication({ optionsJSON: optionsJSON as any });
}

// ─── Passkey passwordless via l'extension PRF ───
//
// Sel fixe et stable : il doit être identique à l'enrôlement et au login pour que la passkey
// régénère le même secret PRF. Le contenu importe peu, seule la stabilité compte.
//
// ⚠️ `prf.eval.first` est un `BufferSource` DANS LA SPÉCIFICATION, pas une chaîne. Ce sel était
// passé tel quel, en base64url, et le navigateur refusait la cérémonie entière :
//
//     Failed to read the 'first' property from 'AuthenticationExtensionsPRFValues':
//     The provided value is not of type '(ArrayBuffer or ArrayBufferView)'
//
// Aucune passkey n'a donc jamais pu être enrôlée ni utilisée depuis un navigateur — ni
// `registerPasskey`, ni `authenticatePasskey`, qui partagent cette fonction. La conséquence est
// qu'il n'y a AUCUN enrôlement existant à préserver : changer l'interprétation du sel ne casse
// la clé de personne.
//
// `@simplewebauthn/browser` ne pouvait pas rattraper le coup : il convertit les champs qu'il
// connaît (`challenge`, `user.id`, `excludeCredentials[].id`) et laisse `extensions` intact,
// puisque c'est une zone d'extension dont le contenu ne lui appartient pas.
const PRF_SALT_B64URL = "Z2hvc3RwYXNzLXBhc3NrZXktcHJmLXYx";

/// base64url → octets. Exportée pour que le test puisse mesurer ce qui part vraiment.
export function base64urlEnOctets(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=");
  const brut = atob(b64);
  return Uint8Array.from(brut, (c) => c.charCodeAt(0));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function withPrf(optionsJSON: any): any {
  return {
    ...optionsJSON,
    extensions: {
      ...(optionsJSON.extensions ?? {}),
      prf: { eval: { first: base64urlEnOctets(PRF_SALT_B64URL) } },
    },
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractPrf(response: any): string {
  const r = response?.clientExtensionResults?.prf?.results?.first;
  if (!r) {
    throw new Error("Cette passkey ne supporte pas PRF (authentificateur/navigateur incompatible).");
  }
  if (typeof r === "string") {
    // base64url → base64 standard (attendu par le module WASM).
    return r.replace(/-/g, "+").replace(/_/g, "/");
  }
  return btoa(String.fromCharCode(...new Uint8Array(r as ArrayBuffer)));
}

/// Enrôle une passkey de déverrouillage : renvoie la réponse WebAuthn + le secret PRF (base64).
export async function registerPasskey(optionsJSON: unknown): Promise<{ response: unknown; prf: string }> {
  const response = await startRegistration({ optionsJSON: withPrf(optionsJSON) });
  return { response, prf: extractPrf(response) };
}

/// Authentifie via une passkey : renvoie la réponse WebAuthn + le secret PRF (base64).
export async function authenticatePasskey(optionsJSON: unknown): Promise<{ response: unknown; prf: string }> {
  const response = await startAuthentication({ optionsJSON: withPrf(optionsJSON) });
  return { response, prf: extractPrf(response) };
}
