<script lang="ts">
  import { onMount } from 'svelte';
  import { scale } from 'svelte/transition';
  import Icon from '$c/Icon.svelte';
  import Hero from '$c/Hero.svelte';
  import Dialog from '$c/Dialog.svelte';
  import StepNav from '$c/StepNav.svelte';
  import ToolLogo from '$c/ToolLogo.svelte';
  import { draft } from '$lib/draft.svelte';
  import { loadIndex, patchSources, data } from '$lib/store.svelte';
  import { specificPatches, newestSupported, versionsFor } from '$shared/logic';
  import type { PatchToolId, ToolId, PatchDef } from '$shared/types';
  import { ripple, tilt } from '$lib/ui.svelte';

  let { go }: { go: (d: number) => void } = $props();
  const d = draft.d;
  const pkg = d.app.packageName;
  const initialTool = d.app.tool;

  const tools: { id: ToolId; name: string; sub?: string; icon: string; tone: string }[] = [
    { id: 'revanced', name: 'ReVanced', icon: 'play_arrow', tone: 'olive' },
    { id: 'morphe', name: 'Morphe', icon: 'deployed_code', tone: 'terra' },
    { id: 'lspatch', name: 'LSPatch', sub: '(Xposed modules)', icon: 'extension', tone: 'plum' },
    { id: 'none', name: 'No patching', icon: 'eco', tone: 'sand' },
  ];
  let chosenSource = $state<Record<string, string>>({});
  let loading = $state(true);
  let dialogTool = $state<PatchToolId | null>(null);
  let dialogOpen = $state(false);

  const sourcesOf = (t: string) => patchSources().filter((s) => s.tool === t);
  onMount(async () => {
    for (const t of ['revanced', 'morphe', 'lspatch']) {
      const list = sourcesOf(t);
      chosenSource[t] = d.app.tool === t && d.app.patchSourceId ? d.app.patchSourceId : list[0]?.id;
    }
    await Promise.all(patchSources().map((s) => loadIndex(s)));
    loading = false;
  });

  function idx(t: string) {
    return data.indexes[chosenSource[t]] ?? null;
  }
  function list(t: string): PatchDef[] {
    return specificPatches(idx(t), pkg);
  }
  function pick(t: ToolId) {
    if (d.app.tool !== t) {
      d.app.tool = t;
      d.app.patches = [];
      d.app.customPatches = [];
      d.app.pin = null;
    }
    d.app.patchSourceId = t === 'none' ? undefined : chosenSource[t];
  }
  function next() {
    d.app.patchSourceId = d.app.tool === 'none' ? undefined : chosenSource[d.app.tool];
    go(1);
  }
  const dialogList = $derived(dialogTool ? list(dialogTool) : []);
</script>

<Hero title="Choose a patching tool" subtitle="One app uses one tool — you can't mix tools for the same app." art="tool" artWidth={440} compact />

