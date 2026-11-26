<script lang="ts">
  import { fly, slide, scale } from 'svelte/transition';
  import Icon from '$c/Icon.svelte';
  import Hero from '$c/Hero.svelte';
  import AppIcon from '$c/AppIcon.svelte';
  import StepNav from '$c/StepNav.svelte';
  import { draft } from '$lib/draft.svelte';
  import { session, data, proxied } from '$lib/store.svelte';
  import { detectSource, defaultAssetPattern, sourceAutoUpdates, sourceLabel, type SourceInfo } from '$shared/sources';
  import { isValidPackageName, formatBytes } from '$shared/logic';
  import { inspectFile, inspectUrl } from '$lib/apk';
  import { ripple, errorToast } from '$lib/ui.svelte';

  let { go }: { go: (d: number) => void } = $props();
  const d = draft.d;
  type Tab = 'store' | 'url' | 'github' | 'upload';
  const tabFor = (t: string): Tab => (t === 'apkpure' || t === 'fdroid' ? 'store' : t === 'github' ? 'github' : t === 'upload' ? 'upload' : 'url');
  let tab = $state<Tab>(d.app.source.url || d.uploadFile ? tabFor(d.app.source.type) : 'store');
  let url = $state(d.app.source.type !== 'upload' ? d.app.source.url : '');
  let busy = $state(false);
  let error = $state('');
  let asset = $state<string>('');
  let dragging = $state(false);
  let fileInput: HTMLInputElement;

  const tabs: [Tab, string, string][] = [
    ['store', 'App store URL', 'store'],
    ['url', 'Direct URL', 'link'],
    ['github', 'GitHub Releases', 'github'],
    ['upload', 'Upload APK', 'upload'],
  ];
  const placeholder: Record<Tab, string> = {
    store: 'https://apkpure.com/app-name/com.example.app  or  https://f-droid.org/packages/…',
    url: 'https://example.com/downloads/app.apk',
    github: 'https://github.com/owner/repository',
    upload: '',
  };

  function applyInfo(info: SourceInfo, pkg?: string, name?: string) {
    d.info = info;
    d.app.packageName = pkg || info.packageName || d.app.packageName;
    d.app.name = name || info.name || d.app.name || d.app.packageName;
    if (info.iconUrl) {
      d.app.iconUrl = info.iconUrl;
      d.iconBase = proxied(info.iconUrl);
    }
    const l = d.app.listing;
    if (!l.summary && info.summary) l.summary = info.summary.slice(0, 80);
    if (!l.description && info.description) l.description = info.description.includes('<') ? info.description : `<p>${info.description.replace(/\n\n+/g, '</p><p>').replace(/\n/g, '<br>')}</p>`;
    if (!l.website && info.website) l.website = info.website;
    if (!l.screenshots.length && info.screenshots?.length) l.screenshots = info.screenshots.slice(0, 8);
  }

  async function fetchInfo() {
    error = '';
    busy = true;
    try {
      if (tab === 'store' || tab === 'github') {
        const type = detectSource(url);
        if (tab === 'store' && type !== 'apkpure' && type !== 'fdroid') throw new Error('Paste an APKPure or F-Droid app page URL. For other links use "Direct URL".');
        if (tab === 'github' && type !== 'github') throw new Error('Paste a GitHub repository URL like https://github.com/owner/repo');
        const q = new URLSearchParams({ type: type!, url: url.trim() });
        const r = await fetch(`/api/source?${q}`, { headers: tab === 'github' ? { Authorization: `Bearer ${session.token}` } : {} });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || 'Could not read that source');
        d.app.source = { type: type!, url: url.trim() };
        if (type === 'github') {
          const apks = (j.assets || []).filter((a: any) => /\.apk$/i.test(a.name));
          if (!apks.length) throw new Error('The newest release of that repository has no APK files');
          const pattern = defaultAssetPattern(apks.map((a: any) => a.name));
          const pick = apks.find((a: any) => new RegExp(pattern, 'i').test(a.name)) || apks[0];
          asset = pick.name;
          d.app.source.assetPattern = pattern;
          applyInfo(j);
          await inspectAsset(pick.url);
        } else applyInfo(j);
      } else if (tab === 'url') {
        const meta = await inspectUrl(url.trim());
        d.app.source = { type: 'url', url: url.trim() };
        const name = meta.label || decodeURIComponent(new URL(meta.finalUrl).pathname.split('/').pop() || 'app').replace(/\.apk$/i, '');
        applyInfo({ versions: null, autoUpdates: false, latest: meta.versionName, size: meta.size, name }, meta.packageName, name);
        setIcon(meta.iconBlob);
      }
    } catch (e: any) {
      error = e.message;
    }
    busy = false;
  }

  async function inspectAsset(assetUrl: string) {
    try {
      const meta = await inspectUrl(assetUrl);
      d.app.packageName = meta.packageName;
      if (meta.label) d.app.name = meta.label;
      if (!d.app.iconUrl || d.app.iconUrl.includes('avatars.githubusercontent')) setIcon(meta.iconBlob);
    } catch (e: any) {
      error = `Found the release but couldn't read the APK (${e.message}). Enter the package name below.`;
    }
  }

  function setIcon(blob?: Blob) {
    if (!blob) return;
    d.sourceIconBlob = blob;
    d.iconBase = URL.createObjectURL(blob);
    d.app.iconUrl = undefined;
  }

  async function chooseAsset(name: string) {
    asset = name;
    const a = d.info?.assets?.find((x) => x.name === name);
    const pattern = defaultAssetPattern([name]);
    d.app.source.assetPattern = pattern;
    if (a) await inspectAsset(a.url);
  }

  async function onFile(f: File | undefined) {
    if (!f) return;
    error = '';
    busy = true;
    try {
      const meta = await inspectFile(f);
      d.uploadFile = f;
      d.uploadMeta = { packageName: meta.packageName, versionName: meta.versionName, versionCode: meta.versionCode };
      d.app.source = { type: 'upload', url: '', uploadedVersion: meta.versionName };
      const name = meta.label || f.name.replace(/\.apk$/i, '');
      applyInfo({ versions: [meta.versionName], autoUpdates: false, latest: meta.versionName, size: f.size, name }, meta.packageName, name);
      setIcon(meta.iconBlob);
    } catch (e: any) {
      error = e.message;
    }
    busy = false;
  }

  const ready = $derived(
    !!d.info && isValidPackageName(d.app.packageName) && !!d.app.name && (d.app.source.type !== 'upload' || !!d.uploadFile || !!d.editing),
  );
  const dupe = $derived(!d.editing && data.config?.apps.some((a) => a.packageName === d.app.packageName));
