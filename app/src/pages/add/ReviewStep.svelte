<script lang="ts">
  import { fly } from 'svelte/transition';
  import Icon from '$c/Icon.svelte';
  import Hero from '$c/Hero.svelte';
  import AppIcon from '$c/AppIcon.svelte';
  import StepNav from '$c/StepNav.svelte';
  import { draft, resetDraft, clearPersisted } from '$lib/draft.svelte';
  import { data, gh, session, saveConfig, startBuild, sourceFor, displayName } from '$lib/store.svelte';
  import { slugify, needsRebuild, configHash, buildSteps } from '$shared/logic';
  import { sourceLabel, sourceAutoUpdates } from '$shared/sources';
  import type { FileChange } from '$lib/provider';
  import { navigate } from '$lib/router.svelte';
  import { errorToast, toast, petals } from '$lib/ui.svelte';

  let { go }: { go: (d: number) => void } = $props();
  const d = draft.d;
  const app = d.app;
  const exp = (d as any).iconExport as { png: Uint8Array; fg: Uint8Array; background: string } | null;
  const preview = (d as any).iconPreview as string | null;
  let rebuild = $state(true);
  let busy = $state(false);
  let phase = $state('');
  const toolName = { revanced: 'ReVanced', morphe: 'Morphe', lspatch: 'LSPatch', none: 'No patching' }[app.tool];
  const src = sourceFor(app.tool, app.patchSourceId);
  const steps = $derived(buildSteps({ ...app, customize: { ...app.customize, icon: d.iconMode !== 'none' ? ({} as any) : undefined } }));

  function uniqueId(base: string) {
    const ids = new Set((data.config?.apps || []).map((a) => a.id));
    let id = slugify(base);
    let n = 2;
    while (ids.has(id)) id = `${slugify(base)}-${n++}`;
    return id;
  }

  async function submit() {
    busy = true;
    const repo = session.repo!;
    try {
      const id = d.editing || uniqueId(app.customize.name || app.name);
      app.id = id;
      app.updatedAt = new Date().toISOString();
      const dir = `.relevance/apps/${id}`;
      const files: FileChange[] = [];

      if (app.source.type === 'upload' && d.uploadFile) {
        phase = 'Uploading the APK to your repository…';
        const v = d.uploadMeta?.versionName || 'upload';
        const rel = await gh().createRelease(repo, `source-${id}-${v.replace(/[^\w.-]/g, '_')}`, `Source upload: ${app.name} ${v}`, 'Uploaded to Relevance as a build source. Not a published build.');
        const res = await gh().uploadAsset(repo, rel.id, `${app.packageName}-${v}.apk`.replace(/[^\w.-]/g, '_'), d.uploadFile, (p) => (phase = `Uploading the APK… ${Math.round(p * 100)}%`));
        app.source = { type: 'upload', url: res.url, uploadedVersion: v };
      }

      phase = 'Preparing files…';
      if (d.sourceIconBlob) {
        files.push({ path: `${dir}/source-icon.png`, content: new Uint8Array(await d.sourceIconBlob.arrayBuffer()) });
        app.iconUrl = `${dir}/source-icon.png`;
      }
      if (d.iconMode !== 'none' && exp) {
        files.push({ path: `${dir}/icon.png`, content: exp.png });
        files.push({ path: `${dir}/icon-fg.png`, content: exp.fg });
        files.push({ path: `${dir}/icon.json`, content: JSON.stringify({ background: exp.background }) + '\n' });
        if (d.iconMode === 'upload' && d.iconUploadBlob) files.push({ path: `${dir}/icon-base.png`, content: new Uint8Array(await d.iconUploadBlob.arrayBuffer()) });
        app.customize.icon = {
          mode: d.iconMode,
          path: `${dir}/icon.png`,
          basePath: d.iconMode === 'upload' ? `${dir}/icon-base.png` : undefined,
          edit: $state.snapshot(d.iconEdit) as any,
        };
      } else if (d.iconMode === 'none') {
        app.customize.icon = undefined;
      }
      const shots: string[] = [];
      let n = 0;
      for (const s of app.listing.screenshots) {
        if (s.startsWith('new:')) {
          const ns = d.newShots.find((x) => x.id === s.slice(4));
          if (!ns) continue;
          const ext = ns.blob.type === 'image/jpeg' ? 'jpg' : ns.blob.type === 'image/webp' ? 'webp' : 'png';
          const path = `${dir}/screenshots/${Date.now().toString(36)}-${n++}.${ext}`;
          files.push({ path, content: new Uint8Array(await ns.blob.arrayBuffer()) });
          shots.push(path);
        } else shots.push(s);
      }
      app.listing.screenshots = shots;

      phase = 'Saving to your repository…';
      const prev = data.config?.apps.find((a) => a.id === id);
      const changed = !prev || (await configHash(prev)) !== (await configHash(app as any));
      const snapshot = $state.snapshot(app) as any;
      await saveConfig(
        (cfg) => {
          const i = cfg.apps.findIndex((a) => a.id === id);
          if (i >= 0) cfg.apps[i] = snapshot;
          else cfg.apps.push(snapshot);
        },
        d.editing ? `relevance: update ${displayName(snapshot)}` : `relevance: add ${displayName(snapshot)}`,
        files,
      );

      clearPersisted();
      const editing = d.editing;
      if (!editing || (rebuild && changed) || (editing && rebuild)) {
        phase = 'Starting the build in GitHub Actions…';
        const run = await startBuild(id, true);
        petals(24);
        toast(editing ? 'Saved — rebuilding now' : `${displayName(snapshot)} added — building now`, 'success');
        navigate(run ? `/builds/${run.id}` : `/apps/${id}`, { replace: true });
        setTimeout(resetDraft, 800);
      } else {
        toast('Changes saved', 'success');
        navigate(`/apps/${id}`, { replace: true });
        setTimeout(resetDraft, 800);
      }
    } catch (e: any) {
      errorToast(e, 'Could not save');
      if (/workflow/i.test(e.message)) toast('Relevance needs the "workflow" permission — sign out and in again.', 'error');
    }
    busy = false;
    phase = '';
  }
