<script lang="ts">
  import type { AppConfig } from '$shared/types';
  import { appIconUrl } from '$lib/store.svelte';
  let { app = null, src = null, name = '', size = 56, vt = '' }: { app?: AppConfig | null; src?: string | null; name?: string; size?: number; vt?: string } = $props();
  let url = $state<string | null>(null);
  let loaded = $state(false);
  let failed = $state(false);
  $effect(() => {
    loaded = false;
    failed = false;
    if (src) url = src;
    else if (app) appIconUrl(app).then((u) => (url = u));
    else url = null;
  });
  const label = $derived(app ? app.customize?.name || app.name : name);
  const hue = $derived([...label].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 17));
</script>

<span class="tile" style="width:{size}px;height:{size}px;--h:{hue};{vt ? `view-transition-name:${vt}` : ''}">
  {#if url && !failed}
    <img src={url} alt="" class:loaded onload={() => (loaded = true)} onerror={() => (failed = true)} />
  {/if}
  {#if !url || failed || !loaded}
    <span class="mono-glyph" style="font-size:{size * 0.42}px">{label.slice(0, 1).toUpperCase() || '?'}</span>
  {/if}
</span>

<style>
  .tile {
    position: relative;
    display: inline-grid;
    place-items: center;
    flex: 0 0 auto;
    border-radius: 24%;
    overflow: hidden;
    background: linear-gradient(145deg, hsl(var(--h) 45% 82%), hsl(calc(var(--h) + 30) 40% 70%));
    box-shadow: var(--shadow-1), inset 0 0 0 1px rgba(0, 0, 0, 0.04);
  }
  img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    opacity: 0;
    transform: scale(1.08);
    transition: opacity 0.4s var(--ease), transform 0.6s var(--ease-out);
  }
  img.loaded {
    opacity: 1;
    transform: none;
  }
  .mono-glyph {
    font-weight: 800;
    color: hsl(var(--h) 35% 30%);
  }
</style>
