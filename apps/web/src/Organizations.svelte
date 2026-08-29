<script lang="ts">
  import type { Account } from "ghostpass-crypto-wasm";
  import { api } from "./lib/api.js";
  import { t } from "./lib/i18n.svelte.js";
  import { generateOtp, parseOtp } from "./lib/totp.js";
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
  // L'identifiant serveur etait jete au dechiffrement. Sans lui aucune mise a
  // jour n'etait possible : c'est la raison de fond pour laquelle un mot de
  // passe d'organisation ne pouvait plus etre corrige une fois enregistre.
  let items = $state<Array<DecryptedItem & { itemId: string }>>([]);
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
  let itemNotes = $state("");
  let itemTotp = $state("");
  // Un champ de mot de passe se saisit masque ; l'oeil sert a le montrer.
  let showItemPassword = $state(false);
  // Non nul : le formulaire met a jour cet element au lieu d'en creer un.
  let editingId = $state<string | null>(null);
  let grantUserId = $state("");
  let grantPermission = $state("read");

  // Suppression d'organisation : cible en cours de confirmation, nom saisi, et dernier refus
  // du serveur. `deleteError` est distinct du toast global : un 409 « il reste 3 collections »
  // doit rester lisible SOUS le contrôle, à l'endroit où on vient de cliquer.
  let deleteTarget = $state<OrgSummary | null>(null);
  let deleteConfirmName = $state("");
  let deleteError = $state<string | null>(null);

  // État d'affichage (UI uniquement).
  let revealed = $state<Set<number>>(new Set());
  // Qui a un acces explicite a la collection ouverte.
  // L'accès EFFECTIF, pas les seules lignes de `collection_access` : un admin
  // d'org et un membre de groupe entrent sans qu'aucune ligne n'existe. Voir le
  // commentaire du GET côté serveur.
  let access = $state<Array<{
    userId: string;
    email: string | null;
    permission: string;
    sources: Array<{ kind: string; label: string; permission: string }>;
    revocable: boolean;
  }>>([]);
  // Codes TOTP du moment, indexes par rang de ligne.
  let otpCodes = $state<Record<number, string>>({});
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

  function askDelete(org: OrgSummary) {
    deleteTarget = org;
    deleteConfirmName = "";
    deleteError = null;
  }

  function cancelDelete() {
    deleteTarget = null;
    deleteConfirmName = "";
    deleteError = null;
  }

  async function confirmDelete(e: SubmitEvent) {
    e.preventDefault();
    const target = deleteTarget;
    if (!target || deleteConfirmName.trim() !== target.name) return;
    busy = true;
    deleteError = null;
    try {
      await api.deleteOrg(token, target.orgId);
      deleteTarget = null;
      deleteConfirmName = "";
      await loadOrgs();
    } catch (err) {
      // Le serveur refuse pour une raison précise (403, 404, 409 avec décomptes). On la garde
      // affichée et le panneau ouvert : avaler ce message ferait passer une garantie pour un
      // bouton mort. Le toast global double l'information, il ne la remplace pas.
      const message = err instanceof Error ? err.message : String(err);
      deleteError = message;
      onError(message);
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
      // On conserve `d.id` : c'est lui qui rend la modification possible.
      items = dtos.map((d) => ({
        ...decryptOrgItem(currentOrg!, d.encryptedKey, d.encryptedData),
        itemId: d.id,
      }));
      resetItemForm();
      await loadAccess();
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
      // Relire tout de suite : un octroi qui ne se voit pas est indiscernable
      // d'un octroi qui a echoue.
      await loadAccess();
    } catch (err) {
      fail(err);
    } finally {
      busy = false;
    }
  }

  /// Vide le formulaire et sort du mode modification.
  function resetItemForm() {
    itemName = "";
    itemUsername = "";
    itemPassword = "";
    itemUrl = "";
    itemNotes = "";
    itemTotp = "";
    showItemPassword = false;
    editingId = null;
  }

  /// Charge le formulaire depuis un element existant pour le corriger.
  function startEditItem(item: DecryptedItem & { itemId: string }) {
    editingId = item.itemId;
    itemName = item.name;
    itemUsername = item.username;
    itemPassword = item.password;
    itemUrl = item.url;
    itemNotes = item.note ?? "";
    itemTotp = item.totp ?? "";
    showItemPassword = false;
  }

  /// Cree, ou met a jour si le formulaire est en mode modification. Les champs
  /// `notes` et `totp` etaient absents de l'appel : encryptOrgLogin les portait
  /// deja, mais personne ne les lui passait.
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
        notes: itemNotes,
        totp: itemTotp,
      });
      if (editingId) {
        await api.updateOrgItem(token, current.orgId, selectedCollection.id, editingId, enc);
      } else {
        await api.createOrgItem(token, current.orgId, selectedCollection.id, enc);
      }
      await selectCollection(selectedCollection);
    } catch (err) {
      fail(err);
    } finally {
      busy = false;
    }
  }

  /// Qui a acces a la collection ouverte. Reserve aux administrateurs cote
  /// serveur : on avale le refus plutot que d'alarmer un membre simple.
  async function loadAccess() {
    if (!current || !selectedCollection) return;
    try {
      access = (await api.listCollectionAccess(token, current.orgId, selectedCollection.id)).access;
    } catch {
      access = [];
    }
  }

  async function revokeAccess(userId: string) {
    if (!current || !selectedCollection) return;
    busy = true;
    try {
      await api.revokeCollectionAccess(token, current.orgId, selectedCollection.id, userId);
      await loadAccess();
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

{#snippet secretRow(item: DecryptedItem & { itemId: string }, i: number)}
  <li>
    {@render itemAvatar(item.name, item.url)}
    <div class="row-main">
      <span class="row-title">{item.name}</span>
      <span class="row-sub">
        {#if item.username}
          <span class="mono">{item.username}</span>
          <button class="icon-btn {copiedKey === `user-${i}` ? 'copied' : ''}" title={t("org.copyUsername")} aria-label={t("org.copyUsername")} onclick={() => copy(item.username, `user-${i}`)}>
            {#if copiedKey === `user-${i}`}{@render checkIcon()}{:else}{@render copyIcon()}{/if}
          </button>
        {:else}<span class="muted">{t("org.noUsername")}</span>{/if}
        <!-- L'URL etait saisie et chiffree, mais jamais rendue : elle ne
             servait qu'a choisir le favicon, donc renseigner le champ n'avait
             aucun effet visible. -->
        {#if item.url}
          <span class="muted">·</span>
          <a href={item.url.startsWith("http") ? item.url : `https://${item.url}`}
             target="_blank" rel="noopener noreferrer" class="muted">{item.url}</a>
        {/if}
        {#if otpCodes[i]}
          <span class="muted">·</span>
          <span class="mono">{otpCodes[i]}</span>
          <button class="icon-btn {copiedKey === `otp-${i}` ? 'copied' : ''}" title={t("org.copyTotp")} aria-label={t("org.copyTotp")} onclick={() => copy(otpCodes[i], `otp-${i}`)}>
            {#if copiedKey === `otp-${i}`}{@render checkIcon()}{:else}{@render copyIcon()}{/if}
          </button>
        {/if}
      </span>
      {#if item.note}
        <span class="row-sub muted" style="white-space:pre-wrap">{item.note}</span>
      {/if}
    </div>
    <span class="mono dots">{revealed.has(i) ? item.password : "••••••••••"}</span>
    <div class="row-actions">
      <button class="icon-btn" title={revealed.has(i) ? t("org.hide") : t("org.show")} aria-label={t("org.toggleReveal")} onclick={() => toggleReveal(i)}>
        {#if revealed.has(i)}{@render eyeOffIcon()}{:else}{@render eyeIcon()}{/if}
      </button>
      <button class="icon-btn {copiedKey === `pw-${i}` ? 'copied' : ''}" title={t("org.copyPassword")} aria-label={t("org.copyPassword")} onclick={() => copy(item.password, `pw-${i}`)}>
        {#if copiedKey === `pw-${i}`}{@render checkIcon()}{:else}{@render copyIcon()}{/if}
      </button>
      <button class="ghost sm" onclick={() => startEditItem(item)}>{t("org.edit")}</button>
    </div>
  </li>
{/snippet}

{#if !current}
  <div class="single">
    <section class="panel">
      <div class="panel-head"><h2>{t("org.myOrgs")}</h2><span class="count">{orgs.length}</span></div>
      {#if orgs.length === 0}
        <div class="empty">
          {@render orgIcon()}
          <p>{t("org.noOrgs")}<br />{t("org.noOrgsSub")}</p>
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
                  <button class="ghost sm" onclick={() => accept(o)} disabled={busy}>{t("org.accept")}</button>
                {:else}
                  <button class="ghost sm" onclick={() => open(o)} disabled={busy}>{t("org.open")}</button>
                  {#if o.role === "admin"}
                    <button class="danger" onclick={() => askDelete(o)} disabled={busy}>{t("org.delete")}</button>
                  {/if}
                {/if}
              </div>
            </li>
            {#if deleteTarget?.orgId === o.orgId}
              <li class="confirm-delete">
                <form onsubmit={confirmDelete}>
                  <p class="confirm-title">Supprimer « {o.name} » définitivement ?</p>
                  <p class="confirm-body">
                    L'organisation, ses membres et ses groupes disparaissent. Ni GhostPass ni
                    personne ne peut les rétablir : le serveur ne détient que des blobs chiffrés.
                    La suppression est refusée tant qu'il reste des collections, des secrets
                    partagés ou d'autres membres actifs. Le coffre partagé créé avec
                    l'organisation ne compte pas tant qu'il est vide : sinon aucune organisation
                    neuve ne serait supprimable.
                  </p>
                  <label class="field">
                    <span>{t("org.confirmName")}</span>
                    <input bind:value={deleteConfirmName} placeholder={o.name} autocomplete="off" />
                  </label>
                  <!-- Le refus du serveur s'affiche ici, sous le bouton qui l'a provoqué, et
                       le panneau reste ouvert. Un 409 « il reste 3 collections » est une
                       information exploitable ; l'escamoter ferait passer la garde pour une panne. -->
                  {#if deleteError}
                    <p class="confirm-error" role="alert">{deleteError}</p>
                  {/if}
                  <div class="confirm-actions">
                    <button type="submit" class="danger" disabled={busy || deleteConfirmName.trim() !== o.name}>
                      {busy ? "Suppression…" : "Supprimer définitivement"}
                    </button>
                    <button type="button" class="ghost sm" onclick={cancelDelete} disabled={busy}>{t("org.cancel")}</button>
                  </div>
                  {#if deleteConfirmName.trim() !== o.name}
                    <p class="hint">Le bouton s'active quand le nom saisi correspond exactement à « {o.name} ».</p>
                  {/if}
                </form>
              </li>
            {/if}
          {/each}
        </ul>
      {/if}
    </section>

    <section class="panel">
      <div class="panel-head"><h2>{t("org.createOrg")}</h2></div>
      <form onsubmit={submitCreateOrg}>
        <label class="field"><span>{t("org.orgName")}</span><input bind:value={newOrgName} placeholder={t("org.orgNamePh")} required /></label>
        <!-- Le bouton porte lui-même la raison de son inaction. `required` seul
             laissait le navigateur bloquer l'envoi en affichant une bulle
             native : sur Safari iOS elle est fugace, et le geste ressemblait
             alors à un bouton mort. Un contrôle doit dire pourquoi il ne fait
             rien, au moment où on le regarde. -->
        <button type="submit" disabled={busy || !newOrgName.trim()}>
          {busy ? "Création…" : "Créer l'organisation"}
        </button>
        {#if !newOrgName.trim()}
          <p class="hint">{t("org.nameRequired")}</p>
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
          <span class="entry-main"><span class="entry-title">{t("org.members")}</span><span class="entry-sub">{t("org.membersCount", { n: members.length })}</span></span>
        </button>
      {/if}
      <div class="section-label label">{t("org.collections")}</div>
      {#if collections.length === 0}
        <p class="muted" style="padding:0 1rem 0.6rem">{t("org.noCollections")}</p>
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
          <input bind:value={newCollName} placeholder={t("org.newCollection")} required />
          <button type="submit" class="icon-add" title={t("org.createCollection")} aria-label={t("org.createCollection")} disabled={busy} style="border:none">+</button>
        </div>
      </form>
      <button class="link" style="align-self:flex-start;margin-top:0.6rem" onclick={back}>{t("org.backToOrgs")}</button>
    </div>
  </div>

  <div class="detail">
    {#if pane === "members" && current.role === "admin"}
      <div class="detail-head">
        <span class="avatar lg">{@render membersIcon()}</span>
        <div><h2>{t("org.members")}</h2><div class="sub">{t("org.membersCount", { n: members.length })}</div></div>
      </div>
      <ul class="list">
        {#each members as m}
          <li>
            <span class="avatar">{(m.email ?? "?").charAt(0).toUpperCase()}</span>
            <div class="row-main">
              <span class="row-title">{m.email ?? t("org.unknownEmail")}</span>
              <span class="row-sub"><span class="pill pill-role">{m.role}</span><span class="pill pill-muted">{m.status}</span></span>
            </div>
            <div class="row-actions"><button class="danger" onclick={() => revoke(m)} disabled={busy}>{t("org.revoke")}</button></div>
          </li>
        {/each}
      </ul>
      <hr class="sep" />
      <p class="label">{t("org.inviteTitle")}</p>
      <form onsubmit={invite} style="max-width:480px">
        <div class="grid-2">
          <label class="field"><span>{t("org.email")}</span><input type="email" bind:value={inviteEmail} required /></label>
          <label class="field">
            <span>{t("org.role")}</span>
            <select bind:value={inviteRole}>
              <option value="member">{t("org.roleMember")}</option>
              <option value="readonly">{t("org.roleReadonly")}</option>
              <option value="admin">{t("org.roleAdmin")}</option>
            </select>
          </label>
        </div>
        <button type="submit" disabled={busy}>{t("org.invite")}</button>
      </form>
    {:else if pane === "collection" && selectedCollection}
      <div class="detail-head">
        <span class="avatar lg">{@render folderIcon()}</span>
        <div><h2>{selectedCollection.name}</h2><div class="sub">{t("org.secretsCount", { n: items.length })}</div></div>
      </div>
      {#if items.length === 0}
        <div class="empty">{@render folderIcon()}<p>{t("org.emptyCollection")}</p></div>
      {:else}
        <ul class="list">
          {#each items as item, i (i)}
            {@render secretRow(item, i)}
          {/each}
        </ul>
      {/if}
      <hr class="sep" />
      <p class="label">{editingId ? t("org.editSecret") : t("org.addSecret")}</p>
      <form onsubmit={addItem} style="max-width:480px">
        <label class="field"><span>{t("org.name")}</span><input bind:value={itemName} placeholder={t("org.namePh")} required /></label>
        <label class="field"><span>{t("org.website")}</span><input bind:value={itemUrl} placeholder={t("org.websitePh")} inputmode="url" /></label>
        <div class="grid-2">
          <label class="field"><span>{t("org.username")}</span><input bind:value={itemUsername} placeholder={t("org.usernamePh")} /></label>
          <div class="field">
            <span>{t("org.password")}</span>
            <div class="input-row">
              <input
                type={showItemPassword ? "text" : "password"}
                bind:value={itemPassword}
                placeholder="••••••"
                autocomplete="off"
                autocapitalize="off"
                spellcheck="false"
              />
              <button
                type="button"
                class="icon-btn"
                title={showItemPassword ? t("org.hide") : t("org.show")}
                aria-label={showItemPassword ? t("org.hidePassword") : t("org.showPassword")}
                onclick={() => (showItemPassword = !showItemPassword)}
              >
                {#if showItemPassword}{@render eyeOffIcon()}{:else}{@render eyeIcon()}{/if}
              </button>
            </div>
          </div>
        </div>
        <label class="field">
          <span>{t("org.totpKey")} <span class="muted" style="font-weight:400">{t("org.totpHint")}</span></span>
          <input bind:value={itemTotp} placeholder="JBSWY3DPEHPK3PXP" autocomplete="off" />
        </label>
        <label class="field">
          <span>{t("org.notes")}</span>
          <textarea bind:value={itemNotes} rows="3" placeholder={t("org.notesPh")}></textarea>
        </label>
        <div style="display:flex;gap:0.5rem;align-items:center">
          <button type="submit" disabled={busy}>
            {editingId ? t("org.save") : t("org.encryptShare")}
          </button>
          {#if editingId}
            <button type="button" class="ghost sm" onclick={resetItemForm}>{t("org.cancel")}</button>
          {/if}
        </div>
      </form>

      {#if current.role === "admin"}
        <hr class="sep" />
        <p class="label">{t("org.accessTitle")}</p>
        <form onsubmit={grantAccess} style="max-width:480px">
          <div class="grid-2">
            <label class="field">
              <span>{t("org.member")}</span>
              <select bind:value={grantUserId}>
                <option value="" disabled>{t("org.pickMember")}</option>
                {#each members as m}<option value={m.userId}>{m.email}</option>{/each}
              </select>
            </label>
            <label class="field">
              <span>{t("org.permission")}</span>
              <select bind:value={grantPermission}>
                <option value="read">{t("org.permRead")}</option>
                <option value="write">{t("org.permWrite")}</option>
                <option value="manage">{t("org.permManage")}</option>
              </select>
            </label>
          </div>
          <button type="submit" disabled={busy}>{t("org.grant")}</button>
        </form>

        {#if access.length === 0}
          <p class="muted" style="margin-top:0.6rem">
            {t("org.accessNone")}
          </p>
        {:else}
          <p class="label" style="margin-top:0.9rem">{t("org.accessWho")}</p>
          <ul class="list">
            {#each access as a (a.userId)}
              <li>
                <span class="avatar">{(a.email ?? "?").charAt(0).toUpperCase()}</span>
                <div class="row-main">
                  <span class="row-title">{a.email ?? t("org.unknownEmail")}</span>
                  <span class="row-sub">
                    <span class="pill pill-role">{a.permission}</span>
                    <!-- D'où vient l'accès. Sans cette mention, un admin
                         apparaît sans qu'on sache pourquoi le bouton
                         « révoquer » ne lui est pas proposé. -->
                    {#each a.sources as src (src.kind + src.label)}
                      <span class="pill">{src.label}</span>
                    {/each}
                  </span>
                </div>
                <div class="row-actions">
                  {#if a.revocable}
                    <button class="danger" onclick={() => revokeAccess(a.userId)} disabled={busy}>
                      {t("org.revoke")}
                    </button>
                  {:else}
                    <!-- Rien à révoquer ici : il n'y a pas de ligne. Un admin
                         se retire en changeant son rôle, un membre de groupe en
                         quittant le groupe. Un bouton qui ne ferait rien serait
                         pire que pas de bouton. -->
                    <span class="muted">{t("org.accessNotRevocable")}</span>
                  {/if}
                </div>
              </li>
            {/each}
          </ul>
        {/if}
      {/if}
    {:else}
      <div class="detail-empty">
        <div>
          {@render folderIcon()}
          <p class="muted" style="margin-top:.6rem">Sélectionnez une collection{current.role === "admin" ? " ou les membres" : ""}<br />{t("org.pickInLeft")}</p>
        </div>
      </div>
    {/if}
  </div>
{/if}
