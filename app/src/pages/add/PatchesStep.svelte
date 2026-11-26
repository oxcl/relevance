<script lang="ts">
  import { onMount } from 'svelte';
  import { slide, fly } from 'svelte/transition';
  import { flip } from 'svelte/animate';
  import Icon from '$c/Icon.svelte';
  import Hero from '$c/Hero.svelte';
  import Switch from '$c/Switch.svelte';
  import Dialog from '$c/Dialog.svelte';
  import StepNav from '$c/StepNav.svelte';
  import { draft } from '$lib/draft.svelte';
  import { loadIndex, sourceFor, data } from '$lib/store.svelte';
  import { patchesForPackage, pickTarget, findPatch, sortVersionsDesc, versionsFor } from '$shared/logic';
  import type { PatchDef, PatchOptionDef, CustomPatch } from '$shared/types';
  import { ripple } from '$lib/ui.svelte';
  import { navigate, router } from '$lib/router.svelte';

  let { go }: { go: (d: number) => void } = $props();
  const d = draft.d;
  const app = d.app;
  const pkg = app.packageName;
  const src = sourceFor(app.tool, app.patchSourceId)!;
  const toolName = { revanced: 'ReVanced', morphe: 'Morphe', lspatch: 'LSPatch', none: '' }[app.tool];
  const isModules = app.tool === 'lspatch';

  let loading = $state(true);
  let query = $state('');
  let showUniversal = $state(false);
  let optFor = $state<PatchDef | null>(null);
  let optOpen = $state(false);
  let customOpen = $state(false);
  let customDraft = $state<CustomPatch>({ id: '', name: '', description: '', url: '', enabled: true });

  onMount(async () => {
    if (src) await loadIndex(src);
    loading = false;
    if (!app.patches.length && !d.editing && !(d as any).defaultsApplied && !isModules) {
      app.patches = specific.filter((p) => p.default !== false).map((p) => ({ name: p.name }));
    }
    (d as any).defaultsApplied = true;
  });

  const index = $derived(src ? data.indexes[src.id] : null);
  const all = $derived(patchesForPackage(index, pkg));
  const specific = $derived(all.filter((p) => p.packages && p.packages.length));
  const universal = $derived(all.filter((p) => !p.packages || !p.packages.length));
  const match = (p: PatchDef) => !query || (p.name + ' ' + (p.description || '')).toLowerCase().includes(query.toLowerCase());
  const isOn = (name: string) => app.patches.some((p) => p.name === name);
  function toggle(p: PatchDef, v: boolean) {
    if (v && !isOn(p.name)) app.patches = [...app.patches, { name: p.name }];
    if (!v) app.patches = app.patches.filter((x) => x.name !== p.name);
  }
  function selected(name: string) {
    return app.patches.find((p) => p.name === name);
  }
  const target = $derived(pickTarget(isModules ? null : index, pkg, app.patches, d.info?.versions ?? null, null));
  const pinChoices = $derived(sortVersionsDesc([...(target.supported || []), ...(d.info?.versions || [])]).slice(0, 30));
  let pinOn = $state(!!app.pin);

  function openOptions(p: PatchDef) {
    if (!isOn(p.name)) toggle(p, true);
    optFor = p;
    optOpen = true;
  }
  function optValue(o: PatchOptionDef) {
    const s = selected(optFor!.name);
    return s?.options?.[o.key] ?? o.default ?? '';
  }
  function setOpt(o: PatchOptionDef, v: unknown) {
    const s = selected(optFor!.name);
    if (!s) return;
    s.options = { ...(s.options || {}), [o.key]: v };
    app.patches = [...app.patches];
  }
  function kind(o: PatchOptionDef) {
    const t = (o.type || '').toLowerCase();
    if (o.values && Object.keys(o.values).length) return 'enum';
    if (t.includes('bool')) return 'bool';
    if (t.includes('int') || t.includes('long') || t.includes('float') || t.includes('double')) return 'number';
    if (t.includes('list') || t.includes('array')) return 'list';
    return 'string';
  }
  function saveCustom() {
    const c = { ...customDraft, id: customDraft.id || `c${Date.now().toString(36)}` };
    app.customPatches = [...app.customPatches.filter((x) => x.id !== c.id), c];
    customOpen = false;
  }
  function editCustom(c?: CustomPatch) {
    customDraft = c ? { ...c } : { id: '', name: '', description: '', url: '', enabled: true };
    customOpen = true;
  }
  const visibleSpecific = $derived(specific.filter(match));
  const recommended = $derived(specific.filter((p) => p.default !== false));
  function applyRecommended() {
    app.patches = recommended.map((p) => ({ name: p.name, options: selected(p.name)?.options }));
  }
  const selMode = $derived.by(() => {
    const names = new Set(app.patches.map((p) => p.name));
    const same = (list: PatchDef[]) => list.length === names.size && list.every((p) => names.has(p.name));
    if (!names.size) return 'none';
    if (!isModules && same(recommended)) return 'recommended';
    if (same(specific)) return 'all';
    return 'custom';
  });
  const missing = $derived(index && !isModules ? app.patches.filter((p) => !all.some((d) => d.name === p.name)) : []);
  const count = $derived(app.patches.length + app.customPatches.filter((c) => c.enabled).length);
  const base = router.route.name === 'edit' ? `/apps/${router.route.params.id}/edit` : '/add';
