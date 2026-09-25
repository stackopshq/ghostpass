// Client HTTP vers le backend. En dev, `/api` est relayé par le proxy Vite (voir vite.config.ts).
import type { RegistrationData } from "./crypto.js";

/// Ce qu'une réponse a le droit de peser : 32 Mio, la borne du client iOS.
///
/// Le chiffre est le même des deux côtés à dessein — deux bornes différentes
/// pour un même serveur, c'est une réponse qu'un client accepte et que l'autre
/// refuse, et un rapport de bogue impossible à reproduire.
///
/// Nommée plutôt qu'écrite au milieu du code : c'est la seule façon de la
/// changer sans en oublier une occurrence, et de la lire depuis un test.
export const TAILLE_MAX_REPONSE = 32 * 1024 * 1024;

/// Levée quand une réponse dépasse la borne, avant qu'elle ne soit entière en
/// mémoire. Un type à part plutôt qu'un `Error` nu : l'appelant qui voudra un
/// jour distinguer « le serveur déborde » de « le serveur a répondu 500 » n'aura
/// pas à comparer des chaînes.
export class ReponseTropVolumineuse extends Error {
  constructor(octets: number, annoncee = false) {
    super(
      annoncee
        ? `réponse trop volumineuse : ${octets} octets annoncés, borne ${TAILLE_MAX_REPONSE}`
        : `réponse trop volumineuse : plus de ${TAILLE_MAX_REPONSE} octets reçus`,
    );
    this.name = "ReponseTropVolumineuse";
  }
}

