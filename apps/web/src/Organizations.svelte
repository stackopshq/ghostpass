<script lang="ts">
  import type { Account } from "ghostpass-crypto-wasm";
  import { api } from "./lib/api.js";
  import {
    createOrg,
    decryptOrgItem,
    encryptOrgLogin,
    faviconUrl,
    openOrg,
    rewrapOrgItem,
    sealOrgKeyForMember,
    type DecryptedItem,
    type OrgHandle,
  } from "./lib/crypto.js";

  let { account, token, onError }: { account: Account; token: string; onError: (m: string) => void } =
    $props();

  type OrgSummary = { orgId: string; name: string; role: string; status: string };
  type Member = {
    userId: string;
    email: string | null;
    publicKey: string | null;
    role: string;
    status: string;
  };
  type Collection = { id: string; name: string };

  let orgs = $state<OrgSummary[]>([]);
  let busy = $state(false);

  // Vue détail d'une org ouverte.
  let current = $state<OrgSummary | null>(null);
  let currentOrg = $state<OrgHandle | null>(null);
  let members = $state<Member[]>([]);
  let collections = $state<Collection[]>([]);
  let selectedCollection = $state<Collection | null>(null);
  let items = $state<DecryptedItem[]>([]);
  let pane = $state<"members" | "collection" | null>(null);

  // Formulaires.
  let newOrgName = $state("");
  let inviteEmail = $state("");
  let inviteRole = $state("member");
  let newCollName = $state("");
  let itemName = $state("");
  let itemUsername = $state("");
  let itemPassword = $state("");
  let itemUrl = $state("");
  let grantUserId = $state("");
  let grantPermission = $state("read");

  // État d'affichage (UI uniquement).
  let revealed = $state<Set<number>>(new Set());
  let copiedKey = $state<string | null>(null);

  function fail(err: unknown) {
    onError(err instanceof Error ? err.message : String(err));
  }

  function toggleReveal(i: number) {
    const next = new Set(revealed);
    next.has(i) ? next.delete(i) : next.add(i);
    revealed = next;
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

  async function loadOrgs() {
    try {
      orgs = (await api.listOrgs(token)).organizations;
    } catch (err) {
      fail(err);
    }
  }
  loadOrgs();

  async function submitCreateOrg(e: SubmitEvent) {
    e.preventDefault();
    busy = true;
    try {
      const { sealedForSelf } = createOrg(account);
      await api.createOrg(token, { name: newOrgName, encryptedOrgKey: sealedForSelf });
      newOrgName = "";
      await loadOrgs();
    } catch (err) {
      fail(err);
    } finally {
      busy = false;
    }
  }

  async function accept(org: OrgSummary) {
    busy = true;
    try {
      await api.acceptInvite(token, org.orgId);
      await loadOrgs();
    } catch (err) {
      fail(err);
    } finally {
      busy = false;
    }
  }

  async function open(org: OrgSummary) {
    busy = true;
    try {
      const m = await api.getMembership(token, org.orgId);
      if (!m.encryptedOrgKey || !m.sealedByPublicKey) throw new Error("clé d'org indisponible");
      currentOrg = openOrg(account, m.sealedByPublicKey, m.encryptedOrgKey);
      current = org;
      collections = (await api.listCollections(token, org.orgId)).collections;
      members = org.role === "admin" ? (await api.listMembers(token, org.orgId)).members : [];
      selectedCollection = null;
      items = [];
      pane = null;
    } catch (err) {
      fail(err);
    } finally {
      busy = false;
    }
  }

  function back() {
    current = null;
    currentOrg = null;
    members = [];
    collections = [];
    selectedCollection = null;
    items = [];
    pane = null;
    loadOrgs();
  }

  function openMembers() {
    pane = "members";
    selectedCollection = null;
  }

  async function invite(e: SubmitEvent) {
    e.preventDefault();
    if (!current || !currentOrg) return;
    busy = true;
    try {
      const { publicKey } = await api.lookupPublicKey(token, inviteEmail);
      const encryptedOrgKey = sealOrgKeyForMember(account, currentOrg, publicKey);
      await api.addMember(token, current.orgId, { email: inviteEmail, role: inviteRole, encryptedOrgKey });
      inviteEmail = "";
      members = (await api.listMembers(token, current.orgId)).members;
    } catch (err) {
      fail(err);
    } finally {
      busy = false;
    }
  }

  async function revoke(member: Member) {
    if (!current || !currentOrg) return;
    if (!confirm(`Révoquer ${member.email} ? La clé d'organisation sera tournée.`)) return;
    busy = true;
    try {
      // Nouvelle Org Key, re-scellée pour tous les membres restants, items ré-enveloppés.
      const { org: newOrg } = createOrg(account);
      const newMembers = members
        .filter((m) => m.userId !== member.userId && m.publicKey)
        .map((m) => ({
          userId: m.userId,
          encryptedOrgKey: sealOrgKeyForMember(account, newOrg, m.publicKey!),
        }));
      const allItems = (await api.listOrgItems(token, current.orgId)).items;
      const newItems = allItems.map((it) => ({
        id: it.id,
        encryptedKey: rewrapOrgItem(newOrg, currentOrg!, it.encryptedKey, it.encryptedData),
      }));
      await api.rotateOrg(token, current.orgId, {
        revokeUserId: member.userId,
        members: newMembers,
        items: newItems,
      });
      currentOrg = newOrg;
      members = (await api.listMembers(token, current.orgId)).members;
      if (selectedCollection) await selectCollection(selectedCollection);
    } catch (err) {
      fail(err);
    } finally {
      busy = false;
    }
  }

  async function addCollection(e: SubmitEvent) {
    e.preventDefault();
    if (!current) return;
    busy = true;
    try {
      await api.createCollection(token, current.orgId, { name: newCollName });
      newCollName = "";
      collections = (await api.listCollections(token, current.orgId)).collections;
    } catch (err) {
      fail(err);
    } finally {
      busy = false;
    }
  }

  async function selectCollection(c: Collection) {
    if (!current || !currentOrg) return;
    selectedCollection = c;
    pane = "collection";
    revealed = new Set();
    try {
      const dtos = (await api.listCollectionItems(token, current.orgId, c.id)).items;
      items = dtos.map((d) => decryptOrgItem(currentOrg!, d.encryptedKey, d.encryptedData));
    } catch (err) {
      fail(err);
    }
  }

  async function grantAccess(e: SubmitEvent) {
    e.preventDefault();
    if (!current || !selectedCollection || !grantUserId) return;
    busy = true;
    try {
      await api.grantCollectionAccess(token, current.orgId, selectedCollection.id, {
        userId: grantUserId,
        permission: grantPermission,
      });
      grantUserId = "";
    } catch (err) {
      fail(err);
    } finally {
      busy = false;
    }
  }

  async function addItem(e: SubmitEvent) {
    e.preventDefault();
    if (!current || !currentOrg || !selectedCollection) return;
    busy = true;
    try {
      const enc = encryptOrgLogin(currentOrg, {
        name: itemName,
        username: itemUsername,
        password: itemPassword,
        url: itemUrl,
      });
      await api.createOrgItem(token, current.orgId, selectedCollection.id, enc);
      itemName = "";
      itemUsername = "";
      itemPassword = "";
      itemUrl = "";
      await selectCollection(selectedCollection);
    } catch (err) {
      fail(err);
    } finally {
      busy = false;
    }
  }
</script>

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
{#snippet orgIcon()}
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <path d="M3 21h18" /><path d="M5 21V7l8-4v18" /><path d="M19 21V11l-6-4" />
  </svg>
{/snippet}
{#snippet folderIcon()}
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
  </svg>
{/snippet}
{#snippet membersIcon()}
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="9" cy="8" r="3.2" /><path d="M3.5 20a5.5 5.5 0 0 1 11 0" /><path d="M16 5.2a3.2 3.2 0 0 1 0 5.6" /><path d="M17.5 14.5a5.5 5.5 0 0 1 3 5" />
  </svg>
{/snippet}

{#snippet itemAvatar(name: string, url: string)}
  <span class="avatar">
    {(name || "?").charAt(0).toUpperCase()}
    {#if faviconUrl(url)}
      <img class="avatar-img" src={faviconUrl(url)} alt="" loading="lazy" onerror={(e) => ((e.currentTarget as HTMLImageElement).style.display = "none")} />
    {/if}
  </span>
{/snippet}

{#snippet secretRow(item: DecryptedItem, i: number)}
  <li>
    {@render itemAvatar(item.name, item.url)}
    <div class="row-main">
      <span class="row-title">{item.name}</span>
      <span class="row-sub">
        {#if item.username}
          <span class="mono">{item.username}</span>
          <button class="icon-btn {copiedKey === `user-${i}` ? 'copied' : ''}" title="Copier l'identifiant" aria-label="Copier l'identifiant" onclick={() => copy(item.username, `user-${i}`)}>
            {#if copiedKey === `user-${i}`}{@render checkIcon()}{:else}{@render copyIcon()}{/if}
          </button>
        {:else}<span class="muted">—</span>{/if}
      </span>
    </div>
    <span class="mono dots">{revealed.has(i) ? item.password : "••••••••••"}</span>
    <div class="row-actions">
      <button class="icon-btn" title={revealed.has(i) ? "Masquer" : "Afficher"} aria-label="Afficher/masquer" onclick={() => toggleReveal(i)}>
        {#if revealed.has(i)}{@render eyeOffIcon()}{:else}{@render eyeIcon()}{/if}
      </button>
      <button class="icon-btn {copiedKey === `pw-${i}` ? 'copied' : ''}" title="Copier le mot de passe" aria-label="Copier le mot de passe" onclick={() => copy(item.password, `pw-${i}`)}>
        {#if copiedKey === `pw-${i}`}{@render checkIcon()}{:else}{@render copyIcon()}{/if}
      </button>
    </div>
  </li>
{/snippet}

{#if !current}
  <div class="single">
    <section class="panel">
      <div class="panel-head"><h2>Mes organisations</h2><span class="count">{orgs.length}</span></div>
      {#if orgs.length === 0}
        <div class="empty">
          {@render orgIcon()}
          <p>Aucune organisation pour l'instant.<br />Créez-en une pour partager des secrets en équipe.</p>
        </div>
      {:else}
        <ul class="list">
          {#each orgs as o}
            <li>
              <span class="avatar">{(o.name || "?").charAt(0).toUpperCase()}</span>
              <div class="row-main">
                <span class="row-title">{o.name}</span>
                <span class="row-sub"><span class="pill pill-role">{o.role}</span><span class="pill pill-muted">{o.status}</span></span>
              </div>
              <div class="row-actions">
                {#if o.status === "invited"}
                  <button class="ghost sm" onclick={() => accept(o)} disabled={busy}>Accepter l'invitation</button>
                {:else}
                  <button class="ghost sm" onclick={() => open(o)} disabled={busy}>Ouvrir</button>
                {/if}
              </div>
            </li>
          {/each}
        </ul>
      {/if}
    </section>

    <section class="panel">
      <div class="panel-head"><h2>Créer une organisation</h2></div>
      <form onsubmit={submitCreateOrg}>
        <label class="field"><span>Nom de l'organisation</span><input bind:value={newOrgName} placeholder="StackOps Team" required /></label>
        <!-- Le bouton porte lui-même la raison de son inaction. `required` seul
             laissait le navigateur bloquer l'envoi en affichant une bulle
             native : sur Safari iOS elle est fugace, et le geste ressemblait
             alors à un bouton mort. Un contrôle doit dire pourquoi il ne fait
             rien, au moment où on le regarde. -->
        <button type="submit" disabled={busy || !newOrgName.trim()}>
          {busy ? "Création…" : "Créer l'organisation"}
        </button>
        {#if !newOrgName.trim()}
          <p class="hint">Donnez un nom à l'organisation pour pouvoir la créer.</p>
        {/if}
      </form>
    </section>
  </div>
{:else}
  <div class="master">
    <div class="subbar">
      <span class="brand" style="font-size:1.02rem"><span class="mark">{@render orgIcon()}</span>{current.name}</span>
    </div>
    <div class="master-list">
      {#if current.role === "admin"}
        <button class="entry" class:active={pane === "members"} onclick={openMembers}>
          <span class="avatar">{@render membersIcon()}</span>
          <span class="entry-main"><span class="entry-title">Membres</span><span class="entry-sub">{members.length} membre{members.length > 1 ? "s" : ""}</span></span>
        </button>
      {/if}
      <div class="section-label label">Collections</div>
      {#if collections.length === 0}
        <p class="muted" style="padding:0 1rem 0.6rem">Aucune collection.</p>
      {:else}
        {#each collections as c}
          <button class="entry" class:active={pane === "collection" && selectedCollection?.id === c.id} onclick={() => selectCollection(c)}>
            <span class="avatar">{@render folderIcon()}</span>
            <span class="entry-main"><span class="entry-title">{c.name}</span></span>
          </button>
        {/each}
      {/if}
    </div>
    <div style="padding:0.8rem;border-top:1px solid var(--line)">
      <form onsubmit={addCollection}>
        <div style="display:flex;gap:0.5rem">
          <input bind:value={newCollName} placeholder="Nouvelle collection" required />
          <button type="submit" class="icon-add" title="Créer la collection" aria-label="Créer la collection" disabled={busy} style="border:none">+</button>
        </div>
      </form>
      <button class="link" style="align-self:flex-start;margin-top:0.6rem" onclick={back}>← Mes organisations</button>
    </div>
  </div>

  <div class="detail">
    {#if pane === "members" && current.role === "admin"}
      <div class="detail-head">
        <span class="avatar lg">{@render membersIcon()}</span>
        <div><h2>Membres</h2><div class="sub">{members.length} membre{members.length > 1 ? "s" : ""} · accès à l'Org Key</div></div>
      </div>
      <ul class="list">
        {#each members as m}
          <li>
            <span class="avatar">{(m.email ?? "?").charAt(0).toUpperCase()}</span>
            <div class="row-main">
              <span class="row-title">{m.email ?? "—"}</span>
              <span class="row-sub"><span class="pill pill-role">{m.role}</span><span class="pill pill-muted">{m.status}</span></span>
            </div>
            <div class="row-actions"><button class="danger" onclick={() => revoke(m)} disabled={busy}>Révoquer</button></div>
          </li>
        {/each}
      </ul>
      <hr class="sep" />
      <p class="label">Inviter un membre</p>
      <form onsubmit={invite} style="max-width:480px">
        <div class="grid-2">
          <label class="field"><span>Email</span><input type="email" bind:value={inviteEmail} required /></label>
          <label class="field">
            <span>Rôle</span>
            <select bind:value={inviteRole}>
              <option value="member">Membre</option>
              <option value="readonly">Lecture seule</option>
              <option value="admin">Admin</option>
            </select>
          </label>
        </div>
        <button type="submit" disabled={busy}>Inviter</button>
      </form>
    {:else if pane === "collection" && selectedCollection}
      <div class="detail-head">
        <span class="avatar lg">{@render folderIcon()}</span>
        <div><h2>{selectedCollection.name}</h2><div class="sub">{items.length} secret{items.length > 1 ? "s" : ""} partagé{items.length > 1 ? "s" : ""}</div></div>
      </div>
      {#if items.length === 0}
        <div class="empty">{@render folderIcon()}<p>Aucun secret partagé dans cette collection.</p></div>
      {:else}
        <ul class="list">
          {#each items as item, i (i)}
            {@render secretRow(item, i)}
          {/each}
        </ul>
      {/if}
      <hr class="sep" />
      <p class="label">Partager un secret</p>
      <form onsubmit={addItem} style="max-width:480px">
        <label class="field"><span>Nom</span><input bind:value={itemName} placeholder="DB prod" required /></label>
        <label class="field"><span>Site web</span><input bind:value={itemUrl} placeholder="exemple.com" inputmode="url" /></label>
        <div class="grid-2">
          <label class="field"><span>Identifiant</span><input bind:value={itemUsername} placeholder="svc" /></label>
          <label class="field"><span>Mot de passe</span><input type="password" bind:value={itemPassword} placeholder="••••••" /></label>
        </div>
        <button type="submit" disabled={busy}>Chiffrer & partager</button>
      </form>

      {#if current.role === "admin"}
        <hr class="sep" />
        <p class="label">Accès à la collection</p>
        <form onsubmit={grantAccess} style="max-width:480px">
          <div class="grid-2">
            <label class="field">
              <span>Membre</span>
              <select bind:value={grantUserId}>
                <option value="" disabled>Choisir un membre…</option>
                {#each members as m}<option value={m.userId}>{m.email}</option>{/each}
              </select>
            </label>
            <label class="field">
              <span>Permission</span>
              <select bind:value={grantPermission}>
                <option value="read">Lecture</option>
                <option value="write">Écriture</option>
                <option value="manage">Gestion</option>
              </select>
            </label>
          </div>
          <button type="submit" disabled={busy}>Accorder l'accès</button>
        </form>
      {/if}
    {:else}
      <div class="detail-empty">
        <div>
          {@render folderIcon()}
          <p class="muted" style="margin-top:.6rem">Sélectionnez une collection{current.role === "admin" ? " ou les membres" : ""}<br />dans la colonne de gauche.</p>
        </div>
      </div>
    {/if}
  </div>
{/if}
