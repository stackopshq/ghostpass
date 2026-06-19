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