</script>

<Hero title="Ready to plant?" subtitle="Here's everything Relevance will build. You can change any of it later." art="review" artWidth={420} compact />

<div class="grid">
  <section class="card pad blk" in:fly={{ y: 16, delay: 0 }}>
    <h3 class="title row"><Icon name="travel_explore" /> Source <a class="edit" href="./source" data-back>Edit</a></h3>
    <div class="appline">
      {#if preview}<img class="ico" src={preview} alt="" />{:else}<AppIcon src={d.iconBase} name={app.name} size={64} />{/if}
      <div>
        <div class="title">{app.customize.name || app.name}</div>
        <div class="mono muted">{app.customize.packageName || app.packageName}</div>
        {#if app.customize.packageName}<div class="mono muted small">from {app.packageName}</div>{/if}
      </div>
    </div>
    <dl>
      <dt>From</dt><dd>{sourceLabel(app.source.type)}</dd>
      <dt>Updates</dt><dd>{sourceAutoUpdates(app.source.type) ? 'Checked daily' : 'By hand'}</dd>
      {#if app.pin}<dt>Pinned</dt><dd class="mono">v{app.pin}</dd>{/if}
    </dl>
  </section>

  <section class="card pad blk" in:fly={{ y: 16, delay: 70 }}>
    <h3 class="title row"><Icon name="extension" /> {toolName} <a class="edit" href="./tool" data-back>Edit</a></h3>
    {#if app.tool === 'none'}
      <p class="muted">{needsRebuild(app) ? 'No patches — only basic modifications.' : 'Passed on exactly as released, with its original signature.'}</p>
    {:else}
      {#if src && !src.builtin}<p class="muted small">From {src.name}</p>{/if}
      <div class="chips">
        {#each app.patches as p}<span class="tag olive">{p.name}{#if p.options && Object.keys(p.options).length}<Icon name="tune" size={12} />{/if}</span>{/each}
        {#each app.customPatches.filter((c) => c.enabled) as c}<span class="tag terra">{c.name}</span>{/each}
        {#if !app.patches.length && !app.customPatches.length}<span class="muted">No {app.tool === 'lspatch' ? 'modules' : 'patches'} selected</span>{/if}
      </div>
    {/if}
  </section>

  <section class="card pad blk" in:fly={{ y: 16, delay: 140 }}>
    <h3 class="title row"><Icon name="storefront" /> Store listing <a class="edit" href="./listing" data-back>Edit</a></h3>
    <p class="sum">{app.listing.summary}</p>
    <dl>
      <dt>Category</dt><dd>{app.listing.category}</dd>
      <dt>Screenshots</dt><dd>{app.listing.screenshots.length}</dd>
    </dl>
  </section>

  <section class="card pad blk" in:fly={{ y: 16, delay: 210 }}>
    <h3 class="title row"><Icon name="play_arrow" /> Build plan</h3>
    <ol class="plan">
      {#each steps as s, i}<li style="--i:{i}"><span class="n">{i + 1}</span><span><b>{s.title}</b> <span class="muted small">— {s.subtitle}</span></span></li>{/each}
    </ol>
  </section>
</div>

{#if d.editing}
  <label class="rebuild"><input type="checkbox" bind:checked={rebuild} /> Rebuild right away</label>
{/if}
<p class="hint legal"><Icon name="info" size={16} />Builds run in your own GitHub Actions and are published under your account. You're responsible for what you build and publish.</p>
{#if phase}<div class="notice info phase" in:fly={{ y: 8 }}><Icon name="sync" class="spin" />{phase}</div>{/if}

<StepNav {go} onnext={submit} {busy} nextLabel={d.editing ? 'Save changes' : 'Add app & build'} />

<style>
  .grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
  }
  .blk {
    display: grid;
    gap: 12px;
    align-content: start;
  }
  .edit {
    margin-left: auto;
    font-size: 0.85rem;
    color: var(--terra);
    font-weight: 600;
  }
  .appline {
    display: flex;
    gap: 14px;
    align-items: center;
  }
  .ico {
    width: 64px;
    height: 64px;
    border-radius: 24%;
    box-shadow: var(--shadow-1);
  }
  dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 4px 16px;
    margin: 0;
  }
  dt {
    color: var(--muted);
  }
  dd {
    margin: 0;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .sum {
    margin: 0;
  }
  .plan {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    gap: 8px;
  }
  .plan li {
    display: flex;
    gap: 10px;
    align-items: center;
    animation: rise 0.5s var(--ease-out) both;
    animation-delay: calc(var(--i) * 60ms + 250ms);
  }
  .n {
    width: 24px;
    height: 24px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    background: var(--container);
    font: 700 0.75rem var(--mono);
    flex: 0 0 auto;
  }
  .rebuild {
    display: flex;
    gap: 8px;
    align-items: center;
    margin-top: 16px;
    font-weight: 600;
  }
  .legal {
    margin-top: 16px;
  }
  .phase {
    margin-top: 12px;
  }
  @media (max-width: 760px) {
    .grid {
      grid-template-columns: 1fr;
    }
  }
</style>
