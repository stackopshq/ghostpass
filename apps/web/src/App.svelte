<script lang="ts">
  import { onMount } from "svelte";
  import type { Account } from "ghostpass-crypto-wasm";
  import { api } from "./lib/api.js";
  import Organizations from "./Organizations.svelte";
  import {
    computeLoginHash,
    createRecovery,
    decryptEmergencyItem,
    decryptOrgItem,
    decryptVaultItem,
    emergencyTakeover,
    encryptFolders,
    encryptItem,
    ensureCryptoReady,
    faviconUrl,
    FOLDERS_ITEM_NAME,
    openEmergency,
    openOrg,
    recoverAccount,
    register,
    sealUserKeyFor,
    unlock,
    unlockWithPasskey,
    wrapUserKeyForPasskey,
    type DecryptedItem,
    type EmergencyItem,
    type ItemKind,
  } from "./lib/crypto.js";
  import { generateOtp, parseOtp } from "./lib/totp.js";
  import LanguageSwitcher from "./LanguageSwitcher.svelte";
  import { t } from "./lib/i18n.svelte.js";
  import { DEFAULT_GEN_OPTIONS, generatePassword, type GenOptions } from "./lib/generator.js";
  import { parseCsv } from "./lib/csv.js";
  import { pwnedCount } from "./lib/breach.js";
  import { sealSend } from "./lib/send.js";
  import { authenticatePasskey, createCredential, getAssertion, registerPasskey } from "./lib/webauthn.js";

  let cryptoReady = $state(false);
  let busy = $state(false);
  let error = $state<string | null>(null);

  let mode = $state<"login" | "register" | "recover">("login");
  // SSO OIDC : `ssoEnabled` pilote le bouton ; `ssoPending` = retour du callback (session + blobs)
  // en attente du mot de passe maître pour déverrouiller côté client.
  let ssoEnabled = $state(false);
  let ssoPending = $state<{
    token: string;
    email: string;
    kdfParams: string;
    encryptedUserKey: string;
    encryptedPrivateKey: string;
  } | null>(null);
  let email = $state("");
  let password = $state("");
  let totpCode = $state("");
  let mfaRequired = $state(false);
  let infoMessage = $state<string | null>(null);

  // Récupération de compte.
  let recoveryKeyInput = $state("");
  let recoverNewPassword = $state("");
  let recoveryKitDisplay = $state<string | null>(null);

  let token = $state<string | null>(null);
  let account = $state<Account | null>(null);
  let items = $state<VaultEntry[]>([]);
  /// Le sous-ensemble personnel. Dérivé plutôt que maintenu à part : deux
  /// listes tenues en parallèle finissent par diverger, et c'est celle-ci qui
  /// garde les secrets d'équipe hors de l'export.
  const personalItems = $derived(items.filter((i) => !i.shared));
  // Le nom d'organisation n'apporte rien quand il n'y en a qu'une : il occupe
  // alors la place qui manque au nom de collection.
  const plusieursOrgs = $derived(
    new Set(items.filter((i) => i.shared).map((i) => i.shared!.orgId)).size > 1,
  );
  let nav = $state<"vault" | "orgs" | "security" | "trash">("vault");
  let trashItems = $state<VaultEntry[]>([]);

  // Sélection / recherche dans le coffre (UI).
  let search = $state("");
  let selected = $state<VaultEntry | null>(null);
  let adding = $state(false);
  let editingId = $state<string | null>(null);
  let detailRevealed = $state(false);
  let histRevealed = $state<Set<number>>(new Set());
  let copiedKey = $state<string | null>(null);
  let collapsed = $state<Set<string>>(new Set());

  // Dossier sélectionné dans l'arbre de gauche (null = tous les éléments).
  let selectedFolder = $state<string | null>(null);
  /// Filtre par collection d'équipe. Distinct de `selectedFolder` : un dossier
  /// personnel et une collection d'équipe ne se mélangent pas, et confondre les
  /// deux ferait afficher « aucun secret dans ce dossier » sur une collection
  /// qui en contient.
  let selectedCollectionId = $state<string | null>(null);

  // Dossiers vides persistés (registre chiffré) + code OTP courant de l'entrée affichée.
  let emptyFolders = $state<string[]>([]);
  let folderRegistryId = $state<string | null>(null);
  let otp = $state<{ code: string; remaining: number; period: number } | null>(null);
  let newFolderOpen = $state(false);
  let newFolderName = $state("");

  // Formulaire d'ajout de secret.
  let itemKind = $state<ItemKind>("login");
  let itemName = $state("");
  let itemUsername = $state("");
  let itemPassword = $state("");
  // Le champ etait en `type="text"` : le mot de passe s'affichait en clair
  // pendant toute la saisie, sans moyen de le masquer. Dans un gestionnaire de
  // mots de passe le defaut doit etre l'inverse -- masque, et l'oeil montre.
  let showItemPassword = $state(false);
  let itemUrl = $state("");
  let itemFolder = $state("");
  let itemTotp = $state("");
  let itemNote = $state("");
  let itemCardholder = $state("");
  let itemCardNumber = $state("");
  let itemCardExp = $state("");
  let itemCardCode = $state("");

  // Générateur de mots de passe.
  let genOptions = $state<GenOptions>({ ...DEFAULT_GEN_OPTIONS });
  let genOpen = $state(false);
  let importMessage = $state<string | null>(null);

  function genPassword() {
    itemPassword = generatePassword(genOptions);
  }

  function exportCsv() {
    const esc = (s: string) => `"${(s ?? "").replace(/"/g, '""')}"`;
    const header = "name,folder,url,username,password,totp";
    // `personalItems`, PAS `items`. Depuis que la liste fusionne les éléments
    // d'équipe, exporter `items` déposerait les secrets de toute l'organisation
    // en clair dans un fichier, sur l'appareil d'un seul de ses membres — et
    // sans que l'équipe l'apprenne. Sortir un secret partagé du coffre est une
    // décision qui appartient à l'équipe, pas à celui qui clique.
    //
    // Trou signalé par la session iOS le 2026-08-29, qui l'a rencontré en
    // cherchant *qui d'autre* lisait sa collection unifiée. Je ne l'avais pas
    // vu non plus en écrivant la fusion.
    const rows = personalItems.map((i) =>
      [i.name, i.folder, i.url, i.username, i.password, i.totp].map(esc).join(","),
    );
    const blob = new Blob([[header, ...rows].join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "ghostpass-export.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function importCsv(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file || !token || !account) return;
    busy = true;
    error = null;
    importMessage = null;
    try {
      const rows = parseCsv(await file.text());
      let n = 0;
      for (const r of rows) {
        const enc = encryptItem(account, {
          kind: "login",
          name: r.name || r.title || "(sans nom)",
          username: r.username || r.login_username || r.login || "",
          password: r.password || r.login_password || "",
          url: r.url || r.login_uri || r.website || r.uri || "",
          folder: r.folder || r.vault || r.group || "",
          totp: r.totp || r.login_totp || r.otpauth || "",
        });
        await api.createItem(token, enc);
        n++;
      }
      await loadItems();
      importMessage = `${n} entrée${n > 1 ? "s" : ""} importée${n > 1 ? "s" : ""}.`;
    } catch (err) {
      error = errMsg(err);
    } finally {
      busy = false;
      input.value = "";
    }
  }

  // Configuration de la 2FA.
  let mfaSetup = $state<{ secret: string; otpauthUri: string } | null>(null);
  let mfaCode = $state("");
  let mfaMessage = $state<string | null>(null);

  // Clés de sécurité WebAuthn.
  let webauthnKeys = $state<Array<{ id: string; name: string; createdAt: number }>>([]);
  let webauthnBusy = $state(false);

  // Passkeys (déverrouillage sans mot de passe).
  let passkeyKeys = $state<Array<{ id: string; name: string; createdAt: number }>>([]);
  let passkeyBusy = $state(false);

  async function loadPasskeys() {
    if (!token) return;
    try {
      passkeyKeys = (await api.passkeyCredentials(token)).credentials;
    } catch (err) {
      error = errMsg(err);
    }
  }

  async function addPasskey() {
    if (!token || !account) return;
    const name = prompt("Nom de la passkey :", "Passkey");
    if (name === null) return;
    passkeyBusy = true;
    error = null;
    try {
      const options = await api.passkeyRegisterOptions(token);
      const { response, prf } = await registerPasskey(options);
      const prfWrappedUserKey = wrapUserKeyForPasskey(account, prf);
      await api.passkeyRegisterVerify(token, {
        response,
        name: name.trim() || "Passkey",
        prfWrappedUserKey,
      });
      await loadPasskeys();
    } catch (err) {
      error = errMsg(err);
    } finally {
      passkeyBusy = false;
    }
  }

  async function removePasskey(id: string) {
    if (!token || !confirm("Supprimer cette passkey ?")) return;
    try {
      await api.passkeyDeleteCredential(token, id);
      await loadPasskeys();
    } catch (err) {
      error = errMsg(err);
    }
  }

  // Login passwordless via passkey (utilise le champ email de l'écran de connexion).
  async function loginWithPasskey() {
    if (!email) {
      error = "Saisissez d'abord votre email.";
      return;
    }
    busy = true;
    error = null;
    try {
      const options = await api.passkeyLoginOptions(email);
      const { response, prf } = await authenticatePasskey(options);
      const res = await api.passkeyLogin(email, response);
      account = unlockWithPasskey(prf, res.prfWrappedUserKey, res.encryptedPrivateKey);
      token = res.token;
      await loadItems();
    } catch (err) {
      error = errMsg(err);
    } finally {
      busy = false;
    }
  }

  // Historique des connexions.
  let activity = $state<Array<{ ip: string; userAgent: string; newDevice: boolean; createdAt: number }>>([]);

  async function loadActivity() {
    if (!token) return;
    try {
      activity = (await api.accountActivity(token)).events;
    } catch (err) {
      error = errMsg(err);
    }
  }

  // Étiquette d'appareil lisible depuis un user-agent.
  function deviceLabel(ua: string): string {
    const os = /Windows/.test(ua)
      ? "Windows"
      : /Mac OS|Macintosh/.test(ua)
        ? "macOS"
        : /Android/.test(ua)
          ? "Android"
          : /iPhone|iPad|iOS/.test(ua)
            ? "iOS"
            : /Linux/.test(ua)
              ? "Linux"
              : "";
    const br = /Firefox/.test(ua)
      ? "Firefox"
      : /Edg\//.test(ua)
        ? "Edge"
        : /Chrome/.test(ua)
          ? "Chrome"
          : /Safari/.test(ua)
            ? "Safari"
            : "Navigateur";
    return [br, os].filter(Boolean).join(" · ") || ua.slice(0, 40);
  }

  async function loadWebauthn() {
    if (!token) return;
    try {
      webauthnKeys = (await api.webauthnCredentials(token)).credentials;
    } catch (err) {
      error = errMsg(err);
    }
  }

  async function addSecurityKey() {
    if (!token) return;
    const name = prompt("Nom de la clé (ex. YubiKey perso) :", "Clé de sécurité");
    if (name === null) return;
    webauthnBusy = true;
    error = null;
    try {
      const options = await api.webauthnRegisterOptions(token);
      const response = await createCredential(options);
      await api.webauthnRegisterVerify(token, { response, name: name.trim() || "Clé de sécurité" });
      await loadWebauthn();
    } catch (err) {
      error = errMsg(err);
    } finally {
      webauthnBusy = false;
    }
  }

  async function removeSecurityKey(id: string) {
    if (!token) return;
    if (!confirm("Supprimer cette clé de sécurité ?")) return;
    try {
      await api.webauthnDeleteCredential(token, id);
      await loadWebauthn();
    } catch (err) {
      error = errMsg(err);
    }
  }

  // ─── Accès d'urgence ───
  type EmgEntry = {
    id: string;
    contactEmail: string;
    role: string;
    waitDays: number;
    status: string;
    requestedAt: number | null;
    available?: boolean;
  };
  let emgGrantor = $state<EmgEntry[]>([]);
  let emgGrantee = $state<EmgEntry[]>([]);
  let emgBusy = $state(false);
  let emgInfo = $state<string | null>(null);
  let emgEmail = $state("");
  let emgRole = $state<"view" | "takeover">("view");
  let emgWait = $state(7);
  let emgViewItems = $state<EmergencyItem[] | null>(null);
  let emgViewFrom = $state("");
  let emgViewRevealed = $state<Set<number>>(new Set());

  async function loadEmergency() {
    if (!token) return;
    try {
      const r = await api.listEmergency(token);
      emgGrantor = r.asGrantor;
      emgGrantee = r.asGrantee;
    } catch (err) {
      error = errMsg(err);
    }
  }

  async function inviteEmergency() {
    if (!token || !account || !emgEmail) return;
    emgBusy = true;
    error = null;
    try {
      const { publicKey } = await api.lookupPublicKey(token, emgEmail);
      const sealedUserKey = sealUserKeyFor(account, publicKey);
      await api.createEmergency(token, {
        email: emgEmail,
        role: emgRole,
        waitDays: emgWait,
        sealedUserKey,
      });
      emgEmail = "";
      await loadEmergency();
    } catch (err) {
      error = errMsg(err);
    } finally {
      emgBusy = false;
    }
  }

  async function emgAct(id: string, action: "accept" | "request" | "approve" | "reject") {
    if (!token) return;
    emgBusy = true;
    error = null;
    try {
      await api.emergencyAction(token, id, action);
      await loadEmergency();
    } catch (err) {
      error = errMsg(err);
    } finally {
      emgBusy = false;
    }
  }

  async function emgRemove(id: string) {
    if (!token || !confirm("Supprimer cet accès d'urgence ?")) return;
    try {
      await api.removeEmergency(token, id);
      await loadEmergency();
    } catch (err) {
      error = errMsg(err);
    }
  }

  async function emgView(e: EmgEntry) {
    if (!token || !account) return;
    emgBusy = true;
    error = null;
    emgViewItems = null;
    emgViewRevealed = new Set();
    try {
      const data = await api.emergencyAccess(token, e.id);
      const vault = openEmergency(account, data.grantorPublicKey, data.sealedUserKey);
      emgViewItems = data.items
        .map((it) => decryptEmergencyItem(vault, it.encryptedKey, it.encryptedData))
        .filter((i) => i.name !== FOLDERS_ITEM_NAME);
      emgViewFrom = data.grantorEmail;
    } catch (err) {
      error = errMsg(err);
    } finally {
      emgBusy = false;
    }
  }

  async function emgTakeover(e: EmgEntry) {
    if (!token || !account) return;
    const np = prompt(`Nouveau mot de passe maître pour le compte de ${e.contactEmail} :`);
    if (!np) return;
    emgBusy = true;
    error = null;
    emgInfo = null;
    try {
      const data = await api.emergencyAccess(token, e.id);
      const vault = openEmergency(account, data.grantorPublicKey, data.sealedUserKey);
      const reset = emergencyTakeover(vault, data.grantorEmail, data.grantorKdfParams, np);
      await api.emergencyTakeover(token, e.id, {
        newMasterPasswordHash: reset.masterPasswordHash,
        newEncryptedUserKey: reset.encryptedUserKey,
      });
      emgInfo = `Mot de passe du compte ${e.contactEmail} réinitialisé.`;
      await loadEmergency();
    } catch (err) {
      error = errMsg(err);
    } finally {
      emgBusy = false;
    }
  }

  // Liste du milieu : secrets du dossier sélectionné (ou résultats de recherche, globaux).
  const visibleItems = $derived(
    items
      .filter((it) => {
        const q = search.trim().toLowerCase();
        if (q) {
          // « tous les mots de passe de l'équipe Ops » est une requête naturelle,
          // donc le nom de l'équipe et celui de la collection sont cherchables
          // au même titre que le nom du secret. Aligné avec le client iOS.
          const champs = [
            it.name, it.username, it.url,
            it.shared?.orgName ?? "", it.shared?.collectionName ?? "",
          ];
          return champs.some((c) => (c ?? "").toLowerCase().includes(q));
        }
        if (selectedCollectionId) return it.shared?.collectionId === selectedCollectionId;
        // Sans filtre, tout ; avec un dossier, les personnels de ce dossier.
        if (selectedFolder === null) return true;
        return !it.shared && it.folder === selectedFolder;
      })
      .sort((a, b) => a.name.localeCompare(b.name)),
  );

  // Entrée de coffre déchiffrée + métadonnées non chiffrées utiles à l'affichage.
  interface VaultEntry extends DecryptedItem {
    id: string;
    updatedAt: number;
    /// Renseigné UNIQUEMENT pour un élément d'équipe. Son absence veut dire
    /// « personnel », et c'est ce qui route les écritures : un élément d'équipe
    /// enregistré par l'API personnelle ne met pas à jour l'original, il en
    /// crée une COPIE PRIVÉE — et l'équipe ne voit jamais la modification.
    /// Signalé par la session iOS le 2026-08-29, qui a rencontré le même piège.
    shared?: {
      orgId: string;
      orgName: string;
      collectionId: string;
      collectionName: string;
      // La permission EFFECTIVE sur la collection, telle que le serveur la
      // calcule — rôle d'administrateur, octroi direct et appartenance à un
      // groupe confondus. Absente si le serveur est antérieur au champ : on
      // traite alors l'élément comme lisible seulement.
      permission?: "read" | "write" | "manage";
    };
  }

  // ─── Arborescence des dossiers (déduite des chemins chiffrés "A/B/C") ───
  interface TreeNode {
    name: string;
    path: string;
    children: TreeNode[];
    items: VaultEntry[];
  }

  function ensureFolder(root: TreeNode, path: string): TreeNode {
    const segments = path.split("/").map((s) => s.trim()).filter(Boolean);
    let node = root;
    let acc = "";
    for (const seg of segments) {
      acc = acc ? `${acc}/${seg}` : seg;
      let child = node.children.find((c) => c.name === seg);
      if (!child) {
        child = { name: seg, path: acc, children: [], items: [] };
        node.children.push(child);
      }
      node = child;
    }
    return node;
  }

  function buildTree(list: VaultEntry[], extraFolders: string[]): TreeNode {
    const root: TreeNode = { name: "", path: "", children: [], items: [] };
    for (const item of list) ensureFolder(root, item.folder || "").items.push(item);
    for (const f of extraFolders) ensureFolder(root, f);
    const sortNode = (n: TreeNode) => {
      n.children.sort((a, b) => a.name.localeCompare(b.name));
      n.items.sort((a, b) => a.name.localeCompare(b.name));
      n.children.forEach(sortNode);
    };
    sortNode(root);
    return root;
  }

  // L'arbre (colonne de gauche) liste tous les dossiers, vides compris — c'est la navigation.
  // `personalItems` : un élément d'équipe n'a pas de dossier, il a une collection.
  // Le passer à `buildTree` le ferait apparaître à la racine des dossiers
  // personnels, c'est-à-dire au mauvais endroit sous le bon nom.
  const tree = $derived(buildTree(personalItems, emptyFolders));

  /// Les équipes et leurs collections, déduites des éléments chargés — pas
  /// d'un second appel. Une collection vide n'apparaît donc pas ici ; elle est
  /// visible dans l'écran Organisations, à qui elle appartient.
  const orgSections = $derived.by(() => {
    const parOrg = new Map<string, { name: string; cols: Map<string, { name: string; n: number }> }>();
    for (const it of items) {
      if (!it.shared) continue;
      const org = parOrg.get(it.shared.orgId) ?? { name: it.shared.orgName, cols: new Map() };
      const col = org.cols.get(it.shared.collectionId)
        ?? { name: it.shared.collectionName, n: 0 };
      col.n += 1;
      org.cols.set(it.shared.collectionId, col);
      parOrg.set(it.shared.orgId, org);
    }
    return [...parOrg.entries()].map(([orgId, o]) => ({
      orgId,
      name: o.name,
      total: [...o.cols.values()].reduce((s, c) => s + c.n, 0),
      collections: [...o.cols.entries()].map(([id, c]) => ({ id, ...c })),
    }));
  });

  function selectCollection(id: string | null) {
    selectedCollectionId = id;
    selectedFolder = null;
    menuOpen = false;
  }

  function selectFolder(path: string | null) {
    selectedFolder = path;
    selectedCollectionId = null;
    // Sur téléphone, choisir un dossier est une navigation : le tiroir doit se
    // refermer, sinon il masque la liste qu'on vient de demander.
    menuOpen = false;
  }

  // Santé des mots de passe (calcul 100 % local).
  const health = $derived.by(() => {
    const counts = new Map<string, number>();
    for (const i of items) if (i.password) counts.set(i.password, (counts.get(i.password) ?? 0) + 1);
    return {
      // `items` et NON `personalItems`, délibérément : un mot de passe d'équipe
      // faible ou réutilisé est exactement ce qu'on veut voir remonter, et c'est
      // souvent le plus coûteux. Ne pas « corriger » en personnel — l'export,
      // lui, reste personnel, et c'est la seule exclusion qui se justifie.
      weak: items.filter((i) => i.password && passwordStrength(i.password).level <= 1),
      reused: items.filter((i) => i.password && (counts.get(i.password) ?? 0) > 1),
      noTotp: items.filter((i) => !i.totp),
    };
  });

  function goToItem(item: VaultEntry) {
    nav = "vault";
    selectedFolder = null;
    search = "";
    selectItem(item);
  }

  // Vérification des fuites (HIBP k-anonymity) — déclenchée explicitement.
  let breachBusy = $state(false);
  let breachDone = $state(false);
  let breached = $state<VaultEntry[]>([]);

  async function checkBreaches() {
    breachBusy = true;
    breachDone = false;
    error = null;
    try {
      const unique = [...new Set(items.filter((i) => i.password).map((i) => i.password))];
      const counts = new Map<string, number>();
      for (const pw of unique) counts.set(pw, await pwnedCount(pw));
      breached = items.filter((i) => (counts.get(i.password) ?? 0) > 0);
      breachDone = true;
    } catch (err) {
      error = errMsg(err);
    } finally {
      breachBusy = false;
    }
  }
  // Chemins de dossiers existants (pour l'autocomplétion du formulaire).
  // `personalItems` : les dossiers sont une notion du coffre personnel, et
  // proposer une collection d'équipe comme dossier n'aurait pas de sens.
  const folderPaths = $derived(
    [...new Set([...personalItems.map((i) => i.folder).filter(Boolean), ...emptyFolders])].sort((a, b) =>
      a.localeCompare(b),
    ),
  );

  function countItems(node: TreeNode): number {
    return node.items.length + node.children.reduce((sum, c) => sum + countItems(c), 0);
  }

  function isExpanded(path: string): boolean {
    return search.trim() !== "" || !collapsed.has(path);
  }

  function toggleFolder(path: string) {
    const next = new Set(collapsed);
    next.has(path) ? next.delete(path) : next.add(path);
    collapsed = next;
  }

  // Estimation locale de la force d'un mot de passe (longueur + variété de caractères).
  function passwordStrength(pw: string): { label: string; level: number } {
    if (!pw) return { label: "Vide", level: 0 };
    let score = 0;
    if (pw.length >= 8) score++;
    if (pw.length >= 14) score++;
    if (pw.length >= 20) score++;
    const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((re) => re.test(pw)).length;
    if (classes >= 2) score++;
    if (classes >= 3) score++;
    const level = Math.min(4, Math.round((score / 5) * 4));
    return { label: ["Très faible", "Faible", "Moyen", "Bon", "Très bon"][level]!, level };
  }

  // Couleur d'avatar déterministe (quand pas de favicon), pour des icônes colorées comme 1Password.
  const AVATAR_COLORS = ["#e0533f", "#e0892f", "#3f9e6b", "#3f86e0", "#7c5cf0", "#d9528a", "#2fa3a3", "#9a7b3f"];
  function avatarColor(name: string): string {
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
    return AVATAR_COLORS[h % AVATAR_COLORS.length]!;
  }

  function formatDate(ms: number): string {
    try {
      return new Date(ms).toLocaleString("fr-FR", { dateStyle: "long", timeStyle: "short" });
    } catch {
      return "";
    }
  }

  // Recalcule le code OTP de l'entrée affichée chaque seconde (et l'efface au changement de sélection).
  $effect(() => {
    const cfg = parseOtp(selected?.totp ?? "");
    if (!cfg) {
      otp = null;
      return;
    }
    let active = true;
    const tick = async () => {
      try {
        const r = await generateOtp(cfg);
        if (active) otp = { ...r, period: cfg.period };
      } catch {
        if (active) otp = null;
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => {
      active = false;
      clearInterval(id);
    };
  });

  // ─── Registre des dossiers vides (persisté chiffré) ───
  async function saveFolders() {
    if (!token || !account) return;
    const enc = encryptFolders(account, emptyFolders);
    if (folderRegistryId) {
      await api.updateItem(token, folderRegistryId, enc);
    } else {
      const created = await api.createItem(token, enc);
      folderRegistryId = created.id;
    }
  }

  async function createFolder() {
    const path = newFolderName.trim().replace(/^\/+|\/+$/g, "");
    newFolderOpen = false;
    newFolderName = "";
    if (!path || emptyFolders.includes(path)) return;
    emptyFolders = [...emptyFolders, path].sort((a, b) => a.localeCompare(b));
    try {
      await saveFolders();
    } catch (err) {
      error = errMsg(err);
    }
  }

  async function removeFolder(path: string) {
    // Retire le dossier (et ses sous-dossiers) du registre ; n'affecte pas les entrées.
    emptyFolders = emptyFolders.filter((p) => p !== path && !p.startsWith(`${path}/`));
    try {
      await saveFolders();
    } catch (err) {
      error = errMsg(err);
    }
  }

  // Tiroir de navigation — n'existe que sous 760 px (voir app.css). Au-dessus,
  // la barre latérale est toujours là et cet état n'a aucun effet visible.
  let menuOpen = $state(false);

  // Thème (clair/sombre) — appliqué sur <html data-theme>, persisté en localStorage.
  let theme = $state<"dark" | "light">(
    document.documentElement.dataset.theme === "light" ? "light" : "dark",
  );

  function toggleTheme() {
    theme = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("gp-theme", theme);
    } catch {
      /* localStorage indisponible */
    }
  }

  function errMsg(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }

  async function copy(text: string, key: string) {
    try {
      await navigator.clipboard.writeText(text);
      copiedKey = key;
      setTimeout(() => {
        if (copiedKey === key) copiedKey = null;
      }, 1200);
    } catch {
      /* presse-papiers indisponible */
    }
  }

  function selectItem(item: VaultEntry) {
    selected = item;
    adding = false;
    detailRevealed = false;
    histRevealed = new Set();
    shareLink = null;
  }

  // Partage de lien éphémère (Send) : chiffre le secret côté client, la clé reste dans l'URL (#).
  let shareLink = $state<string | null>(null);
  let shareBusy = $state(false);

  async function shareEntry() {
    if (!selected || !token) return;
    shareBusy = true;
    shareLink = null;
    error = null;
    try {
      const secret =
        selected.kind === "note"
          ? selected.note
          : selected.kind === "card"
            ? selected.cardNumber
            : selected.password;
      if (!secret) throw new Error("rien à partager");
      const sealed = await sealSend(secret);
      const { id } = await api.createSend(token, {
        ciphertext: sealed.ciphertext,
        iv: sealed.iv,
        expiresInHours: 24,
        maxViews: 1,
      });
      shareLink = `${location.origin}/s/${id}#${sealed.keyFragment}`;
    } catch (err) {
      error = errMsg(err);
    } finally {
      shareBusy = false;
    }
  }

  function toggleHist(i: number) {
    const next = new Set(histRevealed);
    next.has(i) ? next.delete(i) : next.add(i);
    histRevealed = next;
  }

  function resetItemForm() {
    itemName = "";
    itemUsername = "";
    itemPassword = "";
    showItemPassword = false;
    itemUrl = "";
    itemTotp = "";
    itemNote = "";
    itemCardholder = "";
    itemCardNumber = "";
    itemCardExp = "";
    itemCardCode = "";
  }

  function startAdd() {
    // Pré-remplit le dossier avec celui de l'entrée affichée (pratique pour enchaîner).
    itemFolder = selected?.folder ?? "";
    editingId = null;
    adding = true;
    selected = null;
    itemKind = "login";
    resetItemForm();
  }

  function startEdit() {
    if (!selected) return;
    editingId = selected.id;
    itemKind = selected.kind;
    itemName = selected.name;
    itemFolder = selected.folder;
    itemUsername = selected.username;
    itemPassword = selected.password;
    itemUrl = selected.url;
    itemTotp = selected.totp;
    itemNote = selected.note;
    itemCardholder = selected.cardholder;
    itemCardNumber = selected.cardNumber;
    itemCardExp = selected.cardExp;
    itemCardCode = selected.cardCode;
    adding = true;
  }

  /// Un élément d'équipe est-il modifiable par cette personne ?
  ///
  /// Jusqu'au 2026-08-29 la réponse était « jamais », faute que la liste des
  /// collections porte la permission : je retirais « Modifier » et « Supprimer »
  /// sur TOUT élément partagé, y compris pour un gestionnaire. C'était sûr — on
  /// ne promettait jamais rien à tort — mais c'était une simplification par
  /// manque d'information, pas une décision de conception.
  ///
  /// Le repli reste le refus quand la permission est absente : mieux vaut cacher
  /// une action permise que d'en offrir une que le serveur refusera.
  function canWriteShared(it: VaultEntry): boolean {
    const p = it.shared?.permission;
    return p === "write" || p === "manage";
  }

  /// Refuser une écriture sur un élément d'équipe, en disant où la faire.
  /// Un refus muet ressemblerait à une panne ; un bouton inerte serait pire.
  function refuseWriteOnShared(it: VaultEntry) {
    error = canWriteShared(it)
      ? t("app.sharedEditElsewhere")
      : t("app.sharedReadOnlyHere");
    busy = false;
  }

  async function deleteEntry() {
    if (!selected || !token) return;
    // Un élément d'équipe ne passe PAS par l'API personnelle. `deleteItem`
    // viserait un identifiant qui n'existe pas dans le coffre personnel ; et
    // pour l'écriture, `updateItem` créerait une copie privée au lieu de mettre
    // à jour l'original — l'équipe ne verrait jamais la modification, et
    // personne n'aurait d'erreur pour le dire.
    if (selected.shared) return refuseWriteOnShared(selected);
    if (!confirm(`Déplacer « ${selected.name} » vers la corbeille ?`)) return;
    busy = true;
    error = null;
    try {
      await api.deleteItem(token, selected.id);
      selected = null;
      await loadItems();
    } catch (err) {
      error = errMsg(err);
    } finally {
      busy = false;
    }
  }

  // ─── Corbeille ───
  async function openTrash() {
    menuOpen = false;
    nav = "trash";
    if (!token || !account) return;
    try {
      const { items: dtos } = await api.listTrash(token);
      const entries: VaultEntry[] = [];
      for (const d of dtos) {
        const r = decryptVaultItem(account, d.encryptedKey, d.encryptedData);
        if (r.kind === "item") entries.push({ ...r.item, id: d.id, updatedAt: d.updatedAt });
      }
      trashItems = entries;
    } catch (err) {
      error = errMsg(err);
    }
  }

  async function restoreEntry(item: VaultEntry) {
    if (!token) return;
    busy = true;
    try {
      await api.restoreItem(token, item.id);
      await openTrash();
      await loadItems();
    } catch (err) {
      error = errMsg(err);
    } finally {
      busy = false;
    }
  }

  async function purgeEntry(item: VaultEntry) {
    if (!token) return;
    if (!confirm(`Supprimer définitivement « ${item.name} » ? Irréversible.`)) return;
    busy = true;
    try {
      await api.purgeItem(token, item.id);
      await openTrash();
    } catch (err) {
      error = errMsg(err);
    } finally {
      busy = false;
    }
  }

  onMount(async () => {
    await ensureCryptoReady();
    cryptoReady = true;
    try {
      ssoEnabled = (await api.ssoStatus()).enabled;
    } catch {
      ssoEnabled = false;
    }
    await handleSsoReturn();
  });

  /// Démarre le flux SSO : le backend renvoie l'URL d'autorisation, on y redirige le navigateur.
  async function startSso() {
    error = null;
    busy = true;
    try {
      const { url } = await api.ssoLogin();
      window.location.assign(url);
    } catch (err) {
      error = errMsg(err);
      busy = false;
    }
  }

  /// Retour de l'IdP sur `/sso/callback?code&state` : on échange côté backend, puis on attend le
  /// mot de passe maître (l'identité est prouvée par le SSO ; le déchiffrement reste local).
  async function handleSsoReturn() {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const state = params.get("state");
    if (window.location.pathname !== "/sso/callback" && !(code && state)) return;
    window.history.replaceState(null, "", "/");
    if (!code || !state) return;
    busy = true;
    try {
      const res = await api.ssoCallback(code, state);
      ssoPending = res;
      email = res.email;
    } catch {
      error = "Échec de la connexion SSO.";
    } finally {
      busy = false;
    }
  }

  /// Termine le SSO : déverrouille l'USK avec le mot de passe maître + les blobs renvoyés.
  async function finishSso(e: SubmitEvent) {
    e.preventDefault();
    error = null;
    busy = true;
    try {
      const r = ssoPending!;
      account = unlock(r.email, password, {
        kdfParams: r.kdfParams,
        encryptedUserKey: r.encryptedUserKey,
        encryptedPrivateKey: r.encryptedPrivateKey,
      });
      token = r.token;
      password = "";
      ssoPending = null;
      await loadItems();
    } catch {
      error = "Mot de passe maître invalide.";
    } finally {
      busy = false;
    }
  }

  async function loadItems() {
    if (!token || !account) return;
    const { items: dtos } = await api.listItems(token);
    const entries: VaultEntry[] = [];
    let registryId: string | null = null;
    let registryPaths: string[] = [];
    for (const d of dtos) {
      const r = decryptVaultItem(account!, d.encryptedKey, d.encryptedData);
      if (r.kind === "folders") {
        registryId = d.id;
        registryPaths = r.paths;
      } else {
        entries.push({ ...r.item, id: d.id, updatedAt: d.updatedAt });
      }
    }
    items = [...entries, ...(await loadOrgItems())];
    folderRegistryId = registryId;
    emptyFolders = registryPaths;
    selected = null;
    detailRevealed = false;
  }

  /// Les secrets des équipes dont l'utilisatrice est membre, déchiffrés avec la
  /// clé d'org et marqués de leur provenance.
  ///
  /// POURQUOI ILS ENTRENT DANS LA LISTE PRINCIPALE
  /// Un compte dont tout le contenu vit dans une équipe affichait « 0 mot de
  /// passe » et une recherche sans résultat. Le coffre n'était pas vide : on ne
  /// regardait qu'une moitié.
  ///
  /// POURQUOI ILS ÉCHOUENT EN SILENCE
  /// Une organisation dont la clé n'a pas été remise, une collection devenue
  /// inaccessible : on passe. L'alternative afficherait une erreur de coffre à
  /// quelqu'un dont le coffre va très bien — et le coffre personnel, lui, est
  /// déjà chargé. Le silence porte donc sur un supplément, jamais sur le tout.
  async function loadOrgItems(): Promise<VaultEntry[]> {
    if (!token || !account) return [];
    const sortis: VaultEntry[] = [];
    let orgs: Array<{ orgId: string; name: string; status: string }> = [];
    try {
      orgs = (await api.listOrgs(token)).organizations;
    } catch {
      return [];
    }
    for (const org of orgs) {
      if (org.status !== "active") continue;
      try {
        const m = await api.getMembership(token, org.orgId);
        if (!m.encryptedOrgKey || !m.sealedByPublicKey) continue;
        const handle = openOrg(account, m.sealedByPublicKey, m.encryptedOrgKey);
        const { collections } = await api.listCollections(token, org.orgId);
        for (const col of collections) {
          try {
            const { items: dtos } = await api.listCollectionItems(token, org.orgId, col.id);
            for (const d of dtos) {
              sortis.push({
                ...decryptOrgItem(handle, d.encryptedKey, d.encryptedData),
                id: d.id,
                updatedAt: d.updatedAt,
                shared: {
                  orgId: org.orgId,
                  orgName: org.name,
                  collectionId: col.id,
                  collectionName: col.name,
                  permission: col.permission,
                },
              });
            }
          } catch {
            // Collection inaccessible : les autres restent lisibles.
          }
        }
      } catch {
        // Organisation illisible : les autres restent lisibles.
      }
    }
    return sortis;
  }

  async function submitAuth(e: SubmitEvent) {
    e.preventDefault();
    error = null;
    busy = true;
    try {
      if (mode === "register") {
        const { data, account: acc } = register(email, password);
        const res = await api.register(data);
        token = res.token;
        account = acc;
      } else {
        const { kdfParams } = await api.prelogin(email);
        const hash = computeLoginHash(email, password, kdfParams);
        let res = await api.login(email, hash, { totpCode: totpCode || undefined });
        // 2FA par clé de sécurité : on déclenche l'assertion puis on rejoue le login.
        if (!res.ok && res.mfaRequired && res.mfaType === "webauthn" && res.options) {
          const assertion = await getAssertion(res.options);
          res = await api.login(email, hash, { webauthnResponse: assertion });
        }
        if (!res.ok) {
          if (res.mfaRequired && res.mfaType !== "webauthn") mfaRequired = true;
          throw new Error(res.error);
        }
        account = unlock(email, password, {
          kdfParams: res.kdfParams,
          encryptedUserKey: res.encryptedUserKey,
          encryptedPrivateKey: res.encryptedPrivateKey,
        });
        token = res.token;
      }
      password = "";
      totpCode = "";
      mfaRequired = false;
      await loadItems();
    } catch (err) {
      error = errMsg(err);
    } finally {
      busy = false;
    }
  }

  async function startMfaSetup() {
    if (!token) return;
    error = null;
    try {
      mfaSetup = await api.mfaSetup(token);
      mfaMessage = null;
    } catch (err) {
      error = errMsg(err);
    }
  }

  async function confirmMfa() {
    if (!token) return;
    error = null;
    busy = true;
    try {
      await api.mfaActivate(token, mfaCode);
      mfaSetup = null;
      mfaCode = "";
      mfaMessage = "Double authentification activée.";
    } catch (err) {
      error = errMsg(err);
    } finally {
      busy = false;
    }
  }

  async function addItem(e: SubmitEvent) {
    e.preventDefault();
    if (!token || !account) return;
    error = null;
    busy = true;
    try {
      // À l'édition, si le mot de passe change, on archive l'ancien (max 20 versions).
      let passwordHistory: string[] = [];
      if (editingId && selected) {
        passwordHistory = selected.passwordHistory ?? [];
        if (selected.password && itemPassword !== selected.password) {
          passwordHistory = [selected.password, ...passwordHistory].slice(0, 20);
        }
      }
      const enc = encryptItem(account, {
        kind: itemKind,
        name: itemName,
        folder: itemFolder,
        username: itemUsername,
        password: itemPassword,
        url: itemUrl,
        totp: itemTotp,
        passwordHistory,
        note: itemNote,
        cardholder: itemCardholder,
        cardNumber: itemCardNumber,
        cardExp: itemCardExp,
        cardCode: itemCardCode,
      });
      const enCours = editingId ? items.find((i) => i.id === editingId) : undefined;
      if (enCours?.shared) {
        refuseWriteOnShared(enCours);
        return;
      }
      const savedId = editingId
        ? (await api.updateItem(token, editingId, enc), editingId)
        : (await api.createItem(token, enc)).id;
      resetItemForm();
      itemFolder = "";
      adding = false;
      editingId = null;
      await loadItems();
      selected = items.find((i) => i.id === savedId) ?? null;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      busy = false;
    }
  }

  async function generateRecoveryKit() {
    if (!token || !account) return;
    error = null;
    busy = true;
    try {
      const kit = createRecovery(account);
      await api.enrollRecovery(token, {
        recoveryAuthHash: kit.recoveryAuthHash,
        encryptedUserKeyRecovery: kit.encryptedUserKeyRecovery,
      });
      recoveryKitDisplay = kit.recoveryKey;
    } catch (err) {
      error = errMsg(err);
    } finally {
      busy = false;
    }
  }

  async function submitRecover(e: SubmitEvent) {
    e.preventDefault();
    error = null;
    infoMessage = null;
    busy = true;
    try {
      const blob = await api.recoveryBlob(email);
      const reset = recoverAccount(
        recoveryKeyInput,
        email,
        recoverNewPassword,
        blob.kdfParams,
        blob.encryptedUserKeyRecovery,
        blob.encryptedPrivateKey,
      );
      await api.recover({
        email,
        recoveryAuthHash: reset.recoveryAuthHash,
        newMasterPasswordHash: reset.masterPasswordHash,
        newEncryptedUserKey: reset.encryptedUserKey,
      });
      recoveryKeyInput = "";
      recoverNewPassword = "";
      mode = "login";
      infoMessage = "Mot de passe réinitialisé. Connectez-vous avec le nouveau.";
    } catch (err) {
      error = errMsg(err);
    } finally {
      busy = false;
    }
  }

  function logout() {
    token = null;
    account = null;
    items = [];
    email = "";
    nav = "vault";
    search = "";
    selected = null;
    selectedFolder = null;
    trashItems = [];
    adding = false;
    editingId = null;
    emptyFolders = [];
    folderRegistryId = null;
    otp = null;
    newFolderOpen = false;
    newFolderName = "";
    mfaRequired = false;
    totpCode = "";
    mfaSetup = null;
    mfaCode = "";
    mfaMessage = null;
    webauthnKeys = [];
    passkeyKeys = [];
    activity = [];
    emgGrantor = [];
    emgGrantee = [];
    emgViewItems = null;
    recoveryKitDisplay = null;
    recoveryKeyInput = "";
    recoverNewPassword = "";
  }
</script>

{#snippet logoMark()}
  <!-- Le logo de la charte, servi tel quel — même traitement que ghostcal, qui
       rend `/logo.svg` en 28 px sans rien autour. GhostPass l'enfermait dans une
       pastille bleue à coins arrondis : la silhouette y perdait ses tirets
       détachés et ne ressemblait plus à ses frères de la suite.

       C'est une image et non un SVG inline : le fichier est une SORTIE de
       tools/brand/ghost_suite.py, et le recopier dans le balisage rouvrirait
       la dérive de teintes qu'on vient de refermer. -->
  <img src="/logo.svg" alt="" width="28" height="28" />
{/snippet}
{#snippet eyeIcon()}
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" />
  </svg>
{/snippet}
{#snippet eyeOffIcon()}
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M9.9 4.2A10.9 10.9 0 0 1 12 4c6.5 0 10 7 10 7a18.5 18.5 0 0 1-3 3.6" />
    <path d="M6.1 6.1C3.3 7.8 2 11 2 11s3.5 7 10 7a10.9 10.9 0 0 0 3.1-.5" />
    <path d="m2 2 20 20" /><path d="M9.6 9.6a3 3 0 0 0 4.2 4.2" />
  </svg>
{/snippet}
{#snippet copyIcon()}
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" />
  </svg>
{/snippet}
{#snippet checkIcon()}
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M20 6 9 17l-5-5" />
  </svg>
{/snippet}
{#snippet plusIcon()}
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M12 5v14M5 12h14" />
  </svg>
{/snippet}
{#snippet shieldIcon()}
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
  </svg>
{/snippet}
{#snippet vaultIcon()}
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="12" cy="12" r="3.5" /><path d="M12 4v2.5M12 17.5V20" />
  </svg>
{/snippet}
{#snippet orgIcon()}
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <path d="M3 21h18" /><path d="M5 21V7l8-4v18" /><path d="M19 21V11l-6-4" />
  </svg>
{/snippet}
{#snippet lockIcon()}
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <rect x="4" y="11" width="16" height="9" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </svg>
{/snippet}
{#snippet alertIcon()}
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M12 9v4" /><path d="M12 17h.01" /><circle cx="12" cy="12" r="9" />
  </svg>
{/snippet}
{#snippet sunIcon()}
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </svg>
{/snippet}
{#snippet moonIcon()}
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
  </svg>
{/snippet}
{#snippet themeToggle(extra: string)}
  <button class="icon-btn {extra}" onclick={toggleTheme} title={theme === "dark" ? "Passer en clair" : "Passer en sombre"} aria-label={t("app.toggleTheme")}>
    {#if theme === "dark"}{@render sunIcon()}{:else}{@render moonIcon()}{/if}
  </button>
{/snippet}
{#snippet menuIcon()}
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M4 7h16M4 12h16M4 17h16" />
  </svg>
{/snippet}
{#snippet trashIcon()}
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M3 6h18" /><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
    <path d="M6 6v14a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V6" /><path d="M10 11v6M14 11v6" />
  </svg>
{/snippet}
{#snippet diceIcon()}
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="3" />
    <circle cx="8" cy="8" r="1.1" fill="currentColor" stroke="none" />
    <circle cx="16" cy="16" r="1.1" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="1.1" fill="currentColor" stroke="none" />
  </svg>
{/snippet}
{#snippet slidersIcon()}
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <line x1="4" y1="8" x2="20" y2="8" /><circle cx="9" cy="8" r="2.2" fill="var(--surface)" />
    <line x1="4" y1="16" x2="20" y2="16" /><circle cx="15" cy="16" r="2.2" fill="var(--surface)" />
  </svg>
{/snippet}
{#snippet itemAvatar(name: string, url: string, large: boolean)}
  <span class="avatar {large ? 'lg' : ''}" style="background:{avatarColor(name)};color:#fff;border-color:transparent">
    {(name || "?").charAt(0).toUpperCase()}
    {#if faviconUrl(url)}
      <img class="avatar-img" src={faviconUrl(url)} alt="" loading="lazy" onerror={(e) => ((e.currentTarget as HTMLImageElement).style.display = "none")} />
    {/if}
  </span>
{/snippet}
{#snippet chevronIcon()}
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
    <path d="m9 6 6 6-6 6" />
  </svg>
{/snippet}
{#snippet folderIcon()}
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
  </svg>
{/snippet}
{#snippet folderPlusIcon()}
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" /><path d="M12 11v4M10 13h4" />
  </svg>
{/snippet}
{#snippet itemEntry(item: VaultEntry, depth: number)}
  <button class="entry" class:active={selected === item} style="padding-left:{depth * 16 + 14}px" onclick={() => selectItem(item)}>
    {@render itemAvatar(item.name, item.url, false)}
    <span class="entry-main">
      <span class="entry-title">{item.name}</span>
      {#if item.kind === "login" && item.username}<span class="entry-sub">{item.username}</span>
      {:else if item.kind === "note"}<span class="entry-sub">{t("app.secureNote")}</span>
      {:else if item.kind === "card" && item.cardNumber}<span class="entry-sub">•••• {item.cardNumber.slice(-4)}</span>{/if}
    </span>
    <!-- Marqueur permanent, pas seulement dans le détail : confondre « moi
         seule vois ça » et « toute l'équipe voit ça » est la confusion qui
         coûte cher dans un coffre, et elle se produit en survolant une liste. -->
    {#if item.shared}
      <!-- La collection d'abord, l'organisation ensuite et seulement si le
           coffre en contient plusieurs.
           Avant, la pastille disait « <org> · <collection> » et se faisait
           couper à droite : chaque ligne commençait donc par le même nom
           d'organisation et c'est le nom de collection — le seul qui distingue
           les lignes entre elles — qui disparaissait. Tronquer par la droite
           n'est bon que si l'information décroît de gauche à droite. -->
      <!-- L'icône d'organisation est le SEUL signe qui dit « ce secret est
           partagé ». Le correctif du 2026-08-29 a mis la collection devant et
           masqué le nom d'org quand il n'y en a qu'une — ce qui règle la
           troncature mais efface la provenance : « Credentials Loutre » se lit
           alors exactement comme un dossier personnel du même nom. Le titre
           complet reste au survol, mais un survol ne se voit pas.

           `aria-label` porte l'information pour qui n'a pas l'image : une icône
           décorative laisserait la ligne muette sur ce qui la distingue. -->
      <span class="pill pill-shared" title={t("app.sharedOrigin", { org: item.shared.orgName, collection: item.shared.collectionName })}>
        <span class="pill-icon" aria-label={t("app.sharedItem")} role="img">{@render orgIcon()}</span>
        <span class="pill-text">{item.shared.collectionName}</span>
        {#if plusieursOrgs}<span class="pill-org">{item.shared.orgName}</span>{/if}
      </span>
    {/if}
  </button>
{/snippet}
{#snippet healthRow(label: string, list: VaultEntry[])}
  <details class="health-row">
    <summary>
      <span class="chevron">{@render chevronIcon()}</span>
      <span class="health-label">{label}</span>
      <span class="pill {list.length ? 'pill-warn' : 'pill-ok'}">{list.length}</span>
    </summary>
    {#if list.length}
      <ul class="health-list">
        {#each list as it (it.id)}
          <li>
            <button class="link" onclick={() => goToItem(it)}>{it.name}</button>
            {#if it.username}<span class="muted">{it.username}</span>{/if}
          </li>
        {/each}
      </ul>
    {/if}
  </details>
{/snippet}
{#snippet folderNode(node: TreeNode, depth: number)}
  <div class="tree-folder" class:active={selectedFolder === node.path} style="padding-left:{depth * 14 + 8}px">
    {#if node.children.length > 0}
      <button class="tree-chevron-btn" title={t("app.expandCollapse")} aria-label={t("app.expandCollapse")} onclick={() => toggleFolder(node.path)}>
        <span class="chevron" class:open={isExpanded(node.path)}>{@render chevronIcon()}</span>
      </button>
    {:else}
      <span class="tree-chevron-spacer"></span>
    {/if}
    <button class="tree-folder-btn" onclick={() => selectFolder(node.path)}>
      {@render folderIcon()}
      <span class="tree-name">{node.name}</span>
    </button>
    <span class="tree-count">{countItems(node)}</span>
    {#if countItems(node) === 0}
      <button class="icon-btn tree-remove" title={t("app.deleteFolder")} aria-label={t("app.deleteEmptyFolder")} onclick={() => removeFolder(node.path)}>×</button>
    {/if}
  </div>
  {#if isExpanded(node.path)}
    {#each node.children as child (child.path)}
      {@render folderNode(child, depth + 1)}
    {/each}
  {/if}
{/snippet}

{#if !cryptoReady}
  <div class="boot">
    <div class="spinner"></div>
    <p class="muted">{t("app.loadingCrypto")}</p>
  </div>
{:else if !token}
  <div class="auth">
    <aside class="auth-brand">
      <span class="brand"><span class="mark">{@render logoMark()}</span>GhostPass</span>
      <div>
        <h1 class="auth-hero">{t("app.tagline")}</h1>
        <ul class="auth-points">
          <li>{@render checkIcon()}<span>{t("app.pt1a")}<strong>{t("app.pt1b")}</strong>{t("app.pt1c")}</span></li>
          <li>{@render checkIcon()}<span>{t("app.pt2a")}<strong>{t("app.pt2b")}</strong>{t("app.pt2c")}</span></li>
          <li>{@render checkIcon()}<span>{t("app.pt3a")}<strong>{t("app.pt3b")}</strong>{t("app.pt3c")}</span></li>
        </ul>
      </div>
      <!-- Cette ligne annonçait « Hébergé en Suisse · conforme nLPD ». Les deux
           affirmations étaient fausses. L'hébergement est en France, et
           docs/ROADMAP.md range la conformité nLPD/RGPD dans ce qui RESTE à
           faire, avec l'audit externe et le SOC 2.
      
           Sur un produit dont l'argument de vente est qu'il ne peut pas mentir
           sur ce qu'il voit, une conformité revendiquée mais non acquise coûte
           plus cher que l'absence de mention. On ne garde que le vérifiable. -->
      <!-- Le selecteur est aussi ici : sans lui, un anglophone devrait se
           connecter en francais avant de pouvoir changer de langue. -->
      <div class="auth-brand-foot">
        Hébergé en France · chiffré de bout en bout
        <LanguageSwitcher />
      </div>
    </aside>

    <main class="auth-form-wrap">
      {@render themeToggle("auth-theme-toggle")}
      <div class="auth-form">
        <span class="brand auth-form-logo"><span class="mark">{@render logoMark()}</span>GhostPass</span>

        {#if infoMessage}
          <div class="callout success" style="margin-bottom:1.25rem">{@render checkIcon()}<span>{infoMessage}</span></div>
        {/if}

        {#if ssoPending}
          <h2 class="auth-title">{t("app.ssoTitle")}</h2>
          <p class="auth-sub">{t("app.ssoSub")}</p>
          <form onsubmit={finishSso}>
            <label class="field"><span>{t("app.email")}</span><input type="email" value={ssoPending.email} readonly /></label>
            <label class="field">
              <span>{t("app.masterPassword")}</span>
              <input type="password" bind:value={password} required autocomplete="current-password" />
            </label>
            <button type="submit" disabled={busy}>{busy ? "Déverrouillage…" : "Déverrouiller"}</button>
          </form>
          <button class="link" onclick={() => { ssoPending = null; error = null; }}>{t("app.cancelBack")}</button>
        {:else if mode === "recover"}
          <h2 class="auth-title">{t("app.forgotTitle")}</h2>
          <p class="auth-sub">{t("app.forgotSub")}</p>
          <form onsubmit={submitRecover}>
            <label class="field"><span>{t("app.email")}</span><input type="email" bind:value={email} required /></label>
            <label class="field">
              <span>{t("app.recoveryKey")}</span>
              <input bind:value={recoveryKeyInput} required placeholder={t("app.savedKeyPh")} />
            </label>
            <label class="field">
              <span>{t("app.newMaster")}</span>
              <input type="password" bind:value={recoverNewPassword} required />
            </label>
            <button type="submit" disabled={busy}>{busy ? "Réinitialisation…" : "Réinitialiser"}</button>
          </form>
          <button class="link" onclick={() => { mode = "login"; error = null; }}>{t("app.backToLogin")}</button>
        {:else}
          <h2 class="auth-title">{mode === "login" ? "Bon retour" : "Créer votre coffre"}</h2>
          <p class="auth-sub">
            {mode === "login"
              ? "Connectez-vous à votre coffre GhostPass."
              : "Quelques secondes pour un coffre chiffré rien qu'à vous."}
          </p>

          <div class="segmented full" style="margin-bottom:1.25rem">
            <button class:active={mode === "login"} onclick={() => (mode = "login")}>{t("app.login")}</button>
            <button class:active={mode === "register"} onclick={() => (mode = "register")}>{t("app.createAccount")}</button>
          </div>

          <form onsubmit={submitAuth}>
            <label class="field">
              <span>{t("app.email")}</span>
              <input type="email" bind:value={email} required autocomplete="username" />
            </label>
            <label class="field">
              <span>{t("app.masterPassword")}</span>
              <input type="password" bind:value={password} required autocomplete="current-password" />
            </label>
            {#if mode === "login" && mfaRequired}
              <label class="field">
                <span>{t("app.twoFaCode")}</span>
                <input bind:value={totpCode} inputmode="numeric" placeholder="123456" autocomplete="one-time-code" />
              </label>
            {/if}
            <button type="submit" disabled={busy}>
              {#if busy}Traitement…{:else}{mode === "register" ? "Créer le coffre" : "Déverrouiller"}{/if}
            </button>
          </form>
          {#if mode === "login"}
            <button type="button" class="ghost full" style="margin-top:0.6rem" onclick={loginWithPasskey} disabled={busy}>{@render lockIcon()}<span>{t("app.loginPasskey")}</span></button>
            {#if ssoEnabled}
              <button type="button" class="ghost full" style="margin-top:0.6rem" onclick={startSso} disabled={busy}>{@render lockIcon()}<span>{t("app.loginSso")}</span></button>
            {/if}
            <button class="link" onclick={() => { mode = "recover"; error = null; }}>{t("app.forgot")}</button>
          {/if}
        {/if}

        <div class="auth-foot">
          {@render lockIcon()}
          <span>{t("app.authFoot")}</span>
        </div>
      </div>
    </main>
  </div>
{:else}
  <div class="layout">
    <header class="topbar">
      <button
        class="icon-btn nav-toggle"
        onclick={() => (menuOpen = !menuOpen)}
        aria-label={t("app.openNav")}
        aria-expanded={menuOpen}
        aria-controls="gp-sidebar"
      >{@render menuIcon()}</button>
      <span class="brand"><span class="mark">{@render logoMark()}</span><span>GhostPass</span></span>
      {#if nav === "vault"}
        <input class="search topbar-search" placeholder={t("app.searchVault")} bind:value={search} />
      {:else}
        <div class="topbar-search"></div>
      {/if}
      <div class="topbar-actions">
        <LanguageSwitcher />
        {@render themeToggle("")}
        {#if nav === "vault"}
          <button class="btn-primary" onclick={startAdd}>{@render plusIcon()}<span>{t("app.newItem")}</span></button>
        {/if}
      </div>
    </header>

    <div class="body">
      <!-- Le voile est un vrai bouton, pas un div décoré : c'est la sortie de
           secours du tiroir, et elle doit être atteignable au clavier comme au
           doigt. Il est `display: none` hors téléphone, donc hors du parcours
           de tabulation le reste du temps. -->
      <button
        class="scrim"
        class:show={menuOpen}
        onclick={() => (menuOpen = false)}
        aria-label={t("app.closeNav")}
      ></button>
      <aside class="sidebar" class:open={menuOpen} id="gp-sidebar">
        <button class="nav-item" class:active={nav === "vault"} onclick={() => { nav = "vault"; menuOpen = false; }}>
          {@render vaultIcon()}<span>{t("app.myVault")}</span>
        </button>
        <button class="nav-item" class:active={nav === "orgs"} onclick={() => { nav = "orgs"; menuOpen = false; }}>
          {@render orgIcon()}<span>{t("app.orgs")}</span>
        </button>
        <button class="nav-item" class:active={nav === "security"} onclick={() => { nav = "security"; menuOpen = false; loadWebauthn(); loadActivity(); loadEmergency(); loadPasskeys(); }}>
          {@render shieldIcon()}<span>{t("app.security")}</span>
        </button>
        <button class="nav-item" class:active={nav === "trash"} onclick={openTrash}>
          {@render trashIcon()}<span>{t("app.trash")}</span>
        </button>

        {#if nav === "vault"}
          <div class="sidebar-tree">
            <button class="tree-all" class:active={selectedFolder === null} onclick={() => selectFolder(null)}>
              {@render vaultIcon()}<span class="tree-name">{t("app.allItems")}</span><span class="tree-count">{items.length}</span>
            </button>
            <div class="tree-section">
              <span class="label" style="margin:0">{t("app.folders")}</span>
              <button class="icon-btn" title={t("app.newFolder")} aria-label={t("app.newFolder")} onclick={() => { newFolderOpen = !newFolderOpen; newFolderName = ""; }}>{@render folderPlusIcon()}</button>
            </div>
            {#if newFolderOpen}
              <form class="new-folder" onsubmit={(e) => { e.preventDefault(); createFolder(); }}>
                <input bind:value={newFolderName} placeholder={t("app.folderPh")} list="folder-list" />
                <button type="submit" class="ghost sm">{t("app.create")}</button>
              </form>
            {/if}
            <datalist id="folder-list">
              {#each folderPaths as p}<option value={p}></option>{/each}
            </datalist>
            {#each orgSections as org (org.orgId)}
              <div class="tree-section">
                <span class="label" style="margin:0">{org.name}</span>
                <span class="tree-count">{org.total}</span>
              </div>
              {#each org.collections as col (col.id)}
                <button
                  class="tree-all"
                  class:active={selectedCollectionId === col.id}
                  style="padding-left:26px"
                  onclick={() => selectCollection(col.id)}
                >
                  <span class="tree-name">{col.name}</span><span class="tree-count">{col.n}</span>
                </button>
              {/each}
            {/each}
            {#each tree.children as folder (folder.path)}
              {@render folderNode(folder, 0)}
            {/each}
          </div>
        {/if}

        <div class="sidebar-foot">
          <span class="pill pill-lock"><span class="dot"></span>{t("app.unlocked")}</span>
          <button class="ghost full" onclick={logout}>{@render lockIcon()}<span>{t("app.lock")}</span></button>
        </div>
      </aside>

      <div class="content">
        {#if nav === "vault"}
          <div class="master">
            <div class="master-title">
              <h2>{search.trim() ? "Résultats" : selectedFolder === null ? "Tous les éléments" : selectedFolder.split("/").pop()}</h2>
              <span class="count">{visibleItems.length}</span>
            </div>
            <div class="master-list">
              {#if visibleItems.length === 0}
                <div class="empty">
                  {@render vaultIcon()}
                  <p>
                    {#if items.length === 0}Coffre vide.<br />Ajoutez votre premier secret.
                    {:else if search.trim()}Aucun résultat.
                    {:else}Aucun secret dans ce dossier.{/if}
                  </p>
                </div>
              {:else}
                {#each visibleItems as item (item.id)}
                  {@render itemEntry(item, 0)}
                {/each}
              {/if}
            </div>
          </div>

        <div class="detail">
          {#if adding}
            <div class="detail-head">
              <span class="avatar lg">{@render plusIcon()}</span>
              <div>
                <h2>{editingId ? "Modifier le secret" : "Nouveau secret"}</h2>
                <div class="sub">{t("app.encBeforeSend")}</div>
              </div>
            </div>
            <form onsubmit={addItem} style="max-width:480px">
              <div class="segmented full" style="margin-bottom:0.3rem">
                <button type="button" class:active={itemKind === "login"} onclick={() => (itemKind = "login")}>{t("app.kindLogin")}</button>
                <button type="button" class:active={itemKind === "note"} onclick={() => (itemKind = "note")}>{t("app.kindNote")}</button>
                <button type="button" class:active={itemKind === "card"} onclick={() => (itemKind = "card")}>{t("app.kindCard")}</button>
              </div>
              <label class="field"><span>{t("app.name")}</span><input bind:value={itemName} placeholder="GitHub" required /></label>
              <label class="field">
                <span>{t("app.folder")} <span class="muted" style="font-weight:400">{t("app.folderHint")}</span></span>
                <input bind:value={itemFolder} placeholder={t("app.folderExample")} list="folder-list" />
              </label>

              {#if itemKind === "login"}
                <label class="field"><span>{t("app.website")}</span><input bind:value={itemUrl} placeholder="github.com" inputmode="url" /></label>
                <label class="field"><span>{t("app.kindLogin")}</span><input bind:value={itemUsername} placeholder="kevin" /></label>
                <div class="field">
                  <span>{t("app.password")}</span>
                  <div class="input-row">
                    <input type={showItemPassword ? "text" : "password"} bind:value={itemPassword} placeholder="••••••" autocomplete="off" autocapitalize="off" spellcheck="false" />
                    <button type="button" class="icon-btn" title={showItemPassword ? "Masquer" : "Afficher"} aria-label={showItemPassword ? "Masquer le mot de passe" : "Afficher le mot de passe"} onclick={() => (showItemPassword = !showItemPassword)}>
                      {#if showItemPassword}{@render eyeOffIcon()}{:else}{@render eyeIcon()}{/if}
                    </button>
                    <button type="button" class="icon-btn" title={t("app.genPassword")} aria-label={t("app.generate")} onclick={genPassword}>{@render diceIcon()}</button>
                    <button type="button" class="icon-btn" class:copied={genOpen} title={t("app.genOptions")} aria-label={t("app.options")} onclick={() => (genOpen = !genOpen)}>{@render slidersIcon()}</button>
                  </div>
                  {#if genOpen}
                    <div class="gen-options">
                      <label class="gen-len">
                        Longueur : <strong>{genOptions.length}</strong>
                        <input type="range" min="8" max="64" bind:value={genOptions.length} oninput={genPassword} />
                      </label>
                      <div class="gen-toggles">
                        <label><input type="checkbox" bind:checked={genOptions.lowercase} onchange={genPassword} /> a-z</label>
                        <label><input type="checkbox" bind:checked={genOptions.uppercase} onchange={genPassword} /> A-Z</label>
                        <label><input type="checkbox" bind:checked={genOptions.digits} onchange={genPassword} /> 0-9</label>
                        <label><input type="checkbox" bind:checked={genOptions.symbols} onchange={genPassword} /> !@#</label>
                      </div>
                    </div>
                  {/if}
                </div>
                <label class="field">
                  <span>Clé TOTP <span class="muted" style="font-weight:400">{t("app.totpHint")}</span></span>
                  <input bind:value={itemTotp} placeholder="JBSWY3DPEHPK3PXP" autocomplete="off" />
                </label>
              {:else if itemKind === "note"}
                <label class="field"><span>{t("app.content")}</span><textarea bind:value={itemNote} rows="6" placeholder={t("app.notePh")}></textarea></label>
              {:else}
                <label class="field"><span>{t("app.cardholder")}</span><input bind:value={itemCardholder} placeholder="Kevin Allioli" /></label>
                <label class="field"><span>{t("app.cardNumber")}</span><input bind:value={itemCardNumber} inputmode="numeric" placeholder="4111 1111 1111 1111" /></label>
                <div class="grid-2">
                  <label class="field"><span>{t("app.cardExp")}</span><input bind:value={itemCardExp} placeholder="12/30" /></label>
                  <label class="field"><span>{t("app.cardCvv")}</span><input bind:value={itemCardCode} inputmode="numeric" placeholder="123" /></label>
                </div>
              {/if}
              <div style="display:flex;gap:0.6rem">
                <button type="submit" disabled={busy}>{editingId ? "Enregistrer" : "Chiffrer & enregistrer"}</button>
                <button type="button" class="ghost" onclick={() => { adding = false; editingId = null; }}>{t("app.cancel")}</button>
              </div>
            </form>
          {:else if selected}
            {@const strength = passwordStrength(selected.password)}
            <div class="detail-head">
              {@render itemAvatar(selected.name, selected.url, true)}
              <div>
                <h2>{selected.name}</h2>
                <div class="sub">
                  {selected.kind === "note" ? "Note sécurisée" : selected.kind === "card" ? "Carte chiffrée" : "Identifiant chiffré"}
                  <!-- La provenance en toutes lettres, pas seulement la pastille
                       de la liste : c'est ici qu'on décide de copier un secret,
                       et savoir qui d'autre le voit fait partie de la décision. -->
                  {#if selected.shared}
                    <br /><span class="muted">{t("app.sharedOrigin", { org: selected.shared.orgName, collection: selected.shared.collectionName })}</span>
                  {/if}
                </div>
              </div>
              <div class="detail-actions">
                <!-- Modifier et supprimer visent l'API personnelle. Sur un
                     élément d'équipe elles créeraient une copie privée au lieu
                     de toucher l'original ; on les retire plutôt que d'offrir
                     un bouton qui ment sur ce qu'il fait. -->
                {#if selected.shared}
                  <!-- Deux raisons distinctes de ne pas offrir de bouton, et
                       elles ne se disent pas pareil. Sans droit d'écrire, c'est
                       un refus définitif. Avec le droit, c'est cet ÉCRAN qui ne
                       sait pas écrire vers une organisation : il n'a ni le
                       chiffrement sous la clé d'org ni la route de suppression,
                       et sauver par l'API personnelle créerait une copie privée
                       que l'équipe ne verrait jamais. Dire « pas d'accès » à un
                       gestionnaire serait faux ; lui offrir le bouton serait
                       pire. On le renvoie là où l'écriture marche. -->
                  <span class="muted">
                    {canWriteShared(selected)
                      ? t("app.sharedEditElsewhere")
                      : t("app.sharedReadOnlyHere")}
                  </span>
                {:else}
                  <button class="ghost sm" onclick={shareEntry} disabled={shareBusy}>{shareBusy ? "…" : "Partager"}</button>
                  <button class="ghost sm" onclick={startEdit}>{t("app.edit")}</button>
                  <button class="danger" onclick={deleteEntry} disabled={busy}>{t("app.delete")}</button>
                {/if}
              </div>
            </div>

            {#if shareLink}
              <div class="callout info" style="flex-direction:column;align-items:stretch;gap:0.4rem;margin-bottom:1rem">
                <span>{t("app.shareA")}<strong>{t("app.shareB")}</strong>{t("app.shareC")}</span>
                <div class="codeblock-wrap">
                  <code class="codeblock">{shareLink}</code>
                  <button class="icon-btn {copiedKey === 'share' ? 'copied' : ''}" title={t("app.copy")} aria-label={t("app.copyLink")} onclick={() => copy(shareLink!, "share")}>
                    {#if copiedKey === "share"}{@render checkIcon()}{:else}{@render copyIcon()}{/if}
                  </button>
                </div>
              </div>
            {/if}

            {#if selected.kind === "note"}
              {#if selected.folder}
                <div class="kv"><div class="kv-row"><span class="kv-label">{t("app.folder")}</span><span class="kv-value">{selected.folder}</span></div></div>
              {/if}
              <div class="note-block">
                <button class="icon-btn {copiedKey === 'd-note' ? 'copied' : ''}" title={t("app.copy")} aria-label={t("app.copyNote")} onclick={() => copy(selected!.note, "d-note")}>
                  {#if copiedKey === "d-note"}{@render checkIcon()}{:else}{@render copyIcon()}{/if}
                </button>
                <pre class="note-content">{selected.note}</pre>
              </div>
            {:else if selected.kind === "card"}
              <div class="kv">
                {#if selected.folder}<div class="kv-row"><span class="kv-label">{t("app.folder")}</span><span class="kv-value">{selected.folder}</span></div>{/if}
                <div class="kv-row">
                  <span class="kv-label">{t("app.cardholder")}</span>
                  <span class="kv-value">{selected.cardholder || "Non renseigné"}</span>
                  {#if selected.cardholder}<span class="kv-actions"><button class="icon-btn {copiedKey === 'd-holder' ? 'copied' : ''}" title={t("app.copy")} aria-label={t("app.copy")} onclick={() => copy(selected!.cardholder, "d-holder")}>{#if copiedKey === "d-holder"}{@render checkIcon()}{:else}{@render copyIcon()}{/if}</button></span>{/if}
                </div>
                <div class="kv-row">
                  <span class="kv-label">{t("app.cardNumber")}</span>
                  <span class="kv-value" class:dots={!detailRevealed}>{detailRevealed ? selected.cardNumber : "•••• •••• •••• ••••"}</span>
                  <span class="kv-actions">
                    <button class="icon-btn" title={detailRevealed ? "Masquer" : "Afficher"} aria-label={t("app.toggleReveal")} onclick={() => (detailRevealed = !detailRevealed)}>{#if detailRevealed}{@render eyeOffIcon()}{:else}{@render eyeIcon()}{/if}</button>
                    <button class="icon-btn {copiedKey === 'd-num' ? 'copied' : ''}" title={t("app.copy")} aria-label={t("app.copy")} onclick={() => copy(selected!.cardNumber, "d-num")}>{#if copiedKey === "d-num"}{@render checkIcon()}{:else}{@render copyIcon()}{/if}</button>
                  </span>
                </div>
                {#if selected.cardExp}<div class="kv-row"><span class="kv-label">{t("app.expiry")}</span><span class="kv-value">{selected.cardExp}</span></div>{/if}
                <div class="kv-row">
                  <span class="kv-label">{t("app.cardCvv")}</span>
                  <span class="kv-value" class:dots={!detailRevealed}>{detailRevealed ? selected.cardCode : "•••"}</span>
                  <span class="kv-actions"><button class="icon-btn {copiedKey === 'd-code' ? 'copied' : ''}" title={t("app.copy")} aria-label={t("app.copy")} onclick={() => copy(selected!.cardCode, "d-code")}>{#if copiedKey === "d-code"}{@render checkIcon()}{:else}{@render copyIcon()}{/if}</button></span>
                </div>
              </div>
            {:else}
            <div class="kv">
              {#if selected.folder}
                <div class="kv-row">
                  <span class="kv-label">{t("app.folder")}</span>
                  <span class="kv-value">{selected.folder}</span>
                </div>
              {/if}
              {#if selected.url}
                <div class="kv-row">
                  <span class="kv-label">{t("app.website")}</span>
                  <a class="kv-value" href={selected.url.includes("://") ? selected.url : `https://${selected.url}`} target="_blank" rel="noopener noreferrer">{selected.url}</a>
                  <span class="kv-actions">
                    <button class="icon-btn {copiedKey === 'd-url' ? 'copied' : ''}" title={t("app.copy")} aria-label={t("app.copyUrl")} onclick={() => copy(selected!.url, "d-url")}>
                      {#if copiedKey === "d-url"}{@render checkIcon()}{:else}{@render copyIcon()}{/if}
                    </button>
                  </span>
                </div>
              {/if}
              <div class="kv-row">
                <span class="kv-label">{t("app.kindLogin")}</span>
                <span class="kv-value">{selected.username || "Non renseigné"}</span>
                {#if selected.username}
                  <span class="kv-actions">
                    <button class="icon-btn {copiedKey === 'd-user' ? 'copied' : ''}" title={t("app.copy")} aria-label={t("app.copyUsername")} onclick={() => copy(selected!.username, "d-user")}>
                      {#if copiedKey === "d-user"}{@render checkIcon()}{:else}{@render copyIcon()}{/if}
                    </button>
                  </span>
                {/if}
              </div>
              <div class="kv-row">
                <span class="kv-label">{t("app.password")}</span>
                <span class="kv-value" class:dots={!detailRevealed}>{detailRevealed ? selected.password : "••••••••••••"}</span>
                {#if selected.password}
                  <span class="strength strength-{strength.level}" title={t("app.strength")}>{strength.label}</span>
                {/if}
                <span class="kv-actions">
                  <button class="icon-btn" title={detailRevealed ? "Masquer" : "Afficher"} aria-label={t("app.toggleReveal")} onclick={() => (detailRevealed = !detailRevealed)}>
                    {#if detailRevealed}{@render eyeOffIcon()}{:else}{@render eyeIcon()}{/if}
                  </button>
                  <button class="icon-btn {copiedKey === 'd-pw' ? 'copied' : ''}" title={t("app.copy")} aria-label={t("app.copyPassword")} onclick={() => copy(selected!.password, "d-pw")}>
                    {#if copiedKey === "d-pw"}{@render checkIcon()}{:else}{@render copyIcon()}{/if}
                  </button>
                </span>
              </div>
              {#if selected.totp}
                <div class="kv-row">
                  <span class="kv-label">{t("app.otpCode")}</span>
                  {#if otp}
                    <span class="kv-value otp-code">{otp.code.slice(0, Math.ceil(otp.code.length / 2))} {otp.code.slice(Math.ceil(otp.code.length / 2))}</span>
                    <span class="otp-ring" style="--frac:{otp.remaining / otp.period}"><span>{otp.remaining}</span></span>
                    <span class="kv-actions">
                      <button class="icon-btn {copiedKey === 'd-otp' ? 'copied' : ''}" title={t("app.copy")} aria-label={t("app.copyCode")} onclick={() => copy(otp!.code, "d-otp")}>
                        {#if copiedKey === "d-otp"}{@render checkIcon()}{:else}{@render copyIcon()}{/if}
                      </button>
                    </span>
                  {:else}
                    <span class="kv-value muted">{t("app.badTotp")}</span>
                  {/if}
                </div>
              {/if}
            </div>
            {#if selected.passwordHistory.length}
              <details class="history">
                <summary>
                  <span class="chevron">{@render chevronIcon()}</span>
                  Historique des mots de passe ({selected.passwordHistory.length})
                </summary>
                <ul class="history-list">
                  {#each selected.passwordHistory as old, i (i)}
                    <li>
                      <span class="mono dots">{histRevealed.has(i) ? old : "••••••••••"}</span>
                      <span class="row-actions">
                        <button class="icon-btn" title={histRevealed.has(i) ? "Masquer" : "Afficher"} aria-label={t("app.toggleReveal")} onclick={() => toggleHist(i)}>
                          {#if histRevealed.has(i)}{@render eyeOffIcon()}{:else}{@render eyeIcon()}{/if}
                        </button>
                        <button class="icon-btn {copiedKey === `hist-${i}` ? 'copied' : ''}" title={t("app.copy")} aria-label={t("app.copy")} onclick={() => copy(old, `hist-${i}`)}>
                          {#if copiedKey === `hist-${i}`}{@render checkIcon()}{:else}{@render copyIcon()}{/if}
                        </button>
                      </span>
                    </li>
                  {/each}
                </ul>
              </details>
            {/if}
            {/if}
            <p class="detail-meta">Dernière modification : {formatDate(selected.updatedAt)}</p>
          {:else}
            <div class="detail-empty">
              <div>
                {@render vaultIcon()}
                <p class="muted" style="margin-top:.6rem">{t("app.emptyA")}<br />{t("app.emptyB")}</p>
              </div>
            </div>
          {/if}
        </div>
      {:else if nav === "security"}
        <div class="single">
          {#if mfaMessage}
            <div class="callout success" style="margin-bottom:1.1rem">{@render checkIcon()}<span>{mfaMessage}</span></div>
          {/if}

          <section class="panel">
            <div class="panel-head"><h2>{t("app.health")}</h2></div>
            {#if items.length === 0}
              <p class="muted">{t("app.healthEmpty")}</p>
            {:else}
              {@render healthRow("Mots de passe faibles", health.weak)}
              {@render healthRow("Mots de passe réutilisés", health.reused)}
              {@render healthRow("Sans double authentification", health.noTotp)}
              <hr class="sep" />
              <p class="label">{t("app.breaches")}</p>
              <p class="muted" style="margin:0 0 0.7rem">
                Vérifie tes mots de passe contre Have I Been Pwned en <strong>k-anonymity</strong> :
                seul un préfixe de hash (5 caractères) est transmis, jamais le mot de passe.
              </p>
              {#if breachDone && breached.length === 0}
                <div class="callout success">{@render checkIcon()}<span>{t("app.noBreach")}</span></div>
              {:else if breachDone}
                {@render healthRow("Compromis dans une fuite", breached)}
              {/if}
              <button class="ghost" onclick={checkBreaches} disabled={breachBusy} style="margin-top:0.7rem">
                {breachBusy ? "Vérification…" : "Vérifier les fuites"}
              </button>
            {/if}
          </section>
          <section class="panel">
            <div class="panel-head"><h2>{t("app.twoFa")}</h2></div>
            {#if mfaSetup}
              <p class="muted">{t("app.twoFaAdd")}</p>
              <div class="codeblock-wrap">
                <code class="codeblock">{mfaSetup.otpauthUri}</code>
                <button class="icon-btn {copiedKey === 'otpauth' ? 'copied' : ''}" title={t("app.copy")} aria-label={t("app.copyUri")} onclick={() => copy(mfaSetup!.otpauthUri, "otpauth")}>
                  {#if copiedKey === "otpauth"}{@render checkIcon()}{:else}{@render copyIcon()}{/if}
                </button>
              </div>
              <form onsubmit={(e) => { e.preventDefault(); confirmMfa(); }} style="margin-top:0.8rem;max-width:320px">
                <label class="field"><span>{t("app.generatedCode")}</span><input bind:value={mfaCode} inputmode="numeric" placeholder="123456" /></label>
                <button type="submit" disabled={busy}>{t("app.enable2fa")}</button>
              </form>
            {:else if !mfaMessage}
              <p class="muted" style="margin:0 0 0.8rem">{t("app.twoFaSub")}</p>
              <button class="ghost" onclick={startMfaSetup}>{t("app.setup2fa")}</button>
            {/if}
          </section>

          <section class="panel">
            <div class="panel-head"><h2>{t("app.passkeys")}</h2></div>
            <p class="muted" style="margin:0 0 0.8rem">
              Déverrouille ton coffre avec une passkey (Face ID / Touch ID / clé FIDO2), sans mot de passe maître.
              <span class="muted">{t("app.passkeysReq")}</span>
            </p>
            {#if passkeyKeys.length}
              <ul class="list">
                {#each passkeyKeys as k (k.id)}
                  <li>
                    <div class="row-main"><span class="row-title">{k.name}</span></div>
                    <div class="row-actions"><button class="danger" onclick={() => removePasskey(k.id)}>{t("app.delete")}</button></div>
                  </li>
                {/each}
              </ul>
              <hr class="sep" />
            {/if}
            <button class="ghost" onclick={addPasskey} disabled={passkeyBusy}>
              {passkeyBusy ? "Enregistrement…" : "Ajouter une passkey"}
            </button>
          </section>

          <section class="panel">
            <div class="panel-head"><h2>{t("app.securityKeys")}</h2></div>
            <p class="muted" style="margin:0 0 0.8rem">
              Ajoutez une clé FIDO2 / YubiKey ou une passkey comme second facteur de connexion.
              <span class="muted">{t("app.securityKeysReq")}</span>
            </p>
            {#if webauthnKeys.length}
              <ul class="list">
                {#each webauthnKeys as k (k.id)}
                  <li>
                    <div class="row-main"><span class="row-title">{k.name}</span></div>
                    <div class="row-actions"><button class="danger" onclick={() => removeSecurityKey(k.id)}>{t("app.delete")}</button></div>
                  </li>
                {/each}
              </ul>
              <hr class="sep" />
            {/if}
            <button class="ghost" onclick={addSecurityKey} disabled={webauthnBusy}>
              {webauthnBusy ? "Enregistrement…" : "Ajouter une clé de sécurité"}
            </button>
          </section>

          <section class="panel">
            <div class="panel-head"><h2>{t("app.emergency")}</h2></div>
            {#if emgInfo}
              <div class="callout success" style="margin-bottom:0.8rem">{@render checkIcon()}<span>{emgInfo}</span></div>
            {/if}

            <p class="label">{t("app.emergencyWho")}</p>
            {#if emgGrantor.length}
              <ul class="list">
                {#each emgGrantor as e (e.id)}
                  <li>
                    <div class="row-main">
                      <span class="row-title">{e.contactEmail}</span>
                      <span class="row-sub"><span class="pill pill-role">{e.role}</span><span class="pill pill-muted">{e.status}</span> · délai {e.waitDays} j</span>
                    </div>
                    <div class="row-actions">
                      {#if e.status === "requested"}
                        <button class="ghost sm" onclick={() => emgAct(e.id, "approve")} disabled={emgBusy}>{t("app.approve")}</button>
                        <button class="ghost sm" onclick={() => emgAct(e.id, "reject")} disabled={emgBusy}>{t("app.deny")}</button>
                      {/if}
                      <button class="danger" onclick={() => emgRemove(e.id)}>{t("app.remove")}</button>
                    </div>
                  </li>
                {/each}
              </ul>
            {:else}
              <p class="muted">{t("app.noContacts")}</p>
            {/if}

            <hr class="sep" />
            <p class="label">{t("app.inviteContact")}</p>
            <form onsubmit={(ev) => { ev.preventDefault(); inviteEmergency(); }}>
              <div class="grid-2">
                <label class="field"><span>{t("app.contactEmail")}</span><input type="email" bind:value={emgEmail} required /></label>
                <label class="field"><span>{t("app.delayDays")}</span><input type="number" min="1" max="90" bind:value={emgWait} /></label>
              </div>
              <label class="field">
                <span>{t("app.accessLevel")}</span>
                <select bind:value={emgRole}>
                  <option value="view">{t("app.readOnly")}</option>
                  <option value="takeover">{t("app.readTakeover")}</option>
                </select>
              </label>
              <button type="submit" disabled={emgBusy}>{t("app.invite")}</button>
            </form>

            {#if emgGrantee.length}
              <hr class="sep" />
              <p class="label">{t("app.accountsIcanReach")}</p>
              <ul class="list">
                {#each emgGrantee as e (e.id)}
                  <li>
                    <div class="row-main">
                      <span class="row-title">{e.contactEmail}</span>
                      <span class="row-sub"><span class="pill pill-role">{e.role}</span><span class="pill pill-muted">{e.status}</span>{#if e.available}<span class="pill pill-lock"><span class="dot"></span>{t("app.available")}</span>{/if}</span>
                    </div>
                    <div class="row-actions">
                      {#if e.status === "invited"}<button class="ghost sm" onclick={() => emgAct(e.id, "accept")} disabled={emgBusy}>{t("app.accept")}</button>{/if}
                      {#if e.status === "accepted"}<button class="ghost sm" onclick={() => emgAct(e.id, "request")} disabled={emgBusy}>{t("app.requestAccess")}</button>{/if}
                      {#if e.available}
                        <button class="ghost sm" onclick={() => emgView(e)} disabled={emgBusy}>{t("app.readVault")}</button>
                        {#if e.role === "takeover"}<button class="danger" onclick={() => emgTakeover(e)} disabled={emgBusy}>{t("app.takeover")}</button>{/if}
                      {/if}
                      <button class="danger" onclick={() => emgRemove(e.id)}>{t("app.remove")}</button>
                    </div>
                  </li>
                {/each}
              </ul>
            {/if}

            {#if emgViewItems}
              <hr class="sep" />
              <p class="label">Coffre de {emgViewFrom}, lecture d'urgence ({emgViewItems.length})</p>
              {#if emgViewItems.length === 0}
                <p class="muted">{t("app.noSecret")}</p>
              {:else}
                <ul class="list">
                  {#each emgViewItems as it, i (i)}
                    <li>
                      <div class="row-main">
                        <span class="row-title">{it.name}</span>
                        {#if it.username}<span class="row-sub"><span class="mono">{it.username}</span></span>{/if}
                      </div>
                      <span class="mono dots">{emgViewRevealed.has(i) ? it.password : "••••••••••"}</span>
                      <div class="row-actions">
                        <button class="icon-btn" aria-label={t("app.toggleReveal")} onclick={() => { const s = new Set(emgViewRevealed); s.has(i) ? s.delete(i) : s.add(i); emgViewRevealed = s; }}>
                          {#if emgViewRevealed.has(i)}{@render eyeOffIcon()}{:else}{@render eyeIcon()}{/if}
                        </button>
                        <button class="icon-btn {copiedKey === `emg-${i}` ? 'copied' : ''}" aria-label={t("app.copy")} onclick={() => copy(it.password, `emg-${i}`)}>
                          {#if copiedKey === `emg-${i}`}{@render checkIcon()}{:else}{@render copyIcon()}{/if}
                        </button>
                      </div>
                    </li>
                  {/each}
                </ul>
              {/if}
            {/if}
          </section>

          <section class="panel">
            <div class="panel-head"><h2>{t("app.recoveryKit")}</h2></div>
            {#if recoveryKitDisplay}
              <div class="callout warn">
                {@render alertIcon()}
                <span>{t("app.recoveryWarn")}</span>
              </div>
              <div class="codeblock-wrap">
                <code class="codeblock">{recoveryKitDisplay}</code>
                <button class="icon-btn {copiedKey === 'recovery' ? 'copied' : ''}" title={t("app.copy")} aria-label={t("app.copyKey")} onclick={() => copy(recoveryKitDisplay!, "recovery")}>
                  {#if copiedKey === "recovery"}{@render checkIcon()}{:else}{@render copyIcon()}{/if}
                </button>
              </div>
            {:else}
              <p class="muted" style="margin:0 0 0.8rem">{t("app.recoverySub")}</p>
              <button class="ghost" onclick={generateRecoveryKit} disabled={busy}>{t("app.genRecovery")}</button>
            {/if}
          </section>

          <section class="panel">
            <div class="panel-head"><h2>{t("app.data")}</h2></div>
            {#if importMessage}
              <div class="callout success" style="margin-bottom:0.8rem">{@render checkIcon()}<span>{importMessage}</span></div>
            {/if}
            <div class="callout warn">
              {@render alertIcon()}
              <span>{t("app.exportA")}<strong>{t("app.exportB")}</strong>{t("app.exportC")}</span>
            </div>
            <div style="display:flex;gap:0.6rem;flex-wrap:wrap;margin-top:0.9rem">
              <button class="ghost" onclick={exportCsv} disabled={personalItems.length === 0}>{t("app.exportCsv")}</button>
              {#if items.length !== personalItems.length}
                <p class="muted" style="margin:0.4rem 0 0">{t("app.exportPersonalOnly")}</p>
              {/if}
              <label class="ghost" style="cursor:pointer">
                Importer (CSV)
                <input type="file" accept=".csv,text/csv" onchange={importCsv} style="display:none" />
              </label>
            </div>
            <p class="muted" style="margin:0.7rem 0 0">{t("app.importCols")}</p>
          </section>

          <section class="panel">
            <div class="panel-head"><h2>{t("app.recentLogins")}</h2><span class="count">{activity.length}</span></div>
            {#if activity.length === 0}
              <p class="muted">{t("app.noLogins")}</p>
            {:else}
              <ul class="list">
                {#each activity as e, i (i)}
                  <li>
                    <div class="row-main">
                      <span class="row-title">{deviceLabel(e.userAgent)}</span>
                      <span class="row-sub"><span class="mono">{e.ip}</span> · {formatDate(e.createdAt)}</span>
                    </div>
                    {#if e.newDevice}<div class="row-actions"><span class="pill pill-warn">{t("app.newDevice")}</span></div>{/if}
                  </li>
                {/each}
              </ul>
            {/if}
          </section>
        </div>
      {:else if nav === "trash"}
        <div class="single">
          <section class="panel">
            <div class="panel-head"><h2>{t("app.trash")}</h2><span class="count">{trashItems.length}</span></div>
            {#if trashItems.length === 0}
              <div class="empty">{@render trashIcon()}<p>{t("app.trashEmpty")}</p></div>
            {:else}
              <ul class="list">
                {#each trashItems as item (item.id)}
                  <li>
                    {@render itemAvatar(item.name, item.url, false)}
                    <div class="row-main">
                      <span class="row-title">{item.name}</span>
                      {#if item.username}<span class="row-sub"><span class="mono">{item.username}</span></span>{/if}
                    </div>
                    <div class="row-actions">
                      <button class="ghost sm" onclick={() => restoreEntry(item)} disabled={busy}>{t("app.restore")}</button>
                      <button class="danger" onclick={() => purgeEntry(item)} disabled={busy}>{t("app.delete")}</button>
                    </div>
                  </li>
                {/each}
              </ul>
            {/if}
          </section>
        </div>
      {:else}
        <Organizations account={account!} token={token!} onError={(m) => (error = m)} />
      {/if}
      </div>
    </div>
  </div>
{/if}

{#if error}
  <div class="toast" role="alert">
    {@render alertIcon()}
    <span>{error}</span>
    <button onclick={() => (error = null)} aria-label={t("app.close")}>×</button>
  </div>
{/if}
