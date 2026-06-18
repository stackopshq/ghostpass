<script lang="ts">
  import { onMount } from "svelte";
  import type { Account } from "ghostpass-crypto-wasm";
  import { api } from "./lib/api.js";
  import Organizations from "./Organizations.svelte";
  import {
    computeLoginHash,
    createRecovery,
    decryptVaultItem,
    encryptFolders,
    encryptLogin,
    ensureCryptoReady,
    faviconUrl,
    recoverAccount,
    register,
    unlock,
    type DecryptedItem,
  } from "./lib/crypto.js";
  import { generateOtp, parseOtp } from "./lib/totp.js";
  import { DEFAULT_GEN_OPTIONS, generatePassword, type GenOptions } from "./lib/generator.js";
  import { parseCsv } from "./lib/csv.js";

  let cryptoReady = $state(false);
  let busy = $state(false);
  let error = $state<string | null>(null);

  let mode = $state<"login" | "register" | "recover">("login");
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
  let nav = $state<"vault" | "orgs" | "security">("vault");

  // Sélection / recherche dans le coffre (UI).
  let search = $state("");
  let selected = $state<VaultEntry | null>(null);
  let adding = $state(false);
  let editingId = $state<string | null>(null);
  let detailRevealed = $state(false);
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
  let itemName = $state("");
  let itemUsername = $state("");
  let itemPassword = $state("");
  let itemUrl = $state("");
  let itemFolder = $state("");
  let itemTotp = $state("");

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
        const enc = encryptLogin(account, {
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
  }

  function startAdd() {
    // Pré-remplit le dossier avec celui de l'entrée affichée (pratique pour enchaîner).
    itemFolder = selected?.folder ?? "";
    editingId = null;
    adding = true;
    selected = null;
    itemName = "";
    itemUsername = "";
    itemPassword = "";
    itemUrl = "";
    itemTotp = "";
  }

  function startEdit() {
    if (!selected) return;
    editingId = selected.id;
    itemName = selected.name;
    itemUrl = selected.url;
    itemUsername = selected.username;
    itemPassword = selected.password;
    itemFolder = selected.folder;
    itemTotp = selected.totp;
    adding = true;
  }

  async function deleteEntry() {
    if (!selected || !token) return;
    if (!confirm(`Supprimer « ${selected.name} » ? Cette action est définitive.`)) return;
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

  onMount(async () => {
    await ensureCryptoReady();
    cryptoReady = true;
  });

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
        const res = await api.login(email, hash, totpCode || undefined);
        if (!res.ok) {
          if (res.mfaRequired) mfaRequired = true;
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
      const enc = encryptLogin(account, {
        name: itemName,
        username: itemUsername,
        password: itemPassword,
        url: itemUrl,
        folder: itemFolder,
        totp: itemTotp,
      });
      const savedId = editingId
        ? (await api.updateItem(token, editingId, enc), editingId)
        : (await api.createItem(token, enc)).id;
      itemName = "";
      itemUsername = "";
      itemPassword = "";
      itemUrl = "";
      itemFolder = "";
      itemTotp = "";
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
    recoveryKitDisplay = null;
    recoveryKeyInput = "";
    recoverNewPassword = "";
  }
</script>

{#snippet logoMark()}
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <rect x="4" y="10.5" width="16" height="10.5" rx="2" />
    <path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" />
  </svg>
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
      {#if item.username}<span class="entry-sub">{item.username}</span>{/if}
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
      <div class="auth-brand-foot">Hébergé en Suisse · conforme nLPD</div>
    </aside>

    <main class="auth-form-wrap">
      {@render themeToggle("auth-theme-toggle")}
      <div class="auth-form">
        <span class="brand auth-form-logo"><span class="mark">{@render logoMark()}</span>GhostPass</span>

        {#if infoMessage}
          <div class="callout success" style="margin-bottom:1.25rem">{@render checkIcon()}<span>{infoMessage}</span></div>
        {/if}

        {#if mode === "recover"}
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
      <aside class="sidebar">
        <button class="nav-item" class:active={nav === "vault"} onclick={() => (nav = "vault")}>
          {@render vaultIcon()}<span>Mon coffre</span>
        </button>
        <button class="nav-item" class:active={nav === "orgs"} onclick={() => (nav = "orgs")}>
          {@render orgIcon()}<span>Organisations</span>
        </button>
        <button class="nav-item" class:active={nav === "security"} onclick={() => (nav = "security")}>
          {@render shieldIcon()}<span>Sécurité</span>
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
              <label class="field"><span>Nom</span><input bind:value={itemName} placeholder="GitHub" required /></label>
              <label class="field">
                <span>Dossier <span class="muted" style="font-weight:400">— optionnel, séparez les niveaux par /</span></span>
                <input bind:value={itemFolder} placeholder="Travail/Serveurs" list="folder-list" />
              </label>
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
              <div style="display:flex;gap:0.6rem">
                <button type="submit" disabled={busy}>{editingId ? "Enregistrer" : "Chiffrer & enregistrer"}</button>
                <button type="button" class="ghost" onclick={() => { adding = false; editingId = null; }}>Annuler</button>
              </div>
            </form>
          {:else if selected}
            {@const strength = passwordStrength(selected.password)}
            <div class="detail-head">
              {@render itemAvatar(selected.name, selected.url, true)}
              <div><h2>{selected.name}</h2><div class="sub">Identifiant chiffré</div></div>
              <div class="detail-actions">
                <button class="ghost sm" onclick={startEdit}>Modifier</button>
                <button class="danger" onclick={deleteEntry} disabled={busy}>Supprimer</button>
              </div>
            </div>
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
