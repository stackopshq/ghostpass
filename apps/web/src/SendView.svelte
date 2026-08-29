<script lang="ts">
  import { t } from "./lib/i18n.svelte.js";
  import { onMount } from "svelte";
  import { api } from "./lib/api.js";
  import { openSend } from "./lib/send.js";

  let status = $state<"loading" | "ok" | "error">("loading");
  let secret = $state("");
  let revealed = $state(false);
  let copied = $state(false);

  onMount(async () => {
    try {
      const id = decodeURIComponent(location.pathname.replace(/^\/s\//, ""));
      const keyFragment = location.hash.replace(/^#/, "");
      if (!id || !keyFragment) throw new Error("lien incomplet");
      const { ciphertext, iv } = await api.getSend(id);
      secret = await openSend(ciphertext, iv, keyFragment);
      status = "ok";
    } catch {
      status = "error";
    }
  });

  async function copy() {
    try {
      await navigator.clipboard.writeText(secret);
      copied = true;
      setTimeout(() => (copied = false), 1200);
    } catch {
      /* presse-papiers indisponible */
    }
  }
</script>

<main style="min-height:100vh;display:grid;place-items:center;padding:2rem 1rem">
  <div class="panel" style="width:100%;max-width:440px">
    <span class="brand" style="font-size:var(--text-xl)">
      <span class="mark">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="4" y="10.5" width="16" height="10.5" rx="2" /><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" />
        </svg>
      </span>GhostPass
    </span>

    {#if status === "loading"}
      <p class="muted" style="margin-top:1.2rem">{t("send.decrypting")}</p>
    {:else if status === "error"}
      <div class="callout warn" style="margin-top:1.2rem">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4" /><path d="M12 17h.01" /><circle cx="12" cy="12" r="9" /></svg>
        <span>{t("send.invalid")}</span>
      </div>
    {:else}
      <p class="muted" style="margin:1.2rem 0 0.6rem">{t("send.intro")}</p>
      <div class="kv">
        <div class="kv-row">
          <span class="kv-value" class:dots={!revealed} style="white-space:pre-wrap">{revealed ? secret : "••••••••••••"}</span>
          <span class="kv-actions">
            <button class="icon-btn" title={revealed ? t("send.hide") : t("send.show")} aria-label={t("send.toggleReveal")} onclick={() => (revealed = !revealed)}>
              {#if revealed}
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.9 4.2A10.9 10.9 0 0 1 12 4c6.5 0 10 7 10 7a18.5 18.5 0 0 1-3 3.6" /><path d="M6.1 6.1C3.3 7.8 2 11 2 11s3.5 7 10 7a10.9 10.9 0 0 0 3.1-.5" /><path d="m2 2 20 20" /><path d="M9.6 9.6a3 3 0 0 0 4.2 4.2" /></svg>
              {:else}
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" /></svg>
              {/if}
            </button>
            <button class="icon-btn {copied ? 'copied' : ''}" title={t("send.copy")} aria-label={t("send.copy")} onclick={copy}>
              {#if copied}
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
              {:else}
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></svg>
              {/if}
            </button>
          </span>
        </div>
      </div>
      <p class="muted" style="margin-top:0.8rem">{t("send.local")}</p>
    {/if}
  </div>
</main>