/// Lit un corps de réponse en comptant les octets AU FUR ET À MESURE.
///
/// C'est tout le sujet, et la remarque du pair iOS qui l'a ouvert : une borne
/// posée au décodage ne borne rien. `await res.json()` rapatrie le corps entier
/// avant de rendre la main ; mesurer sa taille ensuite ne fait que constater ce
/// qui est déjà arrivé — la mémoire est prise, et un serveur qui émet sans
/// s'arrêter a déjà gagné.
///
/// Le cas qui compte est celui du serveur qui N'ANNONCE PAS `Content-Length`.
/// L'en-tête est une déclaration, pas une mesure : un serveur hostile ne le
/// remplit pas, ou le remplit faux. On l'utilise donc comme un refus précoce
/// — inutile d'ouvrir un flux dont on nous dit qu'il déborde — et jamais comme
/// une garantie. Le compteur, lui, ne dépend de personne.
///
/// Au franchissement, on ANNULE : `abandonner()` avorte la requête et le
/// lecteur est annulé. Se contenter d'arrêter de lire laisserait la connexion
/// ouverte et le serveur continuer d'émettre dans un tampon que personne ne
/// vide — ce n'est pas une protection, c'est un déni de service poli.
async function lireCorpsBorne(res: Response, abandonner: () => void): Promise<string> {
  const annonce = Number(res.headers.get("content-length"));
  if (Number.isFinite(annonce) && annonce > TAILLE_MAX_REPONSE) {
    abandonner();
    await res.body?.cancel().catch(() => {});
    throw new ReponseTropVolumineuse(annonce, true);
  }

  // Pas de flux : réponse sans corps (204, HEAD) ou environnement qui n'en
  // expose pas. Rien à borner, et `text()` rend la chaîne vide.
  if (!res.body) return await res.text();

  const lecteur = res.body.getReader();
  // Mode incrémental : un caractère multi-octets à cheval sur deux morceaux se
  // recolle. Sans `{ stream: true }` il deviendrait « � » et le JSON serait
  // illisible — un défaut qui n'apparaît qu'en production, où les corps
  // arrivent découpés.
  const decodeur = new TextDecoder();
  let recus = 0;
  let texte = "";
  for (;;) {
    const { done, value } = await lecteur.read();
    if (done) break;
    recus += value.byteLength;
    if (recus > TAILLE_MAX_REPONSE) {
      abandonner();
      await lecteur.cancel().catch(() => {});
      throw new ReponseTropVolumineuse(recus);
    }
    texte += decodeur.decode(value, { stream: true });
  }
  return texte + decodeur.decode();
}

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
  opts: { method?: string; body?: unknown; token?: string; headers?: Record<string, string> } = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  if (opts.token) headers["authorization"] = `Bearer ${opts.token}`;
  // Les en-têtes de l'appelant en DERNIER, mais l'autorisation ne se passe pas
  // par là : elle se passe par `opts.token`.
  //
  // Ce garde-fou RETIRAIT silencieusement un `authorization` fourni ici, et ce
  // silence a coûté cher : quatre appels écrits avec `headers: { authorization }`
  // sont partis en production sans aucune autorisation. Ils rendaient 401, les
  // favicons ne s'affichaient plus, et l'export comme la suppression de compte
  // ne marchaient pas — sans que rien ne le dise, puisque la forme était
  // plausible et que le retrait était muet.
  //
  // Il lève maintenant. Un garde-fou qui corrige en silence transforme une
  // faute de frappe en défaut de production ; un garde-fou qui refuse la
  // transforme en erreur au premier appel.
  for (const [k, v] of Object.entries(opts.headers ?? {})) {
    if (k.toLowerCase() === "authorization")
      throw new Error(
        "http() : passer le jeton par `token`, pas par un en-tête `authorization` — " +
          "il serait ignoré et la requête partirait non authentifiée",
      );
    headers[k] = v;
  }

  // Le contrôleur sert à AVORTER la requête si la réponse déborde. Sans lui,
  // annuler le lecteur cesserait de lire sans fermer la connexion.
  const controle = new AbortController();
  const res = await fetch(path, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    signal: controle.signal,
  });

  if (!res.ok) {
    // Le corps d'une erreur se lit lui aussi, donc il se borne lui aussi : un
    // 500 dont le corps ne s'arrête jamais coûte exactement autant qu'un 200.
    // La lecture est HORS du `try` : un dépassement doit remonter tel quel,
    // pas être avalé comme un « corps non JSON » et rendu en « HTTP 500 ».
    const brut = await lireCorpsBorne(res, () => controle.abort());
    let message = `HTTP ${res.status}`;
    try {
      const data = JSON.parse(brut);
      if (data?.error) message = data.error;
    } catch {
      /* corps non JSON */
    }
    throw new Error(message);
  }
  if (res.status === 204) return undefined as T;
  return JSON.parse(await lireCorpsBorne(res, () => controle.abort())) as T;
}