</script>

<Hero title={isModules ? 'Choose modules' : 'Choose patches'} art="patches" artWidth={460} compact>
  {#snippet eyebrow()}
    <span class="row"><span class="tag olive">{toolName}{src && !src.builtin ? ` · ${src.name}` : ''}</span>
      <a class="change" href="{base}/tool" data-back><Icon name="swap_horiz" size={18} /> Change tool</a></span>
  {/snippet}
  <p class="muted">Pick the {isModules ? 'Xposed modules to embed with LSPatch' : 'patches you want to apply to this app'}.</p>
</Hero>

<div class="layout">
  <div class="left">
    <div class="search">
      <Icon name="search" size={20} />
      <input class="input" placeholder="Search {isModules ? 'modules' : 'patches'}…" bind:value={query} />
      {#if specific.length}
        <div class="quick" role="group" aria-label="Quick selection">
          <button class:on={selMode === 'all'} onclick={() => (app.patches = specific.map((p) => ({ name: p.name, options: selected(p.name)?.options })))}>All</button>
          {#if !isModules}<button class:on={selMode === 'recommended'} onclick={applyRecommended}>Recommended</button>{/if}
          <button class:on={selMode === 'none'} onclick={() => (app.patches = [])}>None</button>
        </div>
      {/if}
    </div>
    {#if missing.length}
      <div class="notice error missing" transition:slide>
        <Icon name="warning" />
        <div class="grow">
          <b>No longer offered by {index?.name} {index?.version}</b>
          {#each missing as m (m.name)}
            <div class="mrow"><span>{m.name}</span><button class="btn sm soft" onclick={() => (app.patches = app.patches.filter((x) => x.name !== m.name))}>Remove</button></div>
          {/each}
        </div>
      </div>
    {/if}
    <div class="card list">
      {#if loading}
        {#each Array(5) as _}<div class="prow"><span class="skel" style="width:52px;height:30px;border-radius:99px"></span><span class="skel" style="height:34px;flex:1"></span></div>{/each}
      {:else if !visibleSpecific.length}
        <div class="empty"><img src="/art/empty.webp" alt="" class="art" /><p class="muted">{index ? `No ${isModules ? 'modules' : 'patches'} specifically for ${pkg}${query ? ' match your search' : ''}.` : 'The patch list is unavailable right now.'} You can add custom ones below.</p></div>
      {/if}
      {#each visibleSpecific as p, i (p.name)}
        {@const on = isOn(p.name)}
        <div class="prow" class:on animate:flip={{ duration: 250 }} style="animation-delay:{Math.min(i, 16) * 30}ms">
          <Switch checked={on} label={p.name} onchange={(v) => toggle(p, v)} />
          <button class="ptext" onclick={() => toggle(p, !on)}>
            <span class="pn">{p.name}</span>
            {#if p.description}<span class="muted small">{p.description}</span>{/if}
          </button>
          {#if p.options?.length}
            <button class="icon-btn gear" class:has={Object.keys(selected(p.name)?.options || {}).length} aria-label="Options for {p.name}" onclick={() => openOptions(p)}><Icon name="settings" /></button>
          {/if}
        </div>
      {/each}
    </div>

    {#if universal.length}
      <button class="uni-toggle" onclick={() => (showUniversal = !showUniversal)}>
        <Icon name={showUniversal ? 'keyboard_arrow_up' : 'keyboard_arrow_down'} /> Universal patches ({universal.length}) <span class="muted small">work with any app</span>
      </button>
      {#if showUniversal}
        <div class="card list" transition:slide>
          {#each universal.filter(match) as p (p.name)}
            <div class="prow" class:on={isOn(p.name)}>
              <Switch checked={isOn(p.name)} label={p.name} onchange={(v) => toggle(p, v)} />
              <button class="ptext" onclick={() => toggle(p, !isOn(p.name))}><span class="pn">{p.name}</span>{#if p.description}<span class="muted small">{p.description}</span>{/if}</button>
              {#if p.options?.length}<button class="icon-btn gear" aria-label="Options" onclick={() => openOptions(p)}><Icon name="settings" /></button>{/if}
            </div>
          {/each}
        </div>
      {/if}
    {/if}

    <h2 class="section-title custom-h"><Icon name="extension" /> Custom extra {isModules ? 'modules' : 'patches'}</h2>
    {#if app.customPatches.length}
      <div class="card list">
        {#each app.customPatches as c (c.id)}
          <div class="prow" class:on={c.enabled} transition:slide>
            <Switch bind:checked={c.enabled} label={c.name} />
            <div class="ptext"><span class="pn">{c.name}</span><span class="muted small">{c.description || c.url}</span></div>
            <button class="icon-btn" aria-label="Edit" onclick={() => editCustom(c)}><Icon name="edit" /></button>
            <button class="icon-btn" aria-label="Delete" onclick={() => (app.customPatches = app.customPatches.filter((x) => x.id !== c.id))}><Icon name="delete" /></button>
          </div>
        {/each}
      </div>
    {/if}
    <button class="btn outlined add-custom" onclick={() => editCustom()} use:ripple><Icon name="add" /> Add custom {isModules ? 'module' : 'patch'}</button>
  </div>

  <aside class="card pad summary">
    <h3 class="title row"><Icon name="eco" /> Summary</h3>
    {#key count}<div class="sel" in:fly={{ y: -8, duration: 300 }}><b>{count}</b> {isModules ? 'modules' : 'patches'} selected</div>{/key}
    {#if !isModules}
      <div class="label">Target version</div>
      {#if target.conflict}
        <div class="notice error small"><Icon name="error" />The selected patches don't share a supported version. Deselect some.</div>
      {:else}
        <div class="tv mono">{app.pin ? `v${app.pin}` : target.target ? `v${target.target}` : 'latest'}</div>
        <p class="muted small">{app.pin ? 'Pinned — always build this version.' : app.source.type === 'apkpure' && /may not provide/.test(target.reason) ? 'Newest version all selected patches support. Relevance downloads exactly this version from APKPure.' : target.reason}</p>
      {/if}
    {/if}
    <hr class="divider" />
    <div class="row pinrow">
      <Icon name="keep" size={20} />
      <span class="spacer">Pin version</span>
      <Switch bind:checked={pinOn} label="Pin version" onchange={(v) => (app.pin = v ? target.target || pinChoices[0] || d.info?.latest || null : null)} />
    </div>
    {#if pinOn}
      <div transition:slide>
        {#if pinChoices.length}
          <select class="select mono" bind:value={app.pin}>{#each pinChoices as v}<option value={v}>{v}</option>{/each}</select>
        {:else}
          <input class="input mono" placeholder="1.2.3" bind:value={app.pin} />
        {/if}
      </div>
    {/if}
    <p class="muted small">Always build this specific version, even if a newer one is available.</p>
  </aside>
</div>

<Dialog bind:open={optOpen} title={optFor?.name || ''} icon="tune">
  {#if optFor}
    <div class="stack">
      {#each optFor.options || [] as o (o.key)}
        {@const k = kind(o)}
        <div class="field opt">
          <span class="label">{o.title || o.key}{#if o.required}<span class="req">*</span>{/if}</span>
          {#if o.description}<span class="muted small desc">{o.description}</span>{/if}
          {#if k === 'bool'}
            <Switch checked={String(optValue(o)) === 'true'} onchange={(v) => setOpt(o, v)} label={o.key} />
          {:else if k === 'enum'}
            <select class="select" value={String(optValue(o))} onchange={(e) => setOpt(o, (e.target as HTMLSelectElement).value)}>
              {#each Object.entries(o.values || {}) as [label, val]}<option value={String(val)}>{label}</option>{/each}
            </select>
          {:else if k === 'number'}
            <input class="input mono" type="number" value={optValue(o)} oninput={(e) => setOpt(o, Number((e.target as HTMLInputElement).value))} />
          {:else if k === 'list'}
            <textarea class="textarea mono" placeholder="one per line" value={Array.isArray(optValue(o)) ? (optValue(o) as any[]).join('\n') : String(optValue(o) || '')} oninput={(e) => setOpt(o, (e.target as HTMLTextAreaElement).value.split('\n').filter(Boolean))}></textarea>
          {:else}
            <input class="input" value={String(optValue(o) ?? '')} oninput={(e) => setOpt(o, (e.target as HTMLInputElement).value)} />
          {/if}
          <span class="mono muted tiny">{o.key} · {o.type || 'string'}</span>
        </div>
      {/each}
    </div>
  {/if}
  {#snippet actions()}<button class="btn" onclick={() => (optOpen = false)}>Done</button>{/snippet}
</Dialog>

<Dialog bind:open={customOpen} title="Custom {isModules ? 'module' : 'patch'}" icon="extension">
  <div class="stack">
    {#if isModules}
      <label class="field"><span class="label">Name</span><input class="input" bind:value={customDraft.name} placeholder="My module" /></label>
      <label class="field"><span class="label">Module source</span><input class="input mono" bind:value={customDraft.url} placeholder="https://github.com/owner/module  or  https://…/module.apk" /></label>
      <p class="hint"><Icon name="info" size={16} />The newest APK from the repository's releases is embedded with LSPatch.</p>
    {:else}
      <label class="field"><span class="label">Patch name (exactly as in the bundle)</span><input class="input" bind:value={customDraft.name} placeholder="Force dark theme" /></label>
      <label class="field"><span class="label">Description</span><input class="input" bind:value={customDraft.description} placeholder="Applies a dark theme regardless of settings." /></label>
      <label class="field"><span class="label">Patch bundle</span><input class="input mono" bind:value={customDraft.url} placeholder="https://github.com/owner/patches  or  https://…/patches.{app.tool === 'morphe' ? 'mpp' : 'rvp'}" /></label>
      <p class="hint"><Icon name="info" size={16} />A {toolName} bundle (.{app.tool === 'morphe' ? 'mpp' : 'rvp'}) from a direct link or the newest GitHub/GitLab release.</p>
    {/if}
  </div>
  {#snippet actions()}
    <button class="btn soft" onclick={() => (customOpen = false)}>Cancel</button>
    <button class="btn" disabled={!customDraft.name || !/^https:\/\//.test(customDraft.url)} onclick={saveCustom}>Save</button>
  {/snippet}
</Dialog>

<StepNav {go} canNext={!target.conflict && !missing.length} />

<style>
  .quick {
    display: flex;
    padding: 3px;
    border-radius: 999px;
    background: var(--container);
    flex: 0 0 auto;
  }
  .quick button {
    border: 0;
    background: none;
    padding: 7px 14px;
    border-radius: 999px;
    font-weight: 600;
    font-size: 0.85rem;
    color: var(--text-2);
    cursor: pointer;
    transition: background-color 0.25s var(--ease), color 0.25s;
  }
  .quick button.on {
    background: var(--surface);
    color: var(--text);
    box-shadow: var(--shadow-1);
  }
  .rec {
    margin-left: 8px;
    height: 20px;
    font-size: 0.7rem;
    vertical-align: middle;
  }
  .missing {
    margin-bottom: 12px;
  }
  .missing .grow {
    flex: 1;
    display: grid;
    gap: 6px;
  }
  .mrow {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 10px;
  }
  .change {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: var(--terra);
    font-weight: 600;
    font-size: 0.92rem;
  }
  .layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 300px;
    gap: 18px;
    align-items: start;
  }
  .search {
    position: relative;
    display: flex;
    gap: 6px;
    align-items: center;
    margin-bottom: 12px;
  }
  .search > :global(svg) {
    position: absolute;
    left: 12px;
    color: var(--muted);
  }
  .search .input {
    padding-left: 40px;
  }
  .list {
    padding: 4px 6px;
  }
  .prow {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 10px 10px;
    border-bottom: 1px solid color-mix(in srgb, var(--outline) 60%, transparent);
    border-radius: 14px;
    animation: rise 0.45s var(--ease-out) both;
    transition: background 0.3s;
  }
  .prow:last-child {
    border-bottom: 0;
  }
  .prow.on {
    background: color-mix(in srgb, var(--olive-c) 22%, transparent);
  }
  .ptext {
    flex: 1;
    min-width: 0;
    display: grid;
    gap: 2px;
    text-align: left;
    background: none;
    border: 0;
    padding: 0;
    cursor: pointer;
  }
  .pn {
    font-weight: 600;
  }
  .gear :global(svg) {
    transition: transform 0.6s var(--ease-spring);
  }
  .gear:hover :global(svg) {
    transform: rotate(90deg);
  }
  .gear.has {
    color: var(--terra);
  }
  .uni-toggle {
    display: flex;
    gap: 8px;
    align-items: center;
    border: 0;
    background: none;
    padding: 14px 4px;
    font-weight: 600;
    cursor: pointer;
  }
  .custom-h {
    margin-top: 22px;
  }
  .add-custom {
    margin-top: 12px;
  }
  .summary {
    position: sticky;
    top: 80px;
    display: grid;
    gap: 10px;
  }
  .sel {
    padding: 12px 14px;
    border-radius: 14px;
    background: var(--olive-c);
    color: var(--on-olive-c);
  }
  .sel b {
    font-size: 1.3rem;
  }
  .tv {
    justify-self: start;
    font-size: 1.4rem;
    padding: 4px 12px;
    border-radius: 12px;
    background: var(--container);
    animation: rise 0.4s var(--ease-out);
  }
  .pinrow {
    font-weight: 600;
  }
  .empty {
    display: grid;
    justify-items: center;
    text-align: center;
    padding: 16px;
  }
  .empty img {
    width: 130px;
  }
  .opt {
    padding-bottom: 12px;
    border-bottom: 1px solid var(--outline);
  }
  .desc {
    white-space: pre-line;
  }
  .req {
    color: var(--terra);
  }
  .tiny {
    font-size: 0.7rem;
  }
  @media (max-width: 900px) {
    .layout {
      grid-template-columns: 1fr;
    }
    .summary {
      position: relative;
      top: 0;
      order: 2;
    }
  }
</style>
