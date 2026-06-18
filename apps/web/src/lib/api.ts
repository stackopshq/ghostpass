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
    totpCode?: string,
  ): Promise<
    | {
        ok: true;
        token: string;
        kdfParams: string;
        encryptedUserKey: string;
        encryptedPrivateKey: string;
      }
    | { ok: false; mfaRequired: boolean; error: string }
  > {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, masterPasswordHash, totpCode }),
    });
    const data = await res.json().catch(() => ({}) as Record<string, unknown>);
    if (res.ok) return { ok: true, ...(data as Record<string, never>) } as never;
    return {
      ok: false,
      mfaRequired: data.mfaRequired === true,
      error: typeof data.error === "string" ? data.error : `HTTP ${res.status}`,
    };
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

  // ─── Organisations / partage ───
  createOrg(token: string, body: { name: string; encryptedOrgKey: string }) {
    return http<{ orgId: string }>("/api/orgs", { method: "POST", body, token });
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
  createCollection(token: string, orgId: string, body: { name: string }) {
    return http<{ id: string; name: string }>(`/api/orgs/${orgId}/collections`, {
      method: "POST",
      body,
      token,
    });
  },
  listCollections(token: string, orgId: string) {
    return http<{ collections: Array<{ id: string; name: string }> }>(
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
