<script lang="ts">
  import { onMount } from 'svelte';
  import { slide } from 'svelte/transition';
  import Icon from '$c/Icon.svelte';
  import Hero from '$c/Hero.svelte';
  import Dialog from '$c/Dialog.svelte';
  import { data, patchSources, loadIndex, saveConfig, checkUpdates } from '$lib/store.svelte';
  import type { PatchToolId, PatchSource } from '$shared/types';
  import { slugify } from '$shared/logic';
  import { ripple, toast, errorToast, timeAgo, tilt } from '$lib/ui.svelte';

  let addOpen = $state(false);
  let form = $state({ name: '', tool: 'revanced' as PatchToolId, url: '' });
  let busy = $state(false);
  const sources = $derived(patchSources());
  onMount(() => sources.forEach((s) => loadIndex(s)));
  const toolLabel = { revanced: 'ReVanced', morphe: 'Morphe', lspatch: 'LSPatch' };
  const usedBy = (s: PatchSource) => (data.config?.apps || []).filter((a) => a.tool === s.tool && (a.patchSourceId === s.id || (!a.patchSourceId && s.builtin)));

  async function add() {
    busy = true;
    try {
      const id = `${slugify(form.name)}-${Date.now().toString(36).slice(-4)}`;
      await saveConfig((c) => c.patchSources.push({ id, name: form.name, tool: form.tool, url: form.url.trim() }), `relevance: add patch source ${form.name}`);
      delete data.indexes[id];
      loadIndex({ id, name: form.name, tool: form.tool, url: form.url });
      await checkUpdates().catch(() => {});
      toast('Added — indexing its patches in your GitHub Actions', 'success');
      addOpen = false;
      form = { name: '', tool: 'revanced', url: '' };
    } catch (e) {
      errorToast(e);
    }
    busy = false;
  }
  async function remove(s: PatchSource) {
    if (usedBy(s).length) return toast(`Used by ${usedBy(s).length} app(s) — switch them first`, 'error');
    try {
      await saveConfig((c) => (c.patchSources = c.patchSources.filter((x) => x.id !== s.id)), `relevance: remove patch source ${s.name}`, [{ path: `.relevance/index/${s.id}.json`, content: null }]);
      toast('Removed', 'success');
    } catch (e) {
      errorToast(e);
    }
  }
</script>

<Hero title="Patches" subtitle="The patch ecosystems your apps draw from. Add your own repositories anytime." art="repos" artWidth={420} compact>
  <button class="btn terra" onclick={() => (addOpen = true)} use:ripple><Icon name="add" /> Add patch repository</button>
</Hero>

<div class="grid">
  {#each sources as s, i (s.id)}
    {@const idx = data.indexes[s.id]}
    <article class="card pad src {s.tool}" style="--i:{i}" use:tilt={3}>
      <div class="top">
        <span class="ic"><Icon name={s.tool === 'lspatch' ? 'extension' : s.tool === 'morphe' ? 'deployed_code' : 'play_arrow'} fill /></span>
        <div class="grow">
          <h3 class="title">{s.name}</h3>
          <span class="muted small">{toolLabel[s.tool]}{s.builtin ? ' · built in' : ' · custom'}</span>
        </div>
        {#if !s.builtin}<button class="icon-btn" aria-label="Remove" onclick={() => remove(s)}><Icon name="delete" /></button>{/if}
      </div>
      <a class="mono small url" href={s.url} target="_blank" rel="noreferrer">{s.url.replace(/^https?:\/\//, '')}</a>
      <div class="stats">
        {#if s.id in data.indexes}
          {#if idx}
            <span><b class="mono">{idx.patches.length}</b> {s.tool === 'lspatch' ? 'modules' : 'patches'}</span>
            <span class="tag mono">{idx.version}</span>
            <span class="muted small">indexed {timeAgo(idx.fetchedAt)}</span>
          {:else}
            <span class="muted small">{s.builtin ? 'Index not available yet' : 'Waiting for your Actions to index it (runs with the update check)'}</span>
          {/if}
        {:else}
          <span class="skel" style="height:22px;width:60%"></span>
        {/if}
      </div>
      <div class="used muted small">Used by {usedBy(s).length} app{usedBy(s).length === 1 ? '' : 's'}</div>
    </article>
  {/each}
</div>

<section class="card pad info">
  <h3 class="section-title"><Icon name="info" /> How patching works</h3>
  <ul>
    <li><b>ReVanced</b> and <b>Morphe</b> patch bundles are applied with their official CLIs. Custom repositories can be GitHub or GitLab projects publishing .rvp/.mpp files in releases.</li>
    <li><b>LSPatch</b> embeds Xposed modules into the APK so they work without root. Modules come from the LSPosed module repository or any GitHub repository with APK releases.</li>
    <li>Each app uses exactly one tool. Relevance picks the newest app version all selected patches support.</li>
  </ul>
</section>

<Dialog bind:open={addOpen} title="Add a patch repository" icon="extension">
  <div class="stack">
    <label class="field"><span class="label">Name</span><input class="input" bind:value={form.name} placeholder="My patches" /></label>
    <div class="field">
      <span class="label">Tool</span>
      <div class="seg">
        {#each ['revanced', 'morphe', 'lspatch'] as t}
          <button class:on={form.tool === t} onclick={() => (form.tool = t as PatchToolId)}>{toolLabel[t as PatchToolId]}</button>
        {/each}
      </div>
    </div>
    <label class="field">
      <span class="label">Repository or bundle URL</span>
      <input class="input mono" bind:value={form.url} placeholder="https://github.com/owner/patches" />
    </label>
    <p class="hint"><Icon name="info" size={16} />{form.tool === 'lspatch' ? 'For modules, add them per app as custom modules instead — this keeps a reusable list.' : 'Relevance reads patches-list.json when the repository has one; otherwise your Actions index the bundle with the CLI.'}</p>
  </div>
  {#snippet actions()}
    <button class="btn soft" onclick={() => (addOpen = false)}>Cancel</button>
    <button class="btn" disabled={busy || !form.name || !/^https:\/\//.test(form.url)} onclick={add}>{busy ? 'Adding…' : 'Add'}</button>
  {/snippet}
</Dialog>

<style>
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(290px, 1fr));
    gap: 16px;
  }
  .src {
    display: grid;
    gap: 10px;
    animation: rise 0.5s var(--ease-out) both;
    animation-delay: calc(var(--i) * 60ms);
  }
  .top {
    display: flex;
    gap: 12px;
    align-items: center;
  }
  .grow {
    flex: 1;
    min-width: 0;
  }
  .ic {
    width: 48px;
    height: 48px;
    border-radius: 16px;
    display: grid;
    place-items: center;
    background: var(--olive);
    color: var(--on-olive);
  }
  .morphe .ic {
    background: var(--terra);
    color: var(--on-terra);
  }
  .lspatch .ic {
    background: var(--plum);
    color: var(--surface);
  }
  .url {
    color: var(--muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .stats {
    display: flex;
    gap: 10px;
    align-items: center;
    flex-wrap: wrap;
  }
  .stats b {
    font-size: 1.3rem;
  }
  .info {
    margin-top: 20px;
  }
  .info li {
    margin: 6px 0;
  }
  .seg {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 4px;
    padding: 4px;
    border-radius: 14px;
    background: var(--container);
  }
  .seg button {
    border: 0;
    background: none;
    padding: 9px;
    border-radius: 10px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.25s;
  }
  .seg button.on {
    background: var(--surface);
    box-shadow: var(--shadow-1);
  }
</style>
