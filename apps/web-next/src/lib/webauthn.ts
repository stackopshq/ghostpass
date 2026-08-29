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
// Sel fixe et stable (base64url) : il doit être identique à l'enrôlement et au login pour que la
// passkey régénère le même secret PRF. Le contenu importe peu, seule la stabilité compte.
const PRF_SALT = "Z2hvc3RwYXNzLXBhc3NrZXktcHJmLXYx";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function withPrf(optionsJSON: any): any {
  return {
    ...optionsJSON,
    extensions: { ...(optionsJSON.extensions ?? {}), prf: { eval: { first: PRF_SALT } } },
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