</script>

<Hero title="Where does the app come from?" art="source" artWidth={420} compact />

<div class="tabs" role="tablist">
  {#each tabs as [k, l, ic]}
    <button role="tab" aria-selected={tab === k} class="chip tabchip" class:selected={tab === k} onclick={() => ((tab = k), (error = ''))} use:ripple>
      <Icon name={ic} size={18} /> {l}
    </button>
  {/each}
</div>

<div class="cols">
  <div class="card pad input-card">
    {#key tab}
      <div in:fly={{ y: 8, duration: 300 }}>
        {#if tab === 'upload'}
          <button
            class="drop"
            class:dragging
            onclick={() => fileInput.click()}
            ondragover={(e) => { e.preventDefault(); dragging = true; }}
            ondragleave={() => (dragging = false)}
            ondrop={(e) => { e.preventDefault(); dragging = false; onFile(e.dataTransfer?.files[0]); }}
          >
            <span class="drop-ic"><Icon name="cloud_upload" size={34} /></span>
            <b>{d.uploadFile ? d.uploadFile.name : 'Drop an APK here or click to choose'}</b>
            <span class="muted small">It's uploaded to a release in your repository when you add the app.</span>
          </button>
          <input bind:this={fileInput} type="file" accept=".apk,application/vnd.android.package-archive" hidden onchange={(e) => onFile((e.target as HTMLInputElement).files?.[0])} />
        {:else}
          <label class="field">
            <span class="label">{tabs.find((t) => t[0] === tab)?.[1]}</span>
            <input class="input mono" placeholder={placeholder[tab]} bind:value={url} onkeydown={(e) => e.key === 'Enter' && url && fetchInfo()} />
          </label>
          <button class="btn fetch" disabled={!url || busy} onclick={fetchInfo} use:ripple>
            <Icon name="sync" class={busy ? 'spin' : ''} /> {busy ? 'Fetching…' : 'Fetch'}
          </button>
          {#if tab === 'store'}<p class="hint"><Icon name="info" size={16} />Supported: APKPure and F-Droid. Google Play isn't supported.</p>{/if}
          {#if tab === 'github'}
            <label class="pre-row"><input type="checkbox" bind:checked={d.app.source.prerelease} /> Include pre-releases</label>
          {/if}
        {/if}
        {#if error}<div class="notice error" transition:slide><Icon name="error" />{error}</div>{/if}
      </div>
    {/key}
  </div>

  <div class="result">
    {#if d.info}
      <div class="card pad found" in:scale={{ start: 0.94, duration: 450 }}>
        <div class="who">
          <AppIcon src={d.iconBase} name={d.app.name} size={84} />
          <div class="meta">
            <input class="name-in" bind:value={d.app.name} aria-label="App name" />
            <div class="mono muted">Package: <span class="txt">{d.app.packageName || '—'}</span></div>
            <div class="mono muted">Latest: <span class="txt">{d.info.latest || d.uploadMeta?.versionName || '—'}</span></div>
            {#if d.info.size}<div class="mono muted">File size: <span class="txt">{formatBytes(d.info.size)}</span></div>{/if}
            <div class="mono muted">Source: <span class="txt">{sourceLabel(d.app.source.type)}</span></div>
          </div>
        </div>
        {#if d.info.assets?.length}
          <div class="assets" transition:slide>
            <span class="label">APK file in each release</span>
            {#each d.info.assets.filter((a) => /\.apk$/i.test(a.name)) as a}
              <label class="asset" class:on={asset === a.name}>
                <input type="radio" name="asset" checked={asset === a.name} onchange={() => chooseAsset(a.name)} />
                <span class="mono">{a.name}</span><span class="muted small">{formatBytes(a.size)}</span>
              </label>
            {/each}
          </div>
        {/if}
        {#if !isValidPackageName(d.app.packageName)}
          <label class="field" transition:slide>
            <span class="label">Package name</span>
            <input class="input mono" placeholder="com.example.app" bind:value={d.app.packageName} />
          </label>
        {/if}
        <div class="auto" class:manual={!sourceAutoUpdates(d.app.source.type)}>
          <Icon name={sourceAutoUpdates(d.app.source.type) ? 'schedule' : 'handyman'} size={18} />
          {sourceAutoUpdates(d.app.source.type) ? 'Automatic updates: daily' : 'Updated by hand'}
        </div>
        {#if dupe}
          <div class="notice info"><Icon name="info" />You already have an app with this package. That's fine — give this variant a different package name in Customize so both install side by side.</div>
        {/if}
      </div>
    {:else}
      <div class="placeholder card flat">
        <Icon name="travel_explore" size={34} />
        <span class="muted">Fetch a source to see the app here.</span>
      </div>
    {/if}
  </div>
</div>
<p class="hint foot"><Icon name="info" size={16} />Direct uploads and direct URLs are updated by hand. Store and GitHub sources update automatically.</p>

<StepNav {go} canNext={ready} />

<style>
  .tabs {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    margin-bottom: 16px;
  }
  .tabchip.selected {
    background: var(--terra);
    border-color: var(--terra);
    color: var(--on-terra);
  }
  .cols {
    display: grid;
    grid-template-columns: 1.1fr 1fr;
    gap: 16px;
    align-items: start;
  }
  .input-card > div {
    display: grid;
    gap: 14px;
  }
  .fetch {
    justify-self: start;
  }
  .pre-row {
    display: flex;
    gap: 8px;
    align-items: center;
    font-size: 0.9rem;
  }
  .drop {
    display: grid;
    justify-items: center;
    gap: 8px;
    padding: 34px 20px;
    border-radius: 20px;
    border: 2px dashed var(--outline-strong);
    background: var(--surface-2);
    cursor: pointer;
    text-align: center;
    transition: all 0.3s var(--ease);
  }
  .drop:hover,
  .drop.dragging {
    border-color: var(--olive);
    background: color-mix(in srgb, var(--olive-c) 40%, var(--surface));
    transform: scale(1.01);
  }
  .drop.dragging .drop-ic {
    transform: translateY(-6px) scale(1.1);
  }
  .drop-ic {
    width: 64px;
    height: 64px;
    border-radius: 22px;
    display: grid;
    place-items: center;
    background: var(--olive-c);
    color: var(--on-olive-c);
    transition: transform 0.4s var(--ease-spring);
  }
  .found {
    display: grid;
    gap: 14px;
  }
  .who {
    display: flex;
    gap: 18px;
    align-items: flex-start;
  }
  .meta {
    display: grid;
    gap: 3px;
    min-width: 0;
  }
  .name-in {
    font: 800 1.35rem var(--font);
    border: 0;
    background: transparent;
    padding: 2px 6px;
    margin-left: -6px;
    border-radius: 8px;
    width: 100%;
  }
  .name-in:hover,
  .name-in:focus {
    background: var(--container);
    outline: none;
  }
  .txt {
    color: var(--text);
    word-break: break-all;
  }
  .auto {
    display: flex;
    gap: 8px;
    align-items: center;
    padding: 10px 14px;
    border-radius: 14px;
    background: var(--olive-c);
    color: var(--on-olive-c);
    font-family: var(--mono);
    font-size: 0.86rem;
  }
  .auto.manual {
    background: var(--amber-c);
    color: var(--on-amber-c);
  }
  .assets {
    display: grid;
    gap: 6px;
  }
  .asset {
    display: flex;
    gap: 10px;
    align-items: center;
    padding: 8px 10px;
    border-radius: 12px;
    border: 1.5px solid var(--outline);
    cursor: pointer;
    font-size: 0.85rem;
    transition: all 0.2s;
  }
  .asset .mono {
    flex: 1;
    word-break: break-all;
  }
  .asset.on {
    border-color: var(--olive);
    background: color-mix(in srgb, var(--olive-c) 40%, transparent);
  }
  .placeholder {
    display: grid;
    place-items: center;
    gap: 10px;
    min-height: 220px;
    border: 2px dashed var(--outline);
    background: transparent;
    color: var(--muted);
  }
  .foot {
    margin-top: 14px;
  }
  @media (max-width: 860px) {
    .cols {
      grid-template-columns: 1fr;
    }
    .tabs {
      flex-wrap: nowrap;
      overflow-x: auto;
      padding-bottom: 4px;
    }
    .tabchip {
      flex: 0 0 auto;
    }
  }
</style>
