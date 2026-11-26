<script lang="ts">
  import { onMount } from 'svelte';
  import Icon from './Icon.svelte';
  import Dialog from './Dialog.svelte';
  import ToolLogo from './ToolLogo.svelte';
  import { data, loadIndex, patchSources } from '$lib/store.svelte';
  import type { PatchToolId } from '$shared/types';

  let { onpick }: { onpick: (pkg: string, name: string) => void } = $props();
  let open = $state(false);
  let q = $state('');
  let ready = $state(false);
  onMount(async () => {
    await Promise.all(patchSources().map((s) => loadIndex(s)));
    ready = true;
  });

  interface Row { pkg: string; name?: string; counts: Partial<Record<PatchToolId, number>>; total: number }
  const rows = $derived.by(() => {
    if (!ready) return [] as Row[];
    const map = new Map<string, Row>();
    for (const src of patchSources()) {
      const idx = data.indexes[src.id];
      if (!idx) continue;
      for (const p of idx.patches) {
        for (const c of p.packages || []) {
          const r = map.get(c.packageName) || { pkg: c.packageName, counts: {}, total: 0 };
          r.name ||= c.name;
          r.counts[src.tool] = (r.counts[src.tool] || 0) + 1;
          r.total++;
          map.set(c.packageName, r);
        }
      }
    }
    return [...map.values()].sort((a, b) => b.total - a.total);
  });
  const shown = $derived(rows.filter((r) => !q || `${r.name || ''} ${r.pkg}`.toLowerCase().includes(q.toLowerCase())).slice(0, 300));
  const label: Record<PatchToolId, string> = { revanced: 'ReVanced', morphe: 'Morphe', lspatch: 'LSPatch' };
</script>

<button class="banner" onclick={() => (open = true)} disabled={!ready}>
  <span class="logos"><ToolLogo tool="revanced" size={30} /><ToolLogo tool="morphe" size={30} /><ToolLogo tool="lspatch" size={30} /></span>
  <span class="txt">
    {#if ready}<b>Patches available for {rows.length.toLocaleString()} apps</b>{:else}<b>Gathering patch lists…</b>{/if}
    <span class="muted small">Click to see which apps ReVanced, Morphe and Xposed modules can change</span>
  </span>
  <Icon name="chevron_right" />
</button>

<Dialog bind:open title="Apps with patches" icon="extension" wide>
  <div class="search"><Icon name="search" size={20} /><input class="input" placeholder="Search {rows.length} apps by name or package" bind:value={q} /></div>
  <div class="list">
    {#each shown as r (r.pkg)}
      <div class="row">
        <div class="who">
          <b>{r.name || r.pkg.split('.').slice(-1)[0].replace(/^\w/, (c) => c.toUpperCase())}</b>
          <span class="mono muted small">{r.pkg}</span>
        </div>
        <div class="counts">
          {#each Object.entries(r.counts) as [t, n]}
            <span class="count" title="{n} {t === 'lspatch' ? 'modules' : 'patches'} in {label[t as PatchToolId]}"><ToolLogo tool={t as PatchToolId} size={18} />{n}</span>
          {/each}
        </div>
        <button class="btn sm tonal" onclick={() => { onpick(r.pkg, r.name || r.pkg); open = false; }}>Find on APKPure</button>
      </div>
    {:else}
      <p class="muted">No apps match.</p>
    {/each}
  </div>
</Dialog>

<style>
  .banner {
    display: flex;
    align-items: center;
    gap: 16px;
    width: 100%;
    padding: 14px 18px;
    margin-bottom: 16px;
    border-radius: var(--radius-m);
    border: 1px dashed var(--outline-strong);
    background: color-mix(in srgb, var(--olive-c) 28%, var(--surface));
    text-align: left;
    cursor: pointer;
    transition: background-color 0.25s var(--ease), border-color 0.25s;
  }
  .banner:hover {
    border-color: var(--olive);
    background: color-mix(in srgb, var(--olive-c) 45%, var(--surface));
  }
  .banner:disabled {
    cursor: progress;
  }
  .logos {
    display: flex;
  }
  .logos :global(.tl) {
    margin-left: -8px;
    box-shadow: 0 0 0 2px var(--surface);
  }
  .logos :global(.tl:first-child) {
    margin-left: 0;
  }
  .txt {
    display: grid;
    flex: 1;
  }
  .search {
    position: relative;
    margin-bottom: 12px;
  }
  .search :global(svg) {
    position: absolute;
    left: 12px;
    top: 13px;
    color: var(--muted);
  }
  .search .input {
    padding-left: 40px;
  }
  .list {
    display: grid;
  }
  .row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto auto;
    gap: 14px;
    align-items: center;
    padding: 10px 4px;
    border-bottom: 1px solid var(--outline);
  }
  .who {
    display: grid;
    min-width: 0;
  }
  .who .mono {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .counts {
    display: flex;
    gap: 6px;
  }
  .count {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 3px 8px 3px 3px;
    border-radius: 999px;
    background: var(--container);
    font: 600 0.78rem var(--mono);
  }
  @media (max-width: 600px) {
    .row {
      grid-template-columns: 1fr auto;
    }
    .counts {
      grid-column: 1;
    }
  }
</style>