export const api = {
  /// Le jeton que les balises `<img>` accrochent à l'URL du proxy de favicons.
  /// Une image ne porte pas d'en-tête d'autorisation, et la route ne peut plus
  /// être publique : son cache est désormais cloisonné par utilisateur, et
  /// c'est ce cloisonnement qui ferme l'oracle de cache.
  iconToken(token: string) {
    return http<{ token: string; expiresAt: number }>("/api/icons/token", { token });
  },
  /// Ce que le client doit savoir du compte ouvert : l'adresse et les
  /// paramètres KDF lui servent à recalculer la preuve d'authentification.
  accountInfo(token: string) {
    return http<{ email: string; kdfParams: string; mfaEnabled: boolean; createdAt: number }>(
      "/api/account",
      { token },
    );
  },
  /// Tout ce que le serveur détient sur vous, chiffré tel qu'il le détient.
  /// Nous ne pouvons pas déchiffrer, donc nous n'exportons pas en clair : c'est
  /// la contrepartie exacte du zero-knowledge, pas une limite de l'export.
  accountExport(token: string) {
    return http<Record<string, unknown>>("/api/account/export", { token });
  },
  /// Effacement définitif. Le mot de passe est redemandé : une session ouverte
  /// prouve qu'on est devant l'écran, pas qu'on est la titulaire du compte.
  accountDelete(token: string, serverPassword: string, totpCode?: string) {
    return http<void>("/api/account", {
      method: "DELETE",
      token,
      body: { serverPassword, ...(totpCode ? { totpCode } : {}) },
    });
  },
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
    // `login` fait son propre `fetch` pour distinguer « 2FA requise » d'un
    // refus — mais il lit un corps comme les autres, et se borne comme eux.
    // Un chemin de côté est exactement ce qu'une protection posée au seul
    // endroit évident laisse dehors.
    const controle = new AbortController();
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email,
        masterPasswordHash,
        totpCode: opts.totpCode,
        webauthnResponse: opts.webauthnResponse,
      }),
      signal: controle.signal,
    });
    const brut = await lireCorpsBorne(res, () => controle.abort());
    let data: Record<string, unknown> = {};
    try {
      const analyse = JSON.parse(brut);
      if (analyse && typeof analyse === "object") data = analyse as Record<string, unknown>;
    } catch {
      /* corps non JSON : on garde le code de statut comme seule information */
    }
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

  /// `masterPasswordHash` n'est pas facultatif : `/api/mfa/setup` **remet le secret à
  /// zéro**, donc le serveur exige une re-authentification. L'appel partait sans corps,
  /// et le schéma le refusait — « requête invalide » sur un bouton qui n'avait jamais pu
  /// marcher.
  mfaSetup(token: string, masterPasswordHash: string) {
    return http<{ secret: string; otpauthUri: string }>("/api/mfa/setup", {
      method: "POST",
      body: { masterPasswordHash },
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
    // La réponse porte l'URL COMPLÈTE, pas seulement un identifiant : depuis
    // que le paste vit chez ghostbit, un client qui reconstruirait le lien
    // depuis l'identifiant et l'adresse de son serveur produirait des liens
    // morts sans lever d'erreur. Et le `deleteToken`, que seul le client
    // conserve — c'est lui qui rend la révocation possible.
    return http<{ id: string; url: string; deleteToken: string; expiresAt: number | null }>(
      "/api/send",
      { method: "POST", body, token },
    );
  },

  /// Révoquer un partage en présentant le jeton gardé au coffre.
  ///
  /// 204 sans distinguer : ghostbit répond 403 pour un jeton faux comme pour un
  /// paste absent ou expiré, exprès, afin qu'on ne puisse pas énumérer. « C'est
  /// fait » couvre donc les trois cas, et c'est ce que l'utilisateur voulait.
  revokeSend(token: string, id: string, deleteToken: string) {
    return http<void>(`/api/send/${id}`, {
      method: "DELETE",
      token,
      headers: { "x-delete-token": deleteToken },
    });
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
  createCollection(token: string, orgId: string, body: { name: string }) {
    return http<{ id: string; name: string }>(`/api/orgs/${orgId}/collections`, {
      method: "POST",
      body,
      token,
    });
  },
  listCollections(token: string, orgId: string) {
    // `permission` est la permission EFFECTIVE calculée par le serveur
    // (`orgVault.ts:147`) : rôle d'administrateur et appartenance à un groupe
    // comprises, et non les seuls octrois directs. Le type l'omettait alors que
    // la réponse la porte depuis le 2026-08-29 — une omission qui ne casse
    // rien à l'exécution et rend le champ invisible à qui lit le client.
    return http<{
      collections: Array<{ id: string; name: string; permission: "read" | "write" | "manage" }>;
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
  /// Supprime un identifiant d'organisation.
  ///
  /// La route existait côté serveur depuis l'origine ; c'est l'interface qui
  /// n'avait aucun moyen de l'appeler. Sans elle, « Supprimer » restait masqué
  /// sur les éléments d'équipe — non pas parce qu'on n'en avait pas le droit,
  /// mais parce que rien ne savait le faire. Un bouton absent ressemble à un
  /// droit refusé, et c'est le pire des deux malentendus.
  deleteOrgItem(token: string, orgId: string, collectionId: string, itemId: string) {
    return http<void>(`/api/orgs/${orgId}/collections/${collectionId}/items/${itemId}`, {
      method: "DELETE",
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