{#if d.editing && initialTool !== d.app.tool}
  <div class="notice"><Icon name="info" />Switching tools starts the patch selection from scratch.</div>
{/if}

<div class="tools">
  {#each tools as t, i}
    {@const on = d.app.tool === t.id}
    <div
      class="tool card {t.tone}"
      class:on
      role="radio"
      aria-checked={on}
      tabindex="0"
      style="--i:{i}"
      onclick={() => pick(t.id)}
      onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && pick(t.id)}
      use:ripple
    >
      {#if on}<span class="check" in:scale={{ duration: 400, start: 0.2 }}><Icon name="check_circle" fill size={26} /></span>{/if}
      <span class="t-ic"><ToolLogo tool={t.id} size={56} /></span>
      <h3 class="t-name">{t.name}</h3>
      {#if t.sub}<div class="muted sub">{t.sub}</div>{/if}
      {#if t.id === 'none'}
        <p class="muted">Just clone it — change name, package and icon. Or pass it on exactly as released.</p>
      {:else}
        {#if sourcesOf(t.id).length > 1}
          <select class="select src" bind:value={chosenSource[t.id]} onclick={(e) => e.stopPropagation()} onchange={() => on && pick(t.id)}>
            {#each sourcesOf(t.id) as s}<option value={s.id}>{s.name}</option>{/each}
          </select>
        {/if}
        {#if loading}
          <span class="skel" style="height:30px;width:70%"></span>
          <span class="skel" style="height:22px;width:55%"></span>
        {:else}
          {@const n = list(t.id).length}
          <span class="count-chip"><b class="mono">{n}</b> {t.id === 'lspatch' ? 'modules' : 'patches'} for this app</span>
          {#if t.id !== 'lspatch' && newestSupported(idx(t.id), pkg)}
            <div class="sup">Supports up to <span class="tag mono">v{newestSupported(idx(t.id), pkg)}</span></div>
          {:else if n === 0}
            <div class="muted small">You can add custom patches.</div>
          {:else}
            <div class="muted small">Works with any version.</div>
          {/if}
          {#if idx(t.id) === null}<div class="muted small">Patch list unavailable right now.</div>{/if}
          <button class="see" onclick={(e) => { e.stopPropagation(); dialogTool = t.id as PatchToolId; dialogOpen = true; }}>
            See available {t.id === 'lspatch' ? 'modules' : 'patches'} <Icon name="chevron_right" size={18} />
          </button>
        {/if}
      {/if}
    </div>
  {/each}
</div>

<Dialog bind:open={dialogOpen} title="{tools.find((t) => t.id === dialogTool)?.name} · {dialogList.length} for this app" icon="extension" wide>
  {#if !dialogList.length}
    <div class="empty"><img src="/art/empty.webp" alt="" class="art" /><p class="muted">Nothing specific to <span class="mono">{pkg}</span> yet. You can still add custom patches or modules.</p></div>
  {/if}
  <div class="plist">
    {#each dialogList as p, i}
      {@const v = versionsFor(p, pkg)}
      <div class="pitem" style="animation-delay:{Math.min(i, 20) * 25}ms">
        <div class="pn">{p.name}{#if p.default === false}<span class="tag">off by default</span>{/if}</div>
        {#if p.description}<div class="muted small">{p.description}</div>{/if}
        {#if v}<div class="vers">{#each v.slice(0, 6) as x}<span class="tag mono">{x}</span>{/each}{#if v.length > 6}<span class="tag">+{v.length - 6}</span>{/if}</div>{/if}
      </div>
    {/each}
  </div>
</Dialog>

<StepNav {go} onnext={next} />

<style>
  .tools {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 14px;
    margin-top: 6px;
  }
  .tool {
    position: relative;
    display: grid;
    gap: 10px;
    align-content: start;
    padding: 20px;
    cursor: pointer;
    border: 2px solid var(--outline);
    overflow: hidden;
    isolation: isolate;
    animation: rise 0.6s var(--ease-out) both;
    animation-delay: calc(var(--i) * 70ms);
    transition:
      border-color 0.3s,
      box-shadow 0.3s,
      background-color 0.3s,
      transform 0.4s var(--ease-out);
    min-height: 260px;
  }
  .tool:hover {
    box-shadow: var(--shadow-2);
  }
  .tool.on {
    border-color: var(--olive);
    box-shadow: var(--shadow-2), 0 0 0 4px color-mix(in srgb, var(--olive) 15%, transparent);
    background: color-mix(in srgb, var(--olive-c) 22%, var(--surface));
  }
  .check {
    position: absolute;
    top: 14px;
    right: 14px;
    color: var(--olive);
  }
  .t-ic {
    width: 56px;
    height: 56px;
    border-radius: 26%;
    display: grid;
    place-items: center;
    overflow: hidden;
    box-shadow: var(--shadow-1);
    transition: transform 0.5s var(--ease-spring);
  }
  .tool:hover .t-ic {
    transform: scale(1.04);
  }
  .t-name {
    font-size: 1.55rem;
    font-weight: 900;
  }
  .sub {
    margin-top: -8px;
  }
  .count-chip {
    justify-self: start;
    padding: 5px 12px;
    border-radius: 12px;
    background: var(--amber-c);
    color: var(--on-amber-c);
  }
  .terra .count-chip {
    background: var(--terra-c);
    color: var(--on-terra-c);
  }
  .plum .count-chip {
    background: var(--plum-c);
  }
  .count-chip b {
    font-size: 1.1rem;
  }
  .sup {
    display: flex;
    gap: 8px;
    align-items: center;
    font-size: 0.92rem;
  }
  .src {
    min-height: 38px;
    padding: 6px 10px;
  }
  .see {
    justify-self: start;
    display: inline-flex;
    gap: 4px;
    align-items: center;
    border: 0;
    background: none;
    padding: 4px 0;
    font-weight: 600;
    color: var(--olive-text);
    cursor: pointer;
  }
  .terra .see {
    color: var(--terra);
  }
  .plum .see {
    color: var(--plum);
  }
  .see:hover :global(svg) {
    transform: translateX(4px);
  }
  .plist {
    display: grid;
    gap: 2px;
  }
  .pitem {
    padding: 10px 4px;
    border-bottom: 1px solid var(--outline);
    animation: rise 0.4s var(--ease-out) both;
  }
  .pn {
    font-weight: 600;
    display: flex;
    gap: 8px;
    align-items: center;
  }
  .vers {
    display: flex;
    gap: 4px;
    flex-wrap: wrap;
    margin-top: 6px;
  }
  .empty {
    display: grid;
    justify-items: center;
    text-align: center;
  }
  .empty img {
    width: 140px;
  }
  @media (max-width: 1100px) {
    .tools {
      grid-template-columns: 1fr 1fr;
    }
  }
  @media (max-width: 560px) {
    .tools {
      grid-template-columns: 1fr;
    }
    .tool {
      min-height: 0;
    }
  }
</style>
