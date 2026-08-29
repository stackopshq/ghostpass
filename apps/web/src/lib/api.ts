// Client HTTP vers le backend. En dev, `/api` est relayé par le proxy Vite (voir vite.config.ts).
import type { RegistrationData } from "./crypto.js";

export interface ItemDto {
  id: string;
  encryptedKey: string;
  encryptedData: string;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number | null;
}

async function http<T>(
  path: string,
  opts: { method?: string; body?: unknown; token?: string } = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  if (opts.token) headers["authorization"] = `Bearer ${opts.token}`;

  const res = await fetch(path, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });

  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const data = await res.json();
      if (data?.error) message = data.error;
    } catch {
      /* corps non JSON */
    }
    throw new Error(message);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  register(data: RegistrationData) {
    return http<{ userId: string; token: string }>("/api/auth/register", {
      method: "POST",
      body: data,
    });
  },
  prelogin(email: string) {
    return http<{ kdfParams: string }>("/api/auth/prelogin", {
      method: "POST",
      body: { email },
    });
  },
  // Login : ne « throw » pas sur 401 afin de pouvoir détecter le cas 2FA requise.
  async login(
    email: string,
    masterPasswordHash: string,
    opts: { totpCode?: string; webauthnResponse?: unknown } = {},
  ): Promise<
    | {
        ok: true;
        token: string;
        kdfParams: string;
        encryptedUserKey: string;
        encryptedPrivateKey: string;
      }
    | { ok: false; mfaRequired: boolean; mfaType?: string; options?: unknown; error: string }
  > {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email,
        masterPasswordHash,
        totpCode: opts.totpCode,
        webauthnResponse: opts.webauthnResponse,
      }),
    });
    const data = await res.json().catch(() => ({}) as Record<string, unknown>);
    if (res.ok) return { ok: true, ...(data as Record<string, never>) } as never;
    return {
      ok: false,
      mfaRequired: data.mfaRequired === true,
      mfaType: typeof data.mfaType === "string" ? data.mfaType : undefined,
      options: data.options,
      error: typeof data.error === "string" ? data.error : `HTTP ${res.status}`,
    };
  },

  // ─── SSO OIDC (identité fédérée ; le mot de passe maître reste requis pour déverrouiller) ───
  ssoStatus() {
    return http<{ enabled: boolean }>("/api/auth/sso/status");
  },
  ssoLogin() {
    return http<{ url: string }>("/api/auth/sso/login");
  },
  ssoCallback(code: string, state: string) {
    return http<{
      token: string;
      email: string;
      kdfParams: string;
      encryptedUserKey: string;
      encryptedPrivateKey: string;
    }>(`/api/auth/sso/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`);
  },

  webauthnRegisterOptions(token: string) {
    return http<unknown>("/api/mfa/webauthn/register/options", { method: "POST", token });
  },
  webauthnRegisterVerify(token: string, body: { response: unknown; name: string }) {
    return http<{ ok: boolean }>("/api/mfa/webauthn/register/verify", {
      method: "POST",
      body,
      token,
    });
  },
  webauthnCredentials(token: string) {
    return http<{ credentials: Array<{ id: string; name: string; createdAt: number }> }>(
      "/api/mfa/webauthn/credentials",
      { token },
    );
  },
  webauthnDeleteCredential(token: string, id: string) {
    return http<void>(`/api/mfa/webauthn/credentials/${id}`, { method: "DELETE", token });
  },
  // ─── Passkeys (déverrouillage sans mot de passe) ───
  passkeyRegisterOptions(token: string) {
    return http<unknown>("/api/passkey/register/options", { method: "POST", token });
  },
  passkeyRegisterVerify(
    token: string,
    body: { response: unknown; name: string; prfWrappedUserKey: string },
  ) {
    return http<{ ok: boolean }>("/api/passkey/register/verify", { method: "POST", body, token });
  },
  passkeyCredentials(token: string) {
    return http<{ credentials: Array<{ id: string; name: string; createdAt: number }> }>(
      "/api/passkey/credentials",
      { token },
    );
  },
  passkeyDeleteCredential(token: string, id: string) {
    return http<void>(`/api/passkey/credentials/${id}`, { method: "DELETE", token });
  },
  passkeyLoginOptions(email: string) {
    return http<unknown>("/api/auth/passkey/options", { method: "POST", body: { email } });
  },
  passkeyLogin(email: string, response: unknown) {
    return http<{ token: string; prfWrappedUserKey: string; encryptedPrivateKey: string }>(
      "/api/auth/passkey/login",
      { method: "POST", body: { email, response } },
    );
  },

  accountActivity(token: string) {
    return http<{
      events: Array<{ ip: string; userAgent: string; newDevice: boolean; createdAt: number }>;
    }>("/api/account/activity", { token });
  },

  // ─── Accès d'urgence ───
  listEmergency(token: string) {
    type Grantor = {
      id: string;
      contactEmail: string;
      role: string;
      waitDays: number;
      status: string;
      requestedAt: number | null;
    };
    return http<{ asGrantor: Grantor[]; asGrantee: Array<Grantor & { available: boolean }> }>(
      "/api/emergency",
      { token },
    );
  },
  createEmergency(
    token: string,
    body: { email: string; role: string; waitDays: number; sealedUserKey: string },
  ) {
    return http<{ ok: boolean }>("/api/emergency", { method: "POST", body, token });
  },
  emergencyAction(token: string, id: string, action: "accept" | "request" | "approve" | "reject") {
    return http<{ ok: boolean }>(`/api/emergency/${id}/${action}`, { method: "POST", token });
  },
  removeEmergency(token: string, id: string) {
    return http<void>(`/api/emergency/${id}`, { method: "DELETE", token });
  },
  emergencyAccess(token: string, id: string) {
    return http<{
      role: string;
      sealedUserKey: string;
      grantorPublicKey: string;
      grantorEmail: string;
      grantorKdfParams: string;
      items: Array<{ id: string; encryptedKey: string; encryptedData: string }>;
    }>(`/api/emergency/${id}/access`, { token });
  },
  emergencyTakeover(
    token: string,
    id: string,
    body: { newMasterPasswordHash: string; newEncryptedUserKey: string },
  ) {
    return http<{ ok: boolean }>(`/api/emergency/${id}/takeover`, { method: "POST", body, token });
  },

  mfaSetup(token: string) {
    return http<{ secret: string; otpauthUri: string }>("/api/mfa/setup", {
      method: "POST",
      token,
    });
  },
  mfaActivate(token: string, code: string) {
    return http<{ enabled: boolean }>("/api/mfa/activate", {
      method: "POST",
      body: { code },
      token,
    });
  },

  enrollRecovery(token: string, body: { recoveryAuthHash: string; encryptedUserKeyRecovery: string }) {
    return http<{ ok: boolean }>("/api/account/recovery", { method: "POST", body, token });
  },
  recoveryBlob(email: string) {
    return http<{ kdfParams: string; encryptedUserKeyRecovery: string; encryptedPrivateKey: string }>(
      "/api/auth/recovery-blob",
      { method: "POST", body: { email } },
    );
  },
  recover(body: {
    email: string;
    recoveryAuthHash: string;
    newMasterPasswordHash: string;
    newEncryptedUserKey: string;
  }) {
    return http<{ ok: boolean }>("/api/auth/recover", { method: "POST", body });
  },
  listItems(token: string) {
    return http<{ items: ItemDto[] }>("/api/vault/items", { token });
  },
  createItem(token: string, body: { encryptedKey: string; encryptedData: string }) {
    return http<ItemDto>("/api/vault/items", { method: "POST", body, token });
  },
  updateItem(token: string, id: string, body: { encryptedKey: string; encryptedData: string }) {
    return http<ItemDto>(`/api/vault/items/${id}`, { method: "PUT", body, token });
  },
  deleteItem(token: string, id: string) {
    return http<void>(`/api/vault/items/${id}`, { method: "DELETE", token });
  },
  listTrash(token: string) {
    return http<{ items: ItemDto[] }>("/api/vault/trash", { token });
  },
  restoreItem(token: string, id: string) {
    return http<{ ok: boolean }>(`/api/vault/trash/${id}/restore`, { method: "POST", token });
  },
  purgeItem(token: string, id: string) {
    return http<void>(`/api/vault/trash/${id}`, { method: "DELETE", token });
  },
  createSend(
    token: string,
    body: { ciphertext: string; iv: string; expiresInHours: number; maxViews: number },
  ) {
    return http<{ id: string }>("/api/send", { method: "POST", body, token });
  },
  getSend(id: string) {
    return http<{ ciphertext: string; iv: string }>(`/api/send/${id}`);
  },

  // ─── Organisations / partage ───
  createOrg(token: string, body: { name: string; encryptedOrgKey: string }) {
    return http<{ orgId: string }>("/api/orgs", { method: "POST", body, token });
  },
  // Suppression définitive d'une organisation. Le serveur refuse tant qu'elle contient des
  // collections, des secrets ou d'autres membres actifs, et rend alors un 409 dont le message
  // porte le décompte : il doit remonter tel quel jusqu'à l'écran.
  deleteOrg(token: string, orgId: string) {
    return http<void>(`/api/orgs/${orgId}`, { method: "DELETE", token });
  },
  listOrgs(token: string) {
    return http<{
      organizations: Array<{ orgId: string; name: string; role: string; status: string }>;
    }>("/api/orgs", { token });
  },
  lookupPublicKey(token: string, email: string) {
    return http<{ userId: string; publicKey: string }>(
      `/api/users/lookup?email=${encodeURIComponent(email)}`,
      { token },
    );
  },
  addMember(
    token: string,
    orgId: string,
    body: { email: string; role: string; encryptedOrgKey: string },
  ) {
    return http<{ ok: boolean }>(`/api/orgs/${orgId}/members`, { method: "POST", body, token });
  },
  acceptInvite(token: string, orgId: string) {
    return http<{ status: string }>(`/api/orgs/${orgId}/accept`, { method: "POST", token });
  },
  getMembership(token: string, orgId: string) {
    return http<{
      role: string;
      status: string;
      encryptedOrgKey: string | null;
      sealedByPublicKey: string | null;
    }>(`/api/orgs/${orgId}/membership`, { token });
  },
  listMembers(token: string, orgId: string) {
    return http<{
      members: Array<{
        userId: string;
        email: string | null;
        publicKey: string | null;
        role: string;
        status: string;
      }>;
    }>(`/api/orgs/${orgId}/members`, { token });
  },
  listOrgItems(token: string, orgId: string) {
    return http<{ items: ItemDto[] }>(`/api/orgs/${orgId}/items`, { token });
  },
  rotateOrg(
    token: string,
    orgId: string,
    body: {
      revokeUserId?: string;
      members: Array<{ userId: string; encryptedOrgKey: string }>;
      items: Array<{ id: string; encryptedKey: string }>;
    },
  ) {
    return http<{ ok: boolean }>(`/api/orgs/${orgId}/rotate`, { method: "POST", body, token });
  },
  /// Supprimer une collection.
  ///
  /// Le serveur refuse tant qu'elle contient un secret (409 avec le compte) et
  /// refuse la collection par defaut (409, `reason: "default"`). On laisse donc
  /// remonter le message : c'est lui qui dit quoi faire, pas le code d'erreur.
  deleteCollection(token: string, orgId: string, collectionId: string) {
    return http<void>(`/api/orgs/${orgId}/collections/${collectionId}`, {
      method: "DELETE",
      token,
    });
  },

  createCollection(token: string, orgId: string, body: { name: string }) {
    return http<{ id: string; name: string }>(`/api/orgs/${orgId}/collections`, {
      method: "POST",
      body,
      token,
    });
  },
  listCollections(token: string, orgId: string) {
    // `permission` est OPTIONNEL, et c'est un choix : un serveur antérieur au
    // 2026-08-29 ne le renvoie pas, et l'exiger ferait échouer le décodage de la
    // liste entière — l'utilisateur perdrait ses organisations au lieu de perdre
    // seulement la finesse des boutons. Absent, on retombe sur le comportement
    // prudent : aucune écriture sur un élément d'équipe.
    return http<{
      collections: Array<{
        id: string;
        name: string;
        permission?: "read" | "write" | "manage";
      }>;
    }>(
      `/api/orgs/${orgId}/collections`,
      { token },
    );
  },
  listCollectionItems(token: string, orgId: string, collectionId: string) {
    return http<{ items: ItemDto[] }>(`/api/orgs/${orgId}/collections/${collectionId}/items`, {
      token,
    });
  },
  createOrgItem(
    token: string,
    orgId: string,
    collectionId: string,
    body: { encryptedKey: string; encryptedData: string },
  ) {
    return http<ItemDto>(`/api/orgs/${orgId}/collections/${collectionId}/items`, {
      method: "POST",
      body,
      token,
    });
  },
  /// Met a jour un identifiant d'organisation. La route existait cote serveur
  /// depuis l'origine ; c'est l'interface qui n'avait aucun moyen de l'appeler,
  /// donc un mot de passe entre dans une collection ne pouvait plus etre
  /// corrige -- il fallait le supprimer et le ressaisir.
  /// Supprimer un element partage.
  ///
  /// La route existait cote serveur depuis l'origine (permission `write`), mais
  /// aucun appelant ne s'en servait : l'interface offrait « Modifier » et rien
  /// pour retirer. Une entree d'equipe creee par erreur restait donc pour
  /// toujours, et la liste personnelle renvoyait vers un ecran qui ne savait pas
  /// le faire non plus.
  deleteOrgItem(token: string, orgId: string, collectionId: string, itemId: string) {
    return http<void>(`/api/orgs/${orgId}/collections/${collectionId}/items/${itemId}`, {
      method: "DELETE",
      token,
    });
  },

  updateOrgItem(
    token: string,
    orgId: string,
    collectionId: string,
    itemId: string,
    body: { encryptedKey: string; encryptedData: string },
  ) {
    return http<ItemDto>(`/api/orgs/${orgId}/collections/${collectionId}/items/${itemId}`, {
      method: "PUT",
      body,
      token,
    });
  },
  /// Qui a acces a une collection, et retrait de cet acces.
  listCollectionAccess(token: string, orgId: string, collectionId: string) {
    // L'accès EFFECTIF : le rôle d'admin et l'appartenance à un groupe donnent
    // l'accès sans laisser de ligne, et les omettre est ce qui faisait afficher
    // « personne » sur une collection que deux personnes utilisaient.
    return http<{
      access: Array<{
        userId: string;
        email: string | null;
        permission: string;
        sources: Array<{ kind: string; label: string; permission: string }>;
        revocable: boolean;
      }>;
    }>(`/api/orgs/${orgId}/collections/${collectionId}/access`, { token });
  },
  revokeCollectionAccess(token: string, orgId: string, collectionId: string, userId: string) {
    return http<void>(`/api/orgs/${orgId}/collections/${collectionId}/access/${userId}`, {
      method: "DELETE",
      token,
    });
  },
  grantCollectionAccess(
    token: string,
    orgId: string,
    collectionId: string,
    body: { userId: string; permission: string },
  ) {
    return http<{ ok: boolean }>(`/api/orgs/${orgId}/collections/${collectionId}/access`, {
      method: "POST",
      body,
      token,
    });
  },
};
