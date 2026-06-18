<script lang="ts">
  import { onMount } from "svelte";
  import type { Account } from "ghostpass-crypto-wasm";
  import { api } from "./lib/api.js";
  import Organizations from "./Organizations.svelte";
  import {
    computeLoginHash,
    createRecovery,
    decryptItem,
    encryptLogin,
    ensureCryptoReady,
    recoverAccount,
    register,
    unlock,
    type DecryptedItem,
  } from "./lib/crypto.js";

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
  let items = $state<DecryptedItem[]>([]);
  let tab = $state<"vault" | "orgs">("vault");

  // Formulaire d'ajout de secret.
  let itemName = $state("");
  let itemUsername = $state("");
  let itemPassword = $state("");

  // Configuration de la 2FA.
  let mfaSetup = $state<{ secret: string; otpauthUri: string } | null>(null);
  let mfaCode = $state("");
  let mfaMessage = $state<string | null>(null);

  function errMsg(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }

  onMount(async () => {
    await ensureCryptoReady();
    cryptoReady = true;
  });

  async function loadItems() {
    if (!token || !account) return;
    const { items: dtos } = await api.listItems(token);
    items = dtos.map((d) => decryptItem(account!, d.encryptedKey, d.encryptedData));
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
      mfaMessage = "Double authentification activée ✓";
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
      });
      await api.createItem(token, enc);
      itemName = "";
      itemUsername = "";
      itemPassword = "";
      await loadItems();
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

<main>
  <h1>🔐 GhostPass</h1>

  {#if !cryptoReady}
    <p class="muted">Chargement du module cryptographique…</p>
  {:else if !token}
    {#if infoMessage}
      <p class="success">{infoMessage}</p>
    {/if}

    {#if mode === "recover"}
      <h2>Mot de passe oublié</h2>
      <form onsubmit={submitRecover}>
        <label>Email<input type="email" bind:value={email} required /></label>
        <label>
          Clé de récupération
          <input bind:value={recoveryKeyInput} required placeholder="votre clé sauvegardée" />
        </label>
        <label>
          Nouveau mot de passe maître
          <input type="password" bind:value={recoverNewPassword} required />
        </label>
        <button type="submit" disabled={busy}>Réinitialiser</button>
      </form>
      <button class="link" onclick={() => { mode = "login"; error = null; }}>← Retour à la connexion</button>
    {:else}
      <div class="tabs">
        <button class:active={mode === "login"} onclick={() => (mode = "login")}>Connexion</button>
        <button class:active={mode === "register"} onclick={() => (mode = "register")}>
          Créer un compte
        </button>
      </div>

      <form onsubmit={submitAuth}>
        <label>Email<input type="email" bind:value={email} required autocomplete="username" /></label>
        <label>
          Mot de passe maître
          <input type="password" bind:value={password} required autocomplete="current-password" />
        </label>
        {#if mode === "login" && mfaRequired}
          <label>
            Code de double authentification
            <input bind:value={totpCode} inputmode="numeric" placeholder="123456" autocomplete="one-time-code" />
          </label>
        {/if}
        <button type="submit" disabled={busy}>
          {mode === "register" ? "Créer le coffre" : "Déverrouiller"}
        </button>
      </form>
      {#if mode === "login"}
        <button class="link" onclick={() => { mode = "recover"; error = null; }}>
          Mot de passe oublié ?
        </button>
      {/if}
    {/if}
  {:else}
    <div class="bar">
      <span class="muted">Connecté — coffre déverrouillé</span>
      <button class="ghost" onclick={logout}>Verrouiller</button>
    </div>

    <div class="tabs">
      <button class:active={tab === "vault"} onclick={() => (tab = "vault")}>Mon coffre</button>
      <button class:active={tab === "orgs"} onclick={() => (tab = "orgs")}>Organisations</button>
    </div>

    {#if tab === "vault"}
    <h2>Sécurité</h2>
    {#if mfaMessage}
      <p class="success">{mfaMessage}</p>
    {/if}
    {#if mfaSetup}
      <p class="muted">Scannez ce code dans votre app d'authentification, puis saisissez un code :</p>
      <code class="block">{mfaSetup.otpauthUri}</code>
      <form onsubmit={(e) => { e.preventDefault(); confirmMfa(); }}>
        <label>Code généré<input bind:value={mfaCode} inputmode="numeric" placeholder="123456" /></label>
        <button type="submit" disabled={busy}>Activer la 2FA</button>
      </form>
    {:else if !mfaMessage}
      <button class="ghost" onclick={startMfaSetup}>Configurer la double authentification</button>
    {/if}

    {#if recoveryKitDisplay}
      <p class="muted">⚠️ Conservez cette clé de récupération en lieu sûr — elle ne sera plus affichée :</p>
      <code class="block">{recoveryKitDisplay}</code>
    {:else}
      <button class="ghost" onclick={generateRecoveryKit} disabled={busy}>
        Générer un kit de récupération
      </button>
    {/if}

    <h2>Ajouter un identifiant</h2>
    <form onsubmit={addItem}>
      <label>Nom<input bind:value={itemName} placeholder="GitHub" required /></label>
      <label>Identifiant<input bind:value={itemUsername} placeholder="kevin" /></label>
      <label>Mot de passe<input bind:value={itemPassword} placeholder="••••••" /></label>
      <button type="submit" disabled={busy}>Chiffrer & enregistrer</button>
    </form>

    <h2>Coffre ({items.length})</h2>
    {#if items.length === 0}
      <p class="muted">Aucun secret pour l'instant.</p>
    {:else}
      <ul>
        {#each items as item}
          <li>
            <strong>{item.name}</strong>
            <span class="muted">{item.username}</span>
            <code>{item.password}</code>
          </li>
        {/each}
      </ul>
    {/if}
    {/if}

    {#if tab === "orgs"}
      <Organizations account={account!} token={token!} onError={(m) => (error = m)} />
    {/if}
  {/if}

  {#if error}
    <p class="error">⚠️ {error}</p>
  {/if}
</main>
