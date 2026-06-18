// Client HTTP vers le backend. En dev, `/api` est relayé par le proxy Vite (voir vite.config.ts).
import type { RegistrationData } from "./crypto.js";

export interface ItemDto {
  id: string;
  encryptedKey: string;
  encryptedData: string;
  createdAt: number;
  updatedAt: number;
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
};
