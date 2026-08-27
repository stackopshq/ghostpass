<script lang="ts">
  import { onMount } from "svelte";
  import type { Account } from "ghostpass-crypto-wasm";
  import { api } from "./lib/api.js";
  import Organizations from "./Organizations.svelte";
  import {
    computeLoginHash,
    createRecovery,
    decryptEmergencyItem,
    decryptVaultItem,
    emergencyTakeover,
    encryptFolders,
    encryptItem,
    ensureCryptoReady,
    faviconUrl,
    FOLDERS_ITEM_NAME,
    openEmergency,
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
    const rows = items.map((i) =>
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
        if (q) return it.name.toLowerCase().includes(q) || it.username.toLowerCase().includes(q);
        return selectedFolder === null || it.folder === selectedFolder;
      })
      .sort((a, b) => a.name.localeCompare(b.name)),
  );

  // Entrée de coffre déchiffrée + métadonnées non chiffrées utiles à l'affichage.
  interface VaultEntry extends DecryptedItem {
    id: string;
    updatedAt: number;
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
  const tree = $derived(buildTree(items, emptyFolders));

  function selectFolder(path: string | null) {
    selectedFolder = path;
    // Sur téléphone, choisir un dossier est une navigation : le tiroir doit se
    // refermer, sinon il masque la liste qu'on vient de demander.
    menuOpen = false;
  }

  // Santé des mots de passe (calcul 100 % local).
  const health = $derived.by(() => {
    const counts = new Map<string, number>();
    for (const i of items) if (i.password) counts.set(i.password, (counts.get(i.password) ?? 0) + 1);
    return {
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
  const folderPaths = $derived(
    [...new Set([...items.map((i) => i.folder).filter(Boolean), ...emptyFolders])].sort((a, b) =>
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
    if (!pw) return { label: "—", level: 0 };
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

  async function deleteEntry() {
    if (!selected || !token) return;
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
    items = entries;
    folderRegistryId = registryId;
    emptyFolders = registryPaths;
    selected = null;
    detailRevealed = false;
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
  <button class="icon-btn {extra}" onclick={toggleTheme} title={theme === "dark" ? "Passer en clair" : "Passer en sombre"} aria-label="Basculer le thème">
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
      {:else if item.kind === "note"}<span class="entry-sub">Note sécurisée</span>
      {:else if item.kind === "card" && item.cardNumber}<span class="entry-sub">•••• {item.cardNumber.slice(-4)}</span>{/if}
    </span>
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
      <button class="tree-chevron-btn" title="Déplier/replier" aria-label="Déplier/replier" onclick={() => toggleFolder(node.path)}>
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
      <button class="icon-btn tree-remove" title="Supprimer le dossier" aria-label="Supprimer le dossier vide" onclick={() => removeFolder(node.path)}>×</button>
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
    <p class="muted">Chargement du module cryptographique…</p>
  </div>
{:else if !token}
  <div class="auth">
    <aside class="auth-brand">
      <span class="brand"><span class="mark">{@render logoMark()}</span>GhostPass</span>
      <div>
        <h1 class="auth-hero">Le coffre-fort que même nous ne pouvons pas ouvrir.</h1>
        <ul class="auth-points">
          <li>{@render checkIcon()}<span>Architecture <strong>zero-knowledge</strong> — le serveur ne voit que du chiffré.</span></li>
          <li>{@render checkIcon()}<span>Chiffrement <strong>de bout en bout</strong>, sur votre appareil uniquement.</span></li>
          <li>{@render checkIcon()}<span>Récupération <strong>sans backdoor</strong>, par kit de secours.</span></li>
        </ul>
      </div>
      <!-- Cette ligne annonçait « Hébergé en Suisse · conforme nLPD ». Les deux
           affirmations étaient fausses. L'hébergement est en France, et
           docs/ROADMAP.md range la conformité nLPD/RGPD dans ce qui RESTE à
           faire, avec l'audit externe et le SOC 2.
      
           Sur un produit dont l'argument de vente est qu'il ne peut pas mentir
           sur ce qu'il voit, une conformité revendiquée mais non acquise coûte
           plus cher que l'absence de mention. On ne garde que le vérifiable. -->
      <div class="auth-brand-foot">Hébergé en France · chiffré de bout en bout</div>
    </aside>

    <main class="auth-form-wrap">
      {@render themeToggle("auth-theme-toggle")}
      <div class="auth-form">
        <span class="brand auth-form-logo"><span class="mark">{@render logoMark()}</span>GhostPass</span>

        {#if infoMessage}
          <div class="callout success" style="margin-bottom:1.25rem">{@render checkIcon()}<span>{infoMessage}</span></div>
        {/if}

        {#if ssoPending}
          <h2 class="auth-title">Connexion SSO</h2>
          <p class="auth-sub">Identité vérifiée. Saisissez votre mot de passe maître pour déverrouiller votre coffre.</p>
          <form onsubmit={finishSso}>
            <label class="field"><span>Email</span><input type="email" value={ssoPending.email} readonly /></label>
            <label class="field">
              <span>Mot de passe maître</span>
              <input type="password" bind:value={password} required autocomplete="current-password" />
            </label>
            <button type="submit" disabled={busy}>{busy ? "Déverrouillage…" : "Déverrouiller"}</button>
          </form>
          <button class="link" onclick={() => { ssoPending = null; error = null; }}>← Annuler</button>
        {:else if mode === "recover"}
          <h2 class="auth-title">Mot de passe oublié</h2>
          <p class="auth-sub">Réinitialisez votre mot de passe maître avec votre clé de récupération.</p>
          <form onsubmit={submitRecover}>
            <label class="field"><span>Email</span><input type="email" bind:value={email} required /></label>
            <label class="field">
              <span>Clé de récupération</span>
              <input bind:value={recoveryKeyInput} required placeholder="votre clé sauvegardée" />
            </label>
            <label class="field">
              <span>Nouveau mot de passe maître</span>
              <input type="password" bind:value={recoverNewPassword} required />
            </label>
            <button type="submit" disabled={busy}>{busy ? "Réinitialisation…" : "Réinitialiser"}</button>
          </form>
          <button class="link" onclick={() => { mode = "login"; error = null; }}>← Retour à la connexion</button>
        {:else}
          <h2 class="auth-title">{mode === "login" ? "Bon retour" : "Créer votre coffre"}</h2>
          <p class="auth-sub">
            {mode === "login"
              ? "Connectez-vous à votre coffre GhostPass."
              : "Quelques secondes pour un coffre chiffré rien qu'à vous."}
          </p>

          <div class="segmented full" style="margin-bottom:1.25rem">
            <button class:active={mode === "login"} onclick={() => (mode = "login")}>Connexion</button>
            <button class:active={mode === "register"} onclick={() => (mode = "register")}>Créer un compte</button>
          </div>

          <form onsubmit={submitAuth}>
            <label class="field">
              <span>Email</span>
              <input type="email" bind:value={email} required autocomplete="username" />
            </label>
            <label class="field">
              <span>Mot de passe maître</span>
              <input type="password" bind:value={password} required autocomplete="current-password" />
            </label>
            {#if mode === "login" && mfaRequired}
              <label class="field">
                <span>Code de double authentification</span>
                <input bind:value={totpCode} inputmode="numeric" placeholder="123456" autocomplete="one-time-code" />
              </label>
            {/if}
            <button type="submit" disabled={busy}>
              {#if busy}Traitement…{:else}{mode === "register" ? "Créer le coffre" : "Déverrouiller"}{/if}
            </button>
          </form>
          {#if mode === "login"}
            <button type="button" class="ghost full" style="margin-top:0.6rem" onclick={loginWithPasskey} disabled={busy}>{@render lockIcon()}<span>Se connecter avec une passkey</span></button>
            {#if ssoEnabled}
              <button type="button" class="ghost full" style="margin-top:0.6rem" onclick={startSso} disabled={busy}>{@render lockIcon()}<span>Se connecter en SSO</span></button>
            {/if}
            <button class="link" onclick={() => { mode = "recover"; error = null; }}>Mot de passe oublié ?</button>
          {/if}
        {/if}

        <div class="auth-foot">
          {@render lockIcon()}
          <span>Chiffré de bout en bout. Votre mot de passe maître n'est jamais transmis.</span>
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
        aria-label="Ouvrir la navigation"
        aria-expanded={menuOpen}
        aria-controls="gp-sidebar"
      >{@render menuIcon()}</button>
      <span class="brand"><span class="mark">{@render logoMark()}</span><span>GhostPass</span></span>
      {#if nav === "vault"}
        <input class="search topbar-search" placeholder="Rechercher dans le coffre" bind:value={search} />
      {:else}
        <div class="topbar-search"></div>
      {/if}
      <div class="topbar-actions">
        {@render themeToggle("")}
        {#if nav === "vault"}
          <button class="btn-primary" onclick={startAdd}>{@render plusIcon()}<span>Nouvel élément</span></button>
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
        aria-label="Fermer la navigation"
      ></button>
      <aside class="sidebar" class:open={menuOpen} id="gp-sidebar">
        <button class="nav-item" class:active={nav === "vault"} onclick={() => { nav = "vault"; menuOpen = false; }}>
          {@render vaultIcon()}<span>Mon coffre</span>
        </button>
        <button class="nav-item" class:active={nav === "orgs"} onclick={() => { nav = "orgs"; menuOpen = false; }}>
          {@render orgIcon()}<span>Organisations</span>
        </button>
        <button class="nav-item" class:active={nav === "security"} onclick={() => { nav = "security"; menuOpen = false; loadWebauthn(); loadActivity(); loadEmergency(); loadPasskeys(); }}>
          {@render shieldIcon()}<span>Sécurité</span>
        </button>
        <button class="nav-item" class:active={nav === "trash"} onclick={openTrash}>
          {@render trashIcon()}<span>Corbeille</span>
        </button>

        {#if nav === "vault"}
          <div class="sidebar-tree">
            <button class="tree-all" class:active={selectedFolder === null} onclick={() => selectFolder(null)}>
              {@render vaultIcon()}<span class="tree-name">Tous les éléments</span><span class="tree-count">{items.length}</span>
            </button>
            <div class="tree-section">
              <span class="label" style="margin:0">Dossiers</span>
              <button class="icon-btn" title="Nouveau dossier" aria-label="Nouveau dossier" onclick={() => { newFolderOpen = !newFolderOpen; newFolderName = ""; }}>{@render folderPlusIcon()}</button>
            </div>
            {#if newFolderOpen}
              <form class="new-folder" onsubmit={(e) => { e.preventDefault(); createFolder(); }}>
                <input bind:value={newFolderName} placeholder="Nom (ou A/B)" list="folder-list" />
                <button type="submit" class="ghost sm">Créer</button>
              </form>
            {/if}
            <datalist id="folder-list">
              {#each folderPaths as p}<option value={p}></option>{/each}
            </datalist>
            {#each tree.children as folder (folder.path)}
              {@render folderNode(folder, 0)}
            {/each}
          </div>
        {/if}

        <div class="sidebar-foot">
          <span class="pill pill-lock"><span class="dot"></span>Coffre déverrouillé</span>
          <button class="ghost full" onclick={logout}>{@render lockIcon()}<span>Verrouiller</span></button>
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
                <div class="sub">Chiffré sur votre appareil avant l'envoi</div>
              </div>
            </div>
            <form onsubmit={addItem} style="max-width:480px">
              <div class="segmented full" style="margin-bottom:0.3rem">
                <button type="button" class:active={itemKind === "login"} onclick={() => (itemKind = "login")}>Identifiant</button>
                <button type="button" class:active={itemKind === "note"} onclick={() => (itemKind = "note")}>Note</button>
                <button type="button" class:active={itemKind === "card"} onclick={() => (itemKind = "card")}>Carte</button>
              </div>
              <label class="field"><span>Nom</span><input bind:value={itemName} placeholder="GitHub" required /></label>
              <label class="field">
                <span>Dossier <span class="muted" style="font-weight:400">— optionnel, séparez les niveaux par /</span></span>
                <input bind:value={itemFolder} placeholder="Travail/Serveurs" list="folder-list" />
              </label>

              {#if itemKind === "login"}
                <label class="field"><span>Site web</span><input bind:value={itemUrl} placeholder="github.com" inputmode="url" /></label>
                <label class="field"><span>Identifiant</span><input bind:value={itemUsername} placeholder="kevin" /></label>
                <div class="field">
                  <span>Mot de passe</span>
                  <div class="input-row">
                    <input type="text" bind:value={itemPassword} placeholder="••••••" autocomplete="off" autocapitalize="off" spellcheck="false" />
                    <button type="button" class="icon-btn" title="Générer un mot de passe" aria-label="Générer" onclick={genPassword}>{@render diceIcon()}</button>
                    <button type="button" class="icon-btn" class:copied={genOpen} title="Options du générateur" aria-label="Options" onclick={() => (genOpen = !genOpen)}>{@render slidersIcon()}</button>
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
                  <span>Clé TOTP <span class="muted" style="font-weight:400">— secret base32 ou otpauth://</span></span>
                  <input bind:value={itemTotp} placeholder="JBSWY3DPEHPK3PXP" autocomplete="off" />
                </label>
              {:else if itemKind === "note"}
                <label class="field"><span>Contenu</span><textarea bind:value={itemNote} rows="6" placeholder="Note sécurisée…"></textarea></label>
              {:else}
                <label class="field"><span>Titulaire</span><input bind:value={itemCardholder} placeholder="Kevin Allioli" /></label>
                <label class="field"><span>Numéro</span><input bind:value={itemCardNumber} inputmode="numeric" placeholder="4111 1111 1111 1111" /></label>
                <div class="grid-2">
                  <label class="field"><span>Expiration (MM/AA)</span><input bind:value={itemCardExp} placeholder="12/30" /></label>
                  <label class="field"><span>Cryptogramme</span><input bind:value={itemCardCode} inputmode="numeric" placeholder="123" /></label>
                </div>
              {/if}
              <div style="display:flex;gap:0.6rem">
                <button type="submit" disabled={busy}>{editingId ? "Enregistrer" : "Chiffrer & enregistrer"}</button>
                <button type="button" class="ghost" onclick={() => { adding = false; editingId = null; }}>Annuler</button>
              </div>
            </form>
          {:else if selected}
            {@const strength = passwordStrength(selected.password)}
            <div class="detail-head">
              {@render itemAvatar(selected.name, selected.url, true)}
              <div>
                <h2>{selected.name}</h2>
                <div class="sub">{selected.kind === "note" ? "Note sécurisée" : selected.kind === "card" ? "Carte chiffrée" : "Identifiant chiffré"}</div>
              </div>
              <div class="detail-actions">
                <button class="ghost sm" onclick={shareEntry} disabled={shareBusy}>{shareBusy ? "…" : "Partager"}</button>
                <button class="ghost sm" onclick={startEdit}>Modifier</button>
                <button class="danger" onclick={deleteEntry} disabled={busy}>Supprimer</button>
              </div>
            </div>

            {#if shareLink}
              <div class="callout info" style="flex-direction:column;align-items:stretch;gap:0.4rem;margin-bottom:1rem">
                <span>Lien de partage — <strong>1 vue, expire dans 24 h</strong>. La clé est dans l'URL (#), jamais envoyée au serveur.</span>
                <div class="codeblock-wrap">
                  <code class="codeblock">{shareLink}</code>
                  <button class="icon-btn {copiedKey === 'share' ? 'copied' : ''}" title="Copier" aria-label="Copier le lien" onclick={() => copy(shareLink!, "share")}>
                    {#if copiedKey === "share"}{@render checkIcon()}{:else}{@render copyIcon()}{/if}
                  </button>
                </div>
              </div>
            {/if}

            {#if selected.kind === "note"}
              {#if selected.folder}
                <div class="kv"><div class="kv-row"><span class="kv-label">Dossier</span><span class="kv-value">{selected.folder}</span></div></div>
              {/if}
              <div class="note-block">
                <button class="icon-btn {copiedKey === 'd-note' ? 'copied' : ''}" title="Copier" aria-label="Copier la note" onclick={() => copy(selected!.note, "d-note")}>
                  {#if copiedKey === "d-note"}{@render checkIcon()}{:else}{@render copyIcon()}{/if}
                </button>
                <pre class="note-content">{selected.note}</pre>
              </div>
            {:else if selected.kind === "card"}
              <div class="kv">
                {#if selected.folder}<div class="kv-row"><span class="kv-label">Dossier</span><span class="kv-value">{selected.folder}</span></div>{/if}
                <div class="kv-row">
                  <span class="kv-label">Titulaire</span>
                  <span class="kv-value">{selected.cardholder || "—"}</span>
                  {#if selected.cardholder}<span class="kv-actions"><button class="icon-btn {copiedKey === 'd-holder' ? 'copied' : ''}" title="Copier" aria-label="Copier" onclick={() => copy(selected!.cardholder, "d-holder")}>{#if copiedKey === "d-holder"}{@render checkIcon()}{:else}{@render copyIcon()}{/if}</button></span>{/if}
                </div>
                <div class="kv-row">
                  <span class="kv-label">Numéro</span>
                  <span class="kv-value" class:dots={!detailRevealed}>{detailRevealed ? selected.cardNumber : "•••• •••• •••• ••••"}</span>
                  <span class="kv-actions">
                    <button class="icon-btn" title={detailRevealed ? "Masquer" : "Afficher"} aria-label="Afficher/masquer" onclick={() => (detailRevealed = !detailRevealed)}>{#if detailRevealed}{@render eyeOffIcon()}{:else}{@render eyeIcon()}{/if}</button>
                    <button class="icon-btn {copiedKey === 'd-num' ? 'copied' : ''}" title="Copier" aria-label="Copier" onclick={() => copy(selected!.cardNumber, "d-num")}>{#if copiedKey === "d-num"}{@render checkIcon()}{:else}{@render copyIcon()}{/if}</button>
                  </span>
                </div>
                {#if selected.cardExp}<div class="kv-row"><span class="kv-label">Expiration</span><span class="kv-value">{selected.cardExp}</span></div>{/if}
                <div class="kv-row">
                  <span class="kv-label">Cryptogramme</span>
                  <span class="kv-value" class:dots={!detailRevealed}>{detailRevealed ? selected.cardCode : "•••"}</span>
                  <span class="kv-actions"><button class="icon-btn {copiedKey === 'd-code' ? 'copied' : ''}" title="Copier" aria-label="Copier" onclick={() => copy(selected!.cardCode, "d-code")}>{#if copiedKey === "d-code"}{@render checkIcon()}{:else}{@render copyIcon()}{/if}</button></span>
                </div>
              </div>
            {:else}
            <div class="kv">
              {#if selected.folder}
                <div class="kv-row">
                  <span class="kv-label">Dossier</span>
                  <span class="kv-value">{selected.folder}</span>
                </div>
              {/if}
              {#if selected.url}
                <div class="kv-row">
                  <span class="kv-label">Site web</span>
                  <a class="kv-value" href={selected.url.includes("://") ? selected.url : `https://${selected.url}`} target="_blank" rel="noopener noreferrer">{selected.url}</a>
                  <span class="kv-actions">
                    <button class="icon-btn {copiedKey === 'd-url' ? 'copied' : ''}" title="Copier" aria-label="Copier l'URL" onclick={() => copy(selected!.url, "d-url")}>
                      {#if copiedKey === "d-url"}{@render checkIcon()}{:else}{@render copyIcon()}{/if}
                    </button>
                  </span>
                </div>
              {/if}
              <div class="kv-row">
                <span class="kv-label">Identifiant</span>
                <span class="kv-value">{selected.username || "—"}</span>
                {#if selected.username}
                  <span class="kv-actions">
                    <button class="icon-btn {copiedKey === 'd-user' ? 'copied' : ''}" title="Copier" aria-label="Copier l'identifiant" onclick={() => copy(selected!.username, "d-user")}>
                      {#if copiedKey === "d-user"}{@render checkIcon()}{:else}{@render copyIcon()}{/if}
                    </button>
                  </span>
                {/if}
              </div>
              <div class="kv-row">
                <span class="kv-label">Mot de passe</span>
                <span class="kv-value" class:dots={!detailRevealed}>{detailRevealed ? selected.password : "••••••••••••"}</span>
                {#if selected.password}
                  <span class="strength strength-{strength.level}" title="Force estimée">{strength.label}</span>
                {/if}
                <span class="kv-actions">
                  <button class="icon-btn" title={detailRevealed ? "Masquer" : "Afficher"} aria-label="Afficher/masquer" onclick={() => (detailRevealed = !detailRevealed)}>
                    {#if detailRevealed}{@render eyeOffIcon()}{:else}{@render eyeIcon()}{/if}
                  </button>
                  <button class="icon-btn {copiedKey === 'd-pw' ? 'copied' : ''}" title="Copier" aria-label="Copier le mot de passe" onclick={() => copy(selected!.password, "d-pw")}>
                    {#if copiedKey === "d-pw"}{@render checkIcon()}{:else}{@render copyIcon()}{/if}
                  </button>
                </span>
              </div>
              {#if selected.totp}
                <div class="kv-row">
                  <span class="kv-label">Code à usage unique</span>
                  {#if otp}
                    <span class="kv-value otp-code">{otp.code.slice(0, Math.ceil(otp.code.length / 2))} {otp.code.slice(Math.ceil(otp.code.length / 2))}</span>
                    <span class="otp-ring" style="--frac:{otp.remaining / otp.period}"><span>{otp.remaining}</span></span>
                    <span class="kv-actions">
                      <button class="icon-btn {copiedKey === 'd-otp' ? 'copied' : ''}" title="Copier" aria-label="Copier le code" onclick={() => copy(otp!.code, "d-otp")}>
                        {#if copiedKey === "d-otp"}{@render checkIcon()}{:else}{@render copyIcon()}{/if}
                      </button>
                    </span>
                  {:else}
                    <span class="kv-value muted">clé TOTP invalide</span>
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
                        <button class="icon-btn" title={histRevealed.has(i) ? "Masquer" : "Afficher"} aria-label="Afficher/masquer" onclick={() => toggleHist(i)}>
                          {#if histRevealed.has(i)}{@render eyeOffIcon()}{:else}{@render eyeIcon()}{/if}
                        </button>
                        <button class="icon-btn {copiedKey === `hist-${i}` ? 'copied' : ''}" title="Copier" aria-label="Copier" onclick={() => copy(old, `hist-${i}`)}>
                          {#if copiedKey === `hist-${i}`}{@render checkIcon()}{:else}{@render copyIcon()}{/if}
                        </button>
                      </span>
                    </li>
                  {/each}
                </ul>
              </details>
            {/if}
            {/if}
            <p class="detail-meta">Dernière modification — {formatDate(selected.updatedAt)}</p>
          {:else}
            <div class="detail-empty">
              <div>
                {@render vaultIcon()}
                <p class="muted" style="margin-top:.6rem">Sélectionnez un secret pour l'afficher,<br />ou créez-en un avec +.</p>
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
            <div class="panel-head"><h2>Santé des mots de passe</h2></div>
            {#if items.length === 0}
              <p class="muted">Ajoutez des secrets pour voir leur analyse.</p>
            {:else}
              {@render healthRow("Mots de passe faibles", health.weak)}
              {@render healthRow("Mots de passe réutilisés", health.reused)}
              {@render healthRow("Sans double authentification", health.noTotp)}
              <hr class="sep" />
              <p class="label">Fuites connues (dark web)</p>
              <p class="muted" style="margin:0 0 0.7rem">
                Vérifie tes mots de passe contre Have I Been Pwned en <strong>k-anonymity</strong> :
                seul un préfixe de hash (5 caractères) est transmis, jamais le mot de passe.
              </p>
              {#if breachDone && breached.length === 0}
                <div class="callout success">{@render checkIcon()}<span>Aucun mot de passe trouvé dans une fuite connue.</span></div>
              {:else if breachDone}
                {@render healthRow("Compromis dans une fuite", breached)}
              {/if}
              <button class="ghost" onclick={checkBreaches} disabled={breachBusy} style="margin-top:0.7rem">
                {breachBusy ? "Vérification…" : "Vérifier les fuites"}
              </button>
            {/if}
          </section>
          <section class="panel">
            <div class="panel-head"><h2>Double authentification</h2></div>
            {#if mfaSetup}
              <p class="muted">Ajoutez cette URI dans votre application d'authentification, puis saisissez un code généré :</p>
              <div class="codeblock-wrap">
                <code class="codeblock">{mfaSetup.otpauthUri}</code>
                <button class="icon-btn {copiedKey === 'otpauth' ? 'copied' : ''}" title="Copier" aria-label="Copier l'URI" onclick={() => copy(mfaSetup!.otpauthUri, "otpauth")}>
                  {#if copiedKey === "otpauth"}{@render checkIcon()}{:else}{@render copyIcon()}{/if}
                </button>
              </div>
              <form onsubmit={(e) => { e.preventDefault(); confirmMfa(); }} style="margin-top:0.8rem;max-width:320px">
                <label class="field"><span>Code généré</span><input bind:value={mfaCode} inputmode="numeric" placeholder="123456" /></label>
                <button type="submit" disabled={busy}>Activer la 2FA</button>
              </form>
            {:else if !mfaMessage}
              <p class="muted" style="margin:0 0 0.8rem">Renforce la connexion avec un code à usage unique (TOTP).</p>
              <button class="ghost" onclick={startMfaSetup}>Configurer la double authentification</button>
            {/if}
          </section>

          <section class="panel">
            <div class="panel-head"><h2>Passkeys (connexion sans mot de passe)</h2></div>
            <p class="muted" style="margin:0 0 0.8rem">
              Déverrouille ton coffre avec une passkey (Face ID / Touch ID / clé FIDO2), sans mot de passe maître.
              <span class="muted">Nécessite https ou localhost + un authentificateur compatible PRF.</span>
            </p>
            {#if passkeyKeys.length}
              <ul class="list">
                {#each passkeyKeys as k (k.id)}
                  <li>
                    <div class="row-main"><span class="row-title">{k.name}</span></div>
                    <div class="row-actions"><button class="danger" onclick={() => removePasskey(k.id)}>Supprimer</button></div>
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
            <div class="panel-head"><h2>Clés de sécurité (WebAuthn)</h2></div>
            <p class="muted" style="margin:0 0 0.8rem">
              Ajoutez une clé FIDO2 / YubiKey ou une passkey comme second facteur de connexion.
              <span class="muted">Nécessite https ou localhost.</span>
            </p>
            {#if webauthnKeys.length}
              <ul class="list">
                {#each webauthnKeys as k (k.id)}
                  <li>
                    <div class="row-main"><span class="row-title">{k.name}</span></div>
                    <div class="row-actions"><button class="danger" onclick={() => removeSecurityKey(k.id)}>Supprimer</button></div>
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
            <div class="panel-head"><h2>Accès d'urgence</h2></div>
            {#if emgInfo}
              <div class="callout success" style="margin-bottom:0.8rem">{@render checkIcon()}<span>{emgInfo}</span></div>
            {/if}

            <p class="label">Contacts qui pourront accéder à mon coffre</p>
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
                        <button class="ghost sm" onclick={() => emgAct(e.id, "approve")} disabled={emgBusy}>Approuver</button>
                        <button class="ghost sm" onclick={() => emgAct(e.id, "reject")} disabled={emgBusy}>Refuser</button>
                      {/if}
                      <button class="danger" onclick={() => emgRemove(e.id)}>Retirer</button>
                    </div>
                  </li>
                {/each}
              </ul>
            {:else}
              <p class="muted">Aucun contact de confiance.</p>
            {/if}

            <hr class="sep" />
            <p class="label">Inviter un contact</p>
            <form onsubmit={(ev) => { ev.preventDefault(); inviteEmergency(); }}>
              <div class="grid-2">
                <label class="field"><span>Email du contact</span><input type="email" bind:value={emgEmail} required /></label>
                <label class="field"><span>Délai (jours)</span><input type="number" min="1" max="90" bind:value={emgWait} /></label>
              </div>
              <label class="field">
                <span>Niveau d'accès</span>
                <select bind:value={emgRole}>
                  <option value="view">Lecture seule</option>
                  <option value="takeover">Lecture + takeover (reset du mot de passe)</option>
                </select>
              </label>
              <button type="submit" disabled={emgBusy}>Inviter</button>
            </form>

            {#if emgGrantee.length}
              <hr class="sep" />
              <p class="label">Comptes auxquels je peux accéder</p>
              <ul class="list">
                {#each emgGrantee as e (e.id)}
                  <li>
                    <div class="row-main">
                      <span class="row-title">{e.contactEmail}</span>
                      <span class="row-sub"><span class="pill pill-role">{e.role}</span><span class="pill pill-muted">{e.status}</span>{#if e.available}<span class="pill pill-lock"><span class="dot"></span>disponible</span>{/if}</span>
                    </div>
                    <div class="row-actions">
                      {#if e.status === "invited"}<button class="ghost sm" onclick={() => emgAct(e.id, "accept")} disabled={emgBusy}>Accepter</button>{/if}
                      {#if e.status === "accepted"}<button class="ghost sm" onclick={() => emgAct(e.id, "request")} disabled={emgBusy}>Demander l'accès</button>{/if}
                      {#if e.available}
                        <button class="ghost sm" onclick={() => emgView(e)} disabled={emgBusy}>Lire le coffre</button>
                        {#if e.role === "takeover"}<button class="danger" onclick={() => emgTakeover(e)} disabled={emgBusy}>Reprendre</button>{/if}
                      {/if}
                      <button class="danger" onclick={() => emgRemove(e.id)}>Retirer</button>
                    </div>
                  </li>
                {/each}
              </ul>
            {/if}

            {#if emgViewItems}
              <hr class="sep" />
              <p class="label">Coffre de {emgViewFrom} — lecture d'urgence ({emgViewItems.length})</p>
              {#if emgViewItems.length === 0}
                <p class="muted">Aucun secret.</p>
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
                        <button class="icon-btn" aria-label="Afficher/masquer" onclick={() => { const s = new Set(emgViewRevealed); s.has(i) ? s.delete(i) : s.add(i); emgViewRevealed = s; }}>
                          {#if emgViewRevealed.has(i)}{@render eyeOffIcon()}{:else}{@render eyeIcon()}{/if}
                        </button>
                        <button class="icon-btn {copiedKey === `emg-${i}` ? 'copied' : ''}" aria-label="Copier" onclick={() => copy(it.password, `emg-${i}`)}>
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
            <div class="panel-head"><h2>Kit de récupération</h2></div>
            {#if recoveryKitDisplay}
              <div class="callout warn">
                {@render alertIcon()}
                <span>Conservez cette clé en lieu sûr — elle ne sera plus jamais affichée. Sans elle, un mot de passe maître perdu est définitivement perdu.</span>
              </div>
              <div class="codeblock-wrap">
                <code class="codeblock">{recoveryKitDisplay}</code>
                <button class="icon-btn {copiedKey === 'recovery' ? 'copied' : ''}" title="Copier" aria-label="Copier la clé" onclick={() => copy(recoveryKitDisplay!, "recovery")}>
                  {#if copiedKey === "recovery"}{@render checkIcon()}{:else}{@render copyIcon()}{/if}
                </button>
              </div>
            {:else}
              <p class="muted" style="margin:0 0 0.8rem">Génère une clé de secours qui permet de réinitialiser le mot de passe maître — sans backdoor côté serveur.</p>
              <button class="ghost" onclick={generateRecoveryKit} disabled={busy}>Générer un kit de récupération</button>
            {/if}
          </section>

          <section class="panel">
            <div class="panel-head"><h2>Données</h2></div>
            {#if importMessage}
              <div class="callout success" style="margin-bottom:0.8rem">{@render checkIcon()}<span>{importMessage}</span></div>
            {/if}
            <div class="callout warn">
              {@render alertIcon()}
              <span>L'export contient vos secrets <strong>en clair</strong> dans un fichier CSV. Conservez-le en lieu sûr et supprimez-le après usage.</span>
            </div>
            <div style="display:flex;gap:0.6rem;flex-wrap:wrap;margin-top:0.9rem">
              <button class="ghost" onclick={exportCsv} disabled={items.length === 0}>Exporter (CSV)</button>
              <label class="ghost" style="cursor:pointer">
                Importer (CSV)
                <input type="file" accept=".csv,text/csv" onchange={importCsv} style="display:none" />
              </label>
            </div>
            <p class="muted" style="margin:0.7rem 0 0">Colonnes reconnues : name, username, password, url, folder, totp (compatible exports 1Password / Bitwarden / Proton).</p>
          </section>

          <section class="panel">
            <div class="panel-head"><h2>Connexions récentes</h2><span class="count">{activity.length}</span></div>
            {#if activity.length === 0}
              <p class="muted">Aucune connexion enregistrée.</p>
            {:else}
              <ul class="list">
                {#each activity as e, i (i)}
                  <li>
                    <div class="row-main">
                      <span class="row-title">{deviceLabel(e.userAgent)}</span>
                      <span class="row-sub"><span class="mono">{e.ip}</span> · {formatDate(e.createdAt)}</span>
                    </div>
                    {#if e.newDevice}<div class="row-actions"><span class="pill pill-warn">Nouvel appareil</span></div>{/if}
                  </li>
                {/each}
              </ul>
            {/if}
          </section>
        </div>
      {:else if nav === "trash"}
        <div class="single">
          <section class="panel">
            <div class="panel-head"><h2>Corbeille</h2><span class="count">{trashItems.length}</span></div>
            {#if trashItems.length === 0}
              <div class="empty">{@render trashIcon()}<p>La corbeille est vide.</p></div>
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
                      <button class="ghost sm" onclick={() => restoreEntry(item)} disabled={busy}>Restaurer</button>
                      <button class="danger" onclick={() => purgeEntry(item)} disabled={busy}>Supprimer</button>
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
    <button onclick={() => (error = null)} aria-label="Fermer">×</button>
  </div>
{/if}
