<script lang="ts">
  import { LOCALES, getLocale, setLocale } from "./lib/i18n.svelte.js";
</script>

<!-- Deux boutons plutot qu'un menu deroulant : a deux langues, le menu coute
     un clic de plus et cache l'etat courant. Meme forme que ghostcal. -->
<div class="lang-switch">
  {#each LOCALES as l (l.code)}
    <button
      type="button"
      class="lang-btn"
      class:on={getLocale() === l.code}
      aria-pressed={getLocale() === l.code}
      onclick={() => setLocale(l.code)}
    >
      {l.label}
    </button>
  {/each}
</div>

<style>
  .lang-switch {
    display: inline-flex;
    align-items: center;
    gap: 0.15rem;
    font-size: var(--text-2xs);
  }
  .lang-btn {
    background: none;
    border: 0;
    padding: 0.15rem 0.35rem;
    border-radius: 0.35rem;
    color: var(--ink-3);
    cursor: pointer;
    transition: color 0.15s ease;
  }
  .lang-btn:hover {
    color: var(--ink);
  }
  /* La langue active se lit a la couleur d'accent ET a aria-pressed : la
     couleur seule ne dit rien a un lecteur d'ecran. */
  .lang-btn.on {
    color: var(--accent-text);
  }
</style>
