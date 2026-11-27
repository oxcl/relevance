<script lang="ts">
  import { fly, slide } from 'svelte/transition';
  import Icon from '$c/Icon.svelte';
  import AppIcon from '$c/AppIcon.svelte';
  import StatusPill from '$c/StatusPill.svelte';
  import Switch from '$c/Switch.svelte';
  import Dialog from '$c/Dialog.svelte';
  import NotFound from './NotFound.svelte';
  import { router, navigate } from '$lib/router.svelte';
  import { data, session, gh, appState, appStatus, displayName, displayPackage, startBuild, checkUpdates, saveConfig, publishSite, sourceFor, refresh } from '$lib/store.svelte';
  import { sourceLabel, sourceAutoUpdates } from '$shared/sources';
  import { missingCompanion, companionApp } from '$shared/companions';
  import { formatBytes, encodeRecipe, recipeFromApp } from '$shared/logic';
  import { ripple, toast, errorToast, timeAgo, duration, copy } from '$lib/ui.svelte';

  const id = router.route.params.id;
  const app = $derived(data.config?.apps.find((a) => a.id === id));
  const st = $derived(appState(id));
  const status = $derived(app ? appStatus(app) : 'never');
  let tab = $state<'overview' | 'versions' | 'history'>('overview');
  let delOpen = $state(false);
  let delReleases = $state(false);
  let busy = $state('');
  let editMenu = $state(false);
  const companion = $derived(app ? missingCompanion(data.config, app) : null);
  async function addCompanion() {
    if (!companion) return;
    busy = 'companion';
    try {
      let cid = '';
      await saveConfig((c) => {
        const ca = companionApp(companion, c.apps.map((a) => a.id));
        cid = ca.id;
        c.apps.push(ca);
      }, `relevance: add ${companion.name}`);
      await startBuild(cid, true);
      toast(`${companion.name} added — building now`, 'success');
    } catch (e) {
      errorToast(e);
    }
    busy = '';
  }
  let trustOpen = $state(false);
  const shortCert = (c?: string) => (c ? c.slice(0, 16).toUpperCase().replace(/(.{4})/g, '$1 ').trim() + '…' : '—');
  async function trustNewSignature() {
    busy = 'trust';
    try {
      const path = `.relevance/state/${id}.json`;
      const s = { ...$state.snapshot(st), sourceCert: null, attention: null, status: st.current ? 'ok' : 'never' };
      await gh().commit(session.repo!, [{ path, content: JSON.stringify(s, null, 2) + '\n' }], `relevance: trust a new signing key for ${id}`);
      data.states[id] = s as any;
      trustOpen = false;
      const run = await startBuild(id, true);
      toast('The next download will be pinned as the new original signature', 'success');
      if (run) navigate(`/builds/${run.id}`);
    } catch (e) {
      errorToast(e);
    }
    busy = '';
  }
  const toolName: Record<string, string> = { revanced: 'ReVanced', morphe: 'Morphe', lspatch: 'LSPatch', none: 'No patching' };
  const runs = $derived(data.runs.filter((r) => r.appId === id));
  const running = $derived(runs.find((r) => r.status !== 'completed'));

  async function rebuild() {
    busy = 'build';
    try {
      const run = await startBuild(id, true);
      if (run) navigate(`/builds/${run.id}`);
      else toast('Build queued');
    } catch (e) {
      errorToast(e);
    }
    busy = '';
  }
  async function check() {
    busy = 'check';
    try {
      await checkUpdates(id);
      toast('Checking for updates in your GitHub Actions — results appear here shortly', 'success');
    } catch (e) {
      errorToast(e);
    }
    busy = '';
  }
  async function setEnabled(v: boolean) {
    try {
      await saveConfig((c) => {
        const a = c.apps.find((x) => x.id === id);
        if (a) a.enabled = v;
      }, `relevance: ${v ? 'enable' : 'disable'} ${id}`);
      toast(v ? 'Automatic updates on' : 'Paused — no automatic builds', 'success');
    } catch (e) {
      errorToast(e);
    }
  }
  async function dismissAttention() {
    try {
      const path = `.relevance/state/${id}.json`;
      const s = { ...$state.snapshot(st), attention: null, status: st.current ? 'ok' : 'never' };
      await gh().commit(session.repo!, [{ path, content: JSON.stringify(s, null, 2) + '\n' }], `relevance: dismiss notice for ${id}`);
      data.states[id] = s as any;
      toast('Dismissed');
    } catch (e) {
      errorToast(e);
    }
  }
  let removed = $state(false);
  async function remove() {
    busy = 'delete';
    try {
      const files: any[] = [{ path: `.relevance/state/${id}.json`, content: null }];
      for (const f of await gh().listDir(session.repo!, `.relevance/apps/${id}`)) {
        if (f.type === 'file') files.push({ path: f.path, content: null });
        else for (const g of await gh().listDir(session.repo!, f.path)) files.push({ path: g.path, content: null });
      }
      removed = true;
      await saveConfig((c) => (c.apps = c.apps.filter((a) => a.id !== id)), `relevance: remove ${id}`, files);
      delete data.states[id];
      // leave right away; release cleanup and the site refresh continue in the background
      navigate('/apps', { replace: true, back: true });
      toast('App removed — your store and F-Droid repo update in a few minutes', 'success');
      (async () => {
        if (delReleases) {
          const rels: any[] = await gh().req(`/repos/${session.repo}/releases?per_page=100`, { etag: false });
          for (const r of rels.filter((r) => r.tag_name.startsWith(`${id}-`) || r.tag_name.startsWith(`source-${id}-`))) {
            await gh().req(`/repos/${session.repo}/releases/${r.id}`, { method: 'DELETE' });
            await gh().req(`/repos/${session.repo}/git/refs/tags/${encodeURIComponent(r.tag_name)}`, { method: 'DELETE' }).catch(() => {});
          }
        }
        await publishSite().catch(() => {});
      })().catch((e) => errorToast(e));
      return;
    } catch (e) {
      removed = false;
      errorToast(e);
    }
    busy = '';
  }
  function recipeLink() {
    if (!app) return '';
    const s = sourceFor(app.tool, app.patchSourceId);
    return `${location.origin}/recipe#${encodeRecipe(recipeFromApp(app, s ? { tool: s.tool, name: s.name, url: s.url } : undefined))}`;
  }
  const storeUrl = $derived(data.pagesUrl ? `${data.pagesUrl}/apps/${id}/` : null);
