<script lang="ts">
  import type { Account } from "ghostpass-crypto-wasm";
  import { api } from "./lib/api.js";
  import {
    createOrg,
    decryptOrgItem,
    encryptOrgLogin,
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

  // Formulaires.
  let newOrgName = $state("");
  let inviteEmail = $state("");
  let inviteRole = $state("member");
  let newCollName = $state("");
  let itemName = $state("");
  let itemUsername = $state("");
  let itemPassword = $state("");
  let grantUserId = $state("");
  let grantPermission = $state("read");

  function fail(err: unknown) {
    onError(err instanceof Error ? err.message : String(err));
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
    loadOrgs();
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
      });
      await api.createOrgItem(token, current.orgId, selectedCollection.id, enc);
      itemName = "";
      itemUsername = "";
      itemPassword = "";
      await selectCollection(selectedCollection);
    } catch (err) {
      fail(err);
    } finally {
      busy = false;
    }
  }
</script>

<section>
  {#if !current}
    <h2>Mes organisations</h2>
    {#if orgs.length === 0}
      <p class="muted">Aucune organisation pour l'instant.</p>
    {:else}
      <ul>
        {#each orgs as o}
          <li>
            <strong>{o.name}</strong>
            <span class="muted">{o.role} · {o.status}</span>
            {#if o.status === "invited"}
              <button class="ghost" onclick={() => accept(o)} disabled={busy}>Accepter</button>
            {:else}
              <button class="ghost" onclick={() => open(o)} disabled={busy}>Ouvrir</button>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}

    <h2>Créer une organisation</h2>
    <form onsubmit={submitCreateOrg}>
      <label>Nom<input bind:value={newOrgName} placeholder="StackOps Team" required /></label>
      <button type="submit" disabled={busy}>Créer</button>
    </form>
  {:else}
    <div class="bar">
      <strong>{current.name}</strong>
      <button class="ghost" onclick={back}>← Mes organisations</button>
    </div>

    {#if current.role === "admin"}
      <h2>Membres</h2>
      <ul>
        {#each members as m}
          <li>
            <span>{m.email}</span>
            <span class="muted">{m.role} · {m.status}</span>
            <button class="ghost" onclick={() => revoke(m)} disabled={busy}>Révoquer</button>
          </li>
        {/each}
      </ul>
      <form onsubmit={invite}>
        <label>Inviter (email)<input type="email" bind:value={inviteEmail} required /></label>
        <label>
          Rôle
          <select bind:value={inviteRole}>
            <option value="member">Membre</option>
            <option value="readonly">Lecture seule</option>
            <option value="admin">Admin</option>
          </select>
        </label>
        <button type="submit" disabled={busy}>Inviter</button>
      </form>
    {/if}

    <h2>Collections</h2>
    <ul>
      {#each collections as c}
        <li>
          <button class="link" onclick={() => selectCollection(c)}>{c.name}</button>
        </li>
      {/each}
    </ul>
    <form onsubmit={addCollection}>
      <label>Nouvelle collection<input bind:value={newCollName} placeholder="Infra" required /></label>
      <button type="submit" disabled={busy}>Créer</button>
    </form>

    {#if selectedCollection}
      <h2>Secrets — {selectedCollection.name} ({items.length})</h2>
      {#if items.length === 0}
        <p class="muted">Aucun secret partagé.</p>
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
      <form onsubmit={addItem}>
        <label>Nom<input bind:value={itemName} placeholder="DB prod" required /></label>
        <label>Identifiant<input bind:value={itemUsername} placeholder="svc" /></label>
        <label>Mot de passe<input bind:value={itemPassword} placeholder="••••••" /></label>
        <button type="submit" disabled={busy}>Partager</button>
      </form>

      {#if current.role === "admin"}
        <h2>Accès à la collection</h2>
        <form onsubmit={grantAccess}>
          <label>
            Membre
            <select bind:value={grantUserId}>
              <option value="" disabled>Choisir un membre…</option>
              {#each members as m}
                <option value={m.userId}>{m.email}</option>
              {/each}
            </select>
          </label>
          <label>
            Permission
            <select bind:value={grantPermission}>
              <option value="read">Lecture</option>
              <option value="write">Écriture</option>
              <option value="manage">Gestion</option>
            </select>
          </label>
          <button type="submit" disabled={busy}>Accorder l'accès</button>
        </form>
      {/if}
    {/if}
  {/if}
</section>
