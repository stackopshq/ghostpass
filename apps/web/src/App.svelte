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
    faviconUrl,
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
  let nav = $state<"vault" | "orgs" | "security">("vault");

  // Sélection / recherche dans le coffre (UI).
  let search = $state("");
  let selected = $state<DecryptedItem | null>(null);
  let adding = $state(false);
  let detailRevealed = $state(false);
  let copiedKey = $state<string | null>(null);

  // Formulaire d'ajout de secret.
  let itemName = $state("");
  let itemUsername = $state("");
  let itemPassword = $state("");
  let itemUrl = $state("");

  // Configuration de la 2FA.
  let mfaSetup = $state<{ secret: string; otpauthUri: string } | null>(null);
  let mfaCode = $state("");
  let mfaMessage = $state<string | null>(null);

  const filtered = $derived(
    items.filter((it) => {
      const q = search.trim().toLowerCase();
      if (!q) return true;
      return it.name.toLowerCase().includes(q) || it.username.toLowerCase().includes(q);
    }),
  );

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

  function selectItem(item: DecryptedItem) {
    selected = item;
    adding = false;
    detailRevealed = false;
  }

  function startAdd() {
    adding = true;
    selected = null;
    itemName = "";
    itemUsername = "";
    itemPassword = "";
    itemUrl = "";
  }

  onMount(async () => {
    await ensureCryptoReady();
    cryptoReady = true;
  });

  async function loadItems() {
    if (!token || !account) return;
    const { items: dtos } = await api.listItems(token);
    items = dtos.map((d) => decryptItem(account!, d.encryptedKey, d.encryptedData));
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
      });
      await api.createItem(token, enc);
      itemName = "";
      itemUsername = "";
      itemPassword = "";
      itemUrl = "";
      adding = false;
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
    nav = "vault";
    search = "";
    selected = null;
    adding = false;
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
{#snippet itemAvatar(name: string, url: string, large: boolean)}
  <span class="avatar {large ? 'lg' : ''}">
    {(name || "?").charAt(0).toUpperCase()}
    {#if faviconUrl(url)}
      <img class="avatar-img" src={faviconUrl(url)} alt="" loading="lazy" onerror={(e) => ((e.currentTarget as HTMLImageElement).style.display = "none")} />
    {/if}
  </span>
{/snippet}

{#if !cryptoReady}
  <div class="boot">
    <div class="spinner"></div>
    <p class="muted">Chargement du module cryptographique…</p>
  </div>
{:else if !token}
  <div class="auth-wrap">
    <div class="auth-card panel">
      <div class="auth-head">
        <span class="brand"><span class="mark">{@render logoMark()}</span>GhostPass</span>
        <p>Coffre-fort zero-knowledge — vos secrets, chiffrés sur votre appareil.</p>
      </div>

      {#if infoMessage}
        <div class="callout success" style="margin-bottom:1rem">{@render checkIcon()}<span>{infoMessage}</span></div>
      {/if}

      {#if mode === "recover"}
        <p class="label">Mot de passe oublié</p>
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
        <div class="segmented full" style="margin-bottom:1.1rem">
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
        {@render shieldIcon()}
        <span>Chiffrement de bout en bout. Le serveur ne voit jamais vos secrets.</span>
      </div>
    </div>
  </div>
{:else}
  <div class="app">
    <aside class="sidebar">
      <span class="brand"><span class="mark">{@render logoMark()}</span><span>GhostPass</span></span>
      <button class="nav-item" class:active={nav === "vault"} onclick={() => (nav = "vault")}>
        {@render vaultIcon()}<span>Mon coffre</span>
      </button>
      <button class="nav-item" class:active={nav === "orgs"} onclick={() => (nav = "orgs")}>
        {@render orgIcon()}<span>Organisations</span>
      </button>
      <button class="nav-item" class:active={nav === "security"} onclick={() => (nav = "security")}>
        {@render shieldIcon()}<span>Sécurité</span>
      </button>
      <div class="sidebar-foot">
        <span class="pill pill-lock"><span class="dot"></span>Déverrouillé</span>
        <button class="ghost full" onclick={logout}>{@render lockIcon()}<span style="margin-left:.4rem">Verrouiller</span></button>
      </div>
    </aside>

    <div class="content">
      {#if nav === "vault"}
        <div class="master">
          <div class="master-head">
            <input class="search" placeholder="Rechercher…" bind:value={search} />
            <button class="icon-add" title="Nouveau secret" aria-label="Nouveau secret" onclick={startAdd}>{@render plusIcon()}</button>
          </div>
          <div class="master-list">
            {#if filtered.length === 0}
              <div class="empty">
                {@render vaultIcon()}
                <p>{items.length === 0 ? "Coffre vide.\nAjoutez votre premier secret." : "Aucun résultat."}</p>
              </div>
            {:else}
              {#each filtered as item (item)}
                <button class="entry" class:active={selected === item} onclick={() => selectItem(item)}>
                  {@render itemAvatar(item.name, item.url, false)}
                  <span class="entry-main">
                    <span class="entry-title">{item.name}</span>
                    {#if item.username}<span class="entry-sub">{item.username}</span>{/if}
                  </span>
                </button>
              {/each}
            {/if}
          </div>
        </div>

        <div class="detail">
          {#if adding}
            <div class="detail-head">
              <span class="avatar lg">{@render plusIcon()}</span>
              <div><h2>Nouveau secret</h2><div class="sub">Chiffré sur votre appareil avant l'envoi</div></div>
            </div>
            <form onsubmit={addItem} style="max-width:480px">
              <label class="field"><span>Nom</span><input bind:value={itemName} placeholder="GitHub" required /></label>
              <label class="field"><span>Site web</span><input bind:value={itemUrl} placeholder="github.com" inputmode="url" /></label>
              <label class="field"><span>Identifiant</span><input bind:value={itemUsername} placeholder="kevin" /></label>
              <label class="field"><span>Mot de passe</span><input type="password" bind:value={itemPassword} placeholder="••••••" /></label>
              <button type="submit" disabled={busy}>Chiffrer & enregistrer</button>
            </form>
          {:else if selected}
            <div class="detail-head">
              {@render itemAvatar(selected.name, selected.url, true)}
              <div><h2>{selected.name}</h2><div class="sub">Identifiant chiffré</div></div>
            </div>
            <div class="kv">
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
                <span class="kv-actions">
                  <button class="icon-btn" title={detailRevealed ? "Masquer" : "Afficher"} aria-label="Afficher/masquer" onclick={() => (detailRevealed = !detailRevealed)}>
                    {#if detailRevealed}{@render eyeOffIcon()}{:else}{@render eyeIcon()}{/if}
                  </button>
                  <button class="icon-btn {copiedKey === 'd-pw' ? 'copied' : ''}" title="Copier" aria-label="Copier le mot de passe" onclick={() => copy(selected!.password, "d-pw")}>
                    {#if copiedKey === "d-pw"}{@render checkIcon()}{:else}{@render copyIcon()}{/if}
                  </button>
                </span>
              </div>
            </div>
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
        </div>
      {:else}
        <Organizations account={account!} token={token!} onError={(m) => (error = m)} />
      {/if}
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