</script>

<svelte:window onclick={() => (editMenu = false)} />

{#if !app}
  {#if data.loaded && !removed}<NotFound />{/if}
{:else}
  <a class="crumb" href="/apps" data-back><Icon name="arrow_back" size={20} /> Apps</a>
  <section class="head">
    <AppIcon {app} size={112} vt="icon-{id}" />
    <div class="meta">
      <h1 class="display name">{displayName(app)}</h1>
      <div class="mono muted">{displayPackage(app)}</div>
      <div class="row wrap">
        <StatusPill {status} />
        {#if st.current}<span class="tag mono">v{st.current.version}</span>{/if}
        {#if st.targetVersion && st.targetVersion !== (st.current?.sourceVersion ?? st.current?.version)}<span class="tag amber mono">→ v{st.targetVersion}</span>{/if}
        <span class="tag">{toolName[app.tool]}</span>
      </div>
    </div>
    <div class="acts">
      {#if running}
        <a class="btn" href="/builds/{running.id}" use:ripple><Icon name="sync" class="spin" /> View running build</a>
      {:else}
        <button class="btn" onclick={rebuild} disabled={!!busy} use:ripple><Icon name="replay" class={busy === 'build' ? 'spin' : ''} /> Rebuild</button>
      {/if}
      <button class="btn outlined" onclick={check} disabled={!!busy || !sourceAutoUpdates(app.source.type)} use:ripple><Icon name="sync" class={busy === 'check' ? 'spin' : ''} /> Check updates</button>
      <div class="pop">
        <button class="btn tonal" onclick={(e) => { e.stopPropagation(); editMenu = !editMenu; }} use:ripple><Icon name="edit" /> Edit <Icon name="keyboard_arrow_down" size={18} /></button>
        {#if editMenu}
          <div class="menu" transition:fly={{ y: -6, duration: 200 }}>
            {#each [['source', 'Source', 'travel_explore'], ['tool', 'Switch tool', 'swap_horiz'], ['patches', 'Patches', 'extension'], ['customize', 'Name & icon', 'palette'], ['listing', 'Store listing', 'storefront']] as [s, l, ic]}
              {#if s !== 'patches' || app.tool !== 'none'}<a href="/apps/{id}/edit/{s}"><Icon name={ic} size={18} />{l}</a>{/if}
            {/each}
          </div>
        {/if}
      </div>
    </div>
  </section>

  {#if st.attention}
    <div class="att" transition:slide>
      <Icon name="warning" fill size={26} />
      <div class="grow">
        <b>{st.attention.kind === 'build-failed' ? 'The last update failed to build' : st.attention.kind === 'selection-changed' ? 'Your patch selection needs a review' : st.attention.kind === 'signature-changed' ? "The original app isn't signed by its usual developer key" : 'No compatible version'}</b>
        <div>{st.attention.message}</div>
        {#if st.attention.details?.length && st.attention.details.join(' ') !== st.attention.message}<div class="mono small det">{st.attention.details.join(' · ')}</div>{/if}
      </div>
      <div class="att-acts">
        {#if st.attention.kind === 'build-failed'}<button class="btn sm light" onclick={rebuild}>Try again</button>
        {:else if st.attention.kind === 'signature-changed'}<button class="btn sm light" onclick={() => (trustOpen = true)}>Trust new signature</button>
        {:else}<a class="btn sm light" href="/apps/{id}/edit/patches">Review patches</a>{/if}
        {#if st.history[0]?.runId}<a class="btn sm ghost" href="/builds/{st.history[0].runId}">Log</a>{/if}
        <button class="btn sm ghost" onclick={dismissAttention}>Dismiss</button>
      </div>
    </div>
  {/if}

  {#if companion}
    <div class="notice comp" transition:slide>
      <Icon name="info" />
      <span><b>{displayName(app)} needs {companion.name}.</b> {companion.why}</span>
      <button class="btn sm" disabled={busy === 'companion'} onclick={addCompanion}>Add {companion.name}</button>
    </div>
  {/if}

  <div class="tabs" role="tablist">
    {#each [['overview', 'Overview'], ['versions', `Versions · ${st.releases.length}`], ['history', `Build history · ${st.history.length}`]] as [k, l]}
      <button role="tab" aria-selected={tab === k} class:on={tab === k} onclick={() => (tab = k as any)}>{l}</button>
    {/each}
    <span class="ink" style="transform:translateX({['overview', 'versions', 'history'].indexOf(tab) * 100}%)"></span>
  </div>

  {#key tab}
    <div in:fly={{ y: 10, duration: 300 }}>
      {#if tab === 'overview'}
        <div class="ov">
          <section class="card pad">
            <h3 class="section-title"><Icon name="extension" /> {app.tool === 'lspatch' ? 'Modules' : 'Patches'}</h3>
            {#if app.tool === 'none'}
              <p class="muted">No patching tool. {app.customize.name || app.customize.icon || app.customize.packageName ? 'Basic modifications only.' : 'Published exactly as released, keeping the original signature.'}</p>
            {:else}
              <ul class="checks">
                {#each app.patches as p}<li><Icon name="check_circle" fill size={18} />{p.name}{#if p.options && Object.keys(p.options).length}<span class="tag">options</span>{/if}</li>{/each}
                {#each app.customPatches.filter((c) => c.enabled) as c}<li><Icon name="check_circle" fill size={18} />{c.name}<span class="tag terra">custom</span></li>{/each}
              </ul>
              {#if !app.patches.length && !app.customPatches.length}<p class="muted">Nothing selected.</p>{/if}
            {/if}
            <a class="btn text sm" href="/apps/{id}/edit/{app.tool === 'none' ? 'tool' : 'patches'}">Change</a>
          </section>
          <section class="card pad">
            <h3 class="section-title"><Icon name="travel_explore" /> Source & updates</h3>
            <dl>
              <dt>Source</dt><dd>{sourceLabel(app.source.type)}</dd>
              <dt>URL</dt><dd class="mono ell"><a href={app.source.url} target="_blank" rel="noreferrer">{app.source.url.replace(/^https?:\/\//, '')}</a></dd>
              <dt>Updates</dt><dd>{sourceAutoUpdates(app.source.type) ? 'Checked daily' : 'By hand'}</dd>
              <dt>Latest at source</dt><dd class="mono">{st.latestAvailable || '—'}</dd>
              <dt>Target</dt><dd class="mono">{app.pin ? `${app.pin} (pinned)` : st.targetVersion || '—'}</dd>
              <dt>Last checked</dt><dd>{timeAgo(st.checkedAt)}</dd>
              <dt>Original signature</dt><dd class="mono" title={st.sourceCert?.sha256.join('\n')}>{st.sourceCert ? `${shortCert(st.sourceCert.sha256[0])} · pinned ${new Date(st.sourceCert.firstSeen).toLocaleDateString()}` : 'pinned on the first build'}</dd>
            </dl>
            <div class="row toggle">
              <Switch checked={app.enabled} onchange={setEnabled} label="Automatic builds" />
              <span>Automatic builds</span>
            </div>
          </section>
          <section class="card pad">
            <h3 class="section-title"><Icon name="storefront" /> In your store</h3>
            <p class="muted small">{app.listing.summary}</p>
            <div class="wrap-row">
              {#if storeUrl && st.current}<a class="btn sm" href={storeUrl} target="_blank" rel="noreferrer"><Icon name="open_in_new" size={18} /> Store page</a>{/if}
              {#if st.current}<a class="btn sm outlined" href={st.current.url} data-native><Icon name="download" size={18} /> APK</a>{/if}
              <button class="btn sm outlined" onclick={() => copy(recipeLink(), 'Recipe link copied')}><Icon name="share" size={18} /> Share recipe</button>
            </div>
          </section>
          <section class="card pad danger-card">
            <h3 class="section-title"><Icon name="delete" /> Remove</h3>
            <p class="muted small">Removes the app from Relevance, your F-Droid repository and store site.</p>
            <button class="btn danger sm" onclick={() => (delOpen = true)}>Delete app</button>
          </section>
        </div>
      {:else if tab === 'versions'}
        <section class="card pad">
          {#if !st.releases.length}
            <div class="empty"><img src="/art/empty.webp" alt="" class="art" /><p class="muted">No published versions yet.</p></div>
          {:else}
            <table class="table">
              <thead><tr><th>Version</th><th>Built</th><th>Size</th><th>Patches</th><th></th></tr></thead>
              <tbody>
                {#each st.releases as r, i}
                  <tr style="--i:{i}">
                    <td class="mono">{r.version}{#if i === 0}<span class="tag olive">current</span>{/if}</td>
                    <td>{new Date(r.date).toLocaleDateString()}</td>
                    <td class="mono">{formatBytes(r.size)}</td>
                    <td class="muted small">{r.patches.length}</td>
                    <td><a class="icon-btn" href={r.url} data-native aria-label="Download {r.version}"><Icon name="download" /></a></td>
                  </tr>
                {/each}
              </tbody>
            </table>
          {/if}
        </section>
      {:else}
        <section class="card pad">
          {#each st.history as h, i (h.runId + '-' + i)}
            <a class="hist" href="/builds/{h.runId}" style="--i:{i}">
              <span class="res {h.status}"><Icon name={h.status === 'success' ? 'check' : h.status === 'failure' ? 'close' : h.status === 'running' ? 'sync' : h.status === 'cancelled' ? 'block' : 'remove'} size={16} /></span>
              <span class="grow"><b>{h.version ? `v${h.version}` : 'Build'}</b> <span class="muted small">· {h.trigger} · {h.status}</span>{#if h.error}<br /><span class="small err">{h.error}</span>{/if}</span>
              <span class="muted small">{duration(h.durationMs)}</span>
              <span class="muted small">{timeAgo(h.at)}</span>
              <Icon name="chevron_right" size={18} />
            </a>
          {:else}
            <div class="empty"><img src="/art/builds.webp" alt="" class="art" /><p class="muted">No builds yet.</p></div>
          {/each}
        </section>
      {/if}
    </div>
  {/key}

  <Dialog bind:open={trustOpen} title="Trust a new signing key?" icon="key">
    <p>The last download of {displayName(app)} was signed by a different key than the original you pinned. That happens when a developer rotates keys, but it's also exactly what a modified or malicious copy looks like.</p>
    <p>Only continue if you've confirmed the change is genuine, for example from the developer's announcement or another trusted source. The next download will be pinned as the new original.</p>
    {#if st.attention?.message}<div class="notice small"><span class="mono">{st.attention.message}</span></div>{/if}
    {#snippet actions()}
      <button class="btn soft" onclick={() => (trustOpen = false)}>Cancel</button>
      <button class="btn terra" disabled={busy === 'trust'} onclick={trustNewSignature}>{busy === 'trust' ? 'Saving…' : 'Trust and rebuild'}</button>
    {/snippet}
  </Dialog>

  <Dialog bind:open={delOpen} title="Delete {displayName(app)}?" icon="delete">
    <p>This removes the app from Relevance and, on the next publish, from your F-Droid repository and store site. People who installed it keep their copy.</p>
    <label class="row"><input type="checkbox" bind:checked={delReleases} /> Also delete its GitHub releases (all past APKs)</label>
    {#snippet actions()}
      <button class="btn soft" onclick={() => (delOpen = false)}>Cancel</button>
      <button class="btn danger" disabled={busy === 'delete'} onclick={remove}>{busy === 'delete' ? 'Deleting…' : 'Delete'}</button>
    {/snippet}
  </Dialog>
{/if}

<style>
  .crumb {
    display: inline-flex;
    gap: 6px;
    align-items: center;
    text-decoration: none;
    color: var(--text-2);
    font-weight: 500;
    margin: 6px 0 14px;
  }
  .head {
    display: flex;
    gap: 24px;
    align-items: center;
    flex-wrap: wrap;
    margin-bottom: 20px;
  }
  .meta {
    flex: 1 1 220px;
    min-width: 0;
    display: grid;
    gap: 6px;
  }
  .meta .mono {
    overflow-wrap: anywhere;
  }
  .name {
    font-size: clamp(1.9rem, 4vw, 2.8rem);
  }
  .wrap {
    flex-wrap: wrap;
    gap: 6px;
  }
  .acts {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }
  .pop {
    position: relative;
  }
  .menu {
    position: absolute;
    right: 0;
    top: calc(100% + 6px);
    z-index: 10;
    min-width: 200px;
    padding: 6px;
    display: grid;
    border-radius: 16px;
    background: var(--surface);
    box-shadow: var(--shadow-3);
    border: 1px solid var(--outline);
  }
  .menu a {
    display: flex;
    gap: 10px;
    align-items: center;
    padding: 10px;
    border-radius: 10px;
    text-decoration: none;
  }
  .menu a:hover {
    background: var(--container);
  }
  .att {
    display: flex;
    gap: 14px;
    align-items: flex-start;
    flex-wrap: wrap;
    padding: 16px 20px;
    border-radius: var(--radius-l);
    background: var(--terra);
    color: var(--on-terra);
    margin-bottom: 18px;
    box-shadow: var(--shadow-2);
  }
  .grow {
    flex: 1;
    min-width: 0;
  }
  .det {
    opacity: 0.85;
    margin-top: 4px;
  }
  .att-acts {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }
  .light {
    --bg-btn: #fff8f3;
    --fg-btn: #8c3a22;
  }
  .ghost {
    --bg-btn: transparent;
    --fg-btn: inherit;
    box-shadow: inset 0 0 0 1.5px currentColor;
  }
  .comp {
    margin-bottom: 16px;
    align-items: center;
  }
  .comp span {
    flex: 1;
  }
  .tabs {
    position: relative;
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    max-width: 560px;
    margin-bottom: 16px;
    border-bottom: 1px solid var(--outline);
  }
  .tabs button {
    border: 0;
    background: none;
    padding: 12px 6px;
    font-weight: 600;
    color: var(--muted);
    cursor: pointer;
    transition: color 0.2s;
  }
  .tabs button.on {
    color: var(--text);
  }
  .ink {
    position: absolute;
    bottom: -1px;
    left: 0;
    width: calc(100% / 3);
    height: 3px;
    border-radius: 3px 3px 0 0;
    background: var(--terra);
    transition: transform 0.45s var(--ease-spring);
  }
  .ov {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
  }
  .checks {
    list-style: none;
    padding: 0;
    margin: 0 0 8px;
    display: grid;
    gap: 6px;
  }
  .checks li {
    display: flex;
    gap: 8px;
    align-items: center;
  }
  .checks :global(svg) {
    color: var(--olive);
  }
  dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 6px 16px;
    margin: 0 0 14px;
  }
  dt {
    color: var(--muted);
  }
  dd {
    margin: 0;
    min-width: 0;
  }
  .ell {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .toggle {
    font-weight: 600;
  }
  .danger-card {
    background: color-mix(in srgb, var(--error-c) 45%, var(--surface));
  }
  .table {
    width: 100%;
    border-collapse: collapse;
  }
  .table th {
    text-align: left;
    font-weight: 500;
    color: var(--muted);
    font-size: 0.85rem;
    padding: 8px;
  }
  .table td {
    padding: 8px;
    border-top: 1px solid var(--outline);
  }
  .table tr {
    animation: rise 0.4s var(--ease-out) both;
    animation-delay: calc(var(--i) * 40ms);
  }
  .table td .tag {
    margin-left: 8px;
  }
  .hist {
    display: flex;
    gap: 12px;
    align-items: center;
    padding: 10px 8px;
    border-radius: 14px;
    text-decoration: none;
    animation: rise 0.4s var(--ease-out) both;
    animation-delay: calc(var(--i) * 40ms);
  }
  .hist:hover {
    background: var(--container);
  }
  .res {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    background: var(--container);
    flex: 0 0 auto;
  }
  .res.success {
    background: var(--olive-c);
    color: var(--on-olive-c);
  }
  .res.failure {
    background: var(--terra-c);
    color: var(--on-terra-c);
  }
  .res.running :global(svg) {
    animation: spin 1.2s linear infinite;
  }
  .err {
    color: var(--error);
  }
  .empty {
    display: grid;
    justify-items: center;
    text-align: center;
  }
  .empty img {
    width: 160px;
  }
  @media (max-width: 760px) {
    .ov {
      grid-template-columns: 1fr;
    }
    .table th:nth-child(4),
    .table td:nth-child(4) {
      display: none;
    }
  }
</style>
