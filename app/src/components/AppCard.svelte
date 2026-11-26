<script lang="ts">
  import type { AppConfig } from '$shared/types';
  import Icon from './Icon.svelte';
  import AppIcon from './AppIcon.svelte';
  import StatusPill from './StatusPill.svelte';
  import { appState, appStatus, displayName, displayPackage, startBuild, checkUpdates } from '$lib/store.svelte';
  import { tilt, toast, errorToast } from '$lib/ui.svelte';
  import { navigate } from '$lib/router.svelte';
  import { fly } from 'svelte/transition';
  let { app, i = 0 }: { app: AppConfig; i?: number } = $props();
  const st = $derived(appState(app.id));
  const status = $derived(appStatus(app));
  let menu = $state(false);
  const toolLabel: Record<string, string> = { revanced: 'ReVanced', morphe: 'Morphe', lspatch: 'LSPatch', none: 'Unpatched' };
  async function rebuild() {
    menu = false;
    try {
      toast(`Starting a build for ${displayName(app)}…`);
      const run = await startBuild(app.id, true);
      if (run) navigate(`/builds/${run.id}`);
    } catch (e) {
      errorToast(e);
    }
  }
  async function check() {
    menu = false;
    try {
      await checkUpdates(app.id);
      toast('Checking for updates in your GitHub Actions', 'success');
    } catch (e) {
      errorToast(e);
    }
  }
</script>

<svelte:window onclick={() => (menu = false)} />

<a class="app card hover" href="/apps/{app.id}" style="--i:{i}" use:tilt={3}>
  <div class="head">
    <AppIcon {app} size={58} vt="icon-{app.id}" />
    <button class="icon-btn sm more" aria-label="More" onclick={(e) => { e.preventDefault(); e.stopPropagation(); menu = !menu; }}><Icon name="more_vert" size={20} /></button>
    {#if menu}
      <div class="menu" transition:fly={{ y: -6, duration: 200 }} role="menu" tabindex="-1" onclick={(e) => { e.preventDefault(); e.stopPropagation(); }} onkeydown={() => {}}>
        <button onclick={rebuild}><Icon name="replay" size={18} />Rebuild now</button>
        <button onclick={check}><Icon name="sync" size={18} />Check for updates</button>
        <button onclick={() => navigate(`/apps/${app.id}/edit/patches`)}><Icon name="tune" size={18} />Edit patches</button>
      </div>
    {/if}
  </div>
  <div class="name">{displayName(app)}</div>
  <div class="mono muted pkg">{displayPackage(app)}</div>
  <div class="mono muted">{st.current ? `v${st.current.version}` : '—'}</div>
  <div class="foot">
    <StatusPill {status} />
  </div>
  <div class="tags">
    <span class="tag">{toolLabel[app.tool]}</span>
    {#each app.patches.slice(0, 2) as p}<span class="tag">{p.name}</span>{/each}
    {#if app.patches.length > 2}<span class="tag">+{app.patches.length - 2}</span>{/if}
  </div>
</a>

<style>
  .app {
    display: grid;
    gap: 2px;
    padding: 16px 16px 14px;
    text-decoration: none;
    animation: rise 0.6s var(--ease-out) both;
    animation-delay: calc(var(--i) * 50ms);
    background-image: radial-gradient(circle at var(--mx, 50%) var(--my, 0%), color-mix(in srgb, var(--olive-c) 35%, transparent), transparent 60%);
    min-width: 0;
  }
  .head {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 10px;
    position: relative;
  }
  .more {
    margin: -6px -6px 0 0;
  }
  .menu {
    position: absolute;
    right: 0;
    top: 30px;
    z-index: 10;
    display: grid;
    min-width: 190px;
    padding: 6px;
    border-radius: 16px;
    background: var(--surface);
    box-shadow: var(--shadow-3);
    border: 1px solid var(--outline);
  }
  .menu button {
    display: flex;
    gap: 10px;
    align-items: center;
    padding: 9px 10px;
    border: 0;
    background: none;
    border-radius: 10px;
    cursor: pointer;
    text-align: left;
  }
  .menu button:hover {
    background: var(--container);
  }
  .name {
    font-weight: 700;
    font-size: 1.05rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .pkg {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .foot {
    margin-top: 8px;
  }
  .tags {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
    margin-top: 10px;
  }
</style>
