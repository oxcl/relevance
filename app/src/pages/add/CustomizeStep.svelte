<script lang="ts">
  import { slide } from 'svelte/transition';
  import Icon from '$c/Icon.svelte';
  import Hero from '$c/Hero.svelte';
  import IconEditor from '$c/IconEditor.svelte';
  import StepNav from '$c/StepNav.svelte';
  import { draft } from '$lib/draft.svelte';
  import { data, appIconUrl } from '$lib/store.svelte';
  import { isValidPackageName } from '$shared/logic';
  import { ripple, errorToast } from '$lib/ui.svelte';
  import { exportIcon } from '$lib/iconRender';

  let { go }: { go: (d: number) => void } = $props();
  const d = draft.d;
  const app = d.app;
  let name = $state(app.customize.name || '');
  let pkg = $state(app.customize.packageName || '');
  let canvas = $state<HTMLCanvasElement>();

  // base for the editor: uploaded image > source icon
  if (d.editing && !d.iconBase) appIconUrl({ ...app, customize: {} } as any).then((u) => (d.iconBase = u));
  if (d.iconMode === 'upload' && d.iconUploadBlob) d.iconBase = URL.createObjectURL(d.iconUploadBlob);

  const pkgTaken = $derived(!!pkg && data.config?.apps.some((a) => a.id !== d.editing && (a.customize.packageName || a.packageName) === pkg));
  const pkgValid = $derived(!pkg || isValidPackageName(pkg));
  const sameAsOther = $derived(!pkg && !d.editing && data.config?.apps.some((a) => (a.customize.packageName || a.packageName) === app.packageName));

  function onUpload(f: File) {
    d.iconUploadBlob = f;
    d.iconMode = 'upload';
    d.iconBase = URL.createObjectURL(f);
    d.iconTouched = true;
  }
  function suggest() {
    pkg = `${app.packageName}.${(name || 'mod').toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 12) || 'mod'}`;
  }
  let enabled = $state(d.iconMode !== 'none');
  $effect(() => {
    void JSON.stringify(d.iconEdit);
    if (enabled && d.iconMode === 'none') d.iconMode = 'edit';
    if (!enabled) d.iconMode = 'none';
  });

  let busy = $state(false);
  async function next() {
    app.customize.name = name.trim() || undefined;
    app.customize.packageName = pkg.trim() || undefined;
    busy = true;
    try {
      (d as any).iconExport = enabled && canvas ? await exportIcon(canvas) : null;
      (d as any).iconPreview = enabled && canvas ? canvas.toDataURL('image/png') : null;
    } catch (e) {
      errorToast(e, 'Could not render the icon');
      busy = false;
      return;
    }
    busy = false;
    go(1);
  }
</script>

<Hero title="Make it yours" subtitle="Give your app a new name, identity and icon that fits your store." art="customize" artWidth={380} compact />

<div class="ids">
  <label class="field">
    <span class="label">App name</span>
    <input class="input" placeholder={app.name} bind:value={name} />
  </label>
  <label class="field">
    <span class="label">Package name</span>
    <div class="pkgrow">
      <input class="input mono" class:invalid={!pkgValid || pkgTaken} placeholder={app.packageName} bind:value={pkg} />
      <button class="btn soft sm" onclick={suggest} use:ripple><Icon name="stars" size={18} /> Suggest</button>
    </div>
  </label>
</div>
<p class="hint"><Icon name="info" size={16} />Use a different package name so variants can install side by side (e.g. the original app and this modified version). Leaving it unchanged keeps updates compatible with the original.</p>
{#if !pkgValid}<div class="notice error" transition:slide><Icon name="error" />That isn't a valid package name.</div>{/if}
{#if pkgTaken}<div class="notice error" transition:slide><Icon name="error" />Another app in your store already uses this package name.</div>{/if}
{#if sameAsOther}<div class="notice" transition:slide><Icon name="warning" />You already have a build of this app. Set a different package name to make this a separate variant.</div>{/if}

<div class="icon-head">
  <h2 class="section-title"><Icon name="palette" /> Icon</h2>
  <label class="row toggle"><input type="checkbox" bind:checked={enabled} /> Change the icon</label>
</div>
{#if enabled}
  <div transition:slide={{ duration: 400 }}>
    <IconEditor base={d.iconBase} bind:edit={d.iconEdit} bind:canvas label={name || app.name} onupload={onUpload} />
  </div>
{:else}
  <div class="card pad noicon" transition:slide>
    <Icon name="image" size={28} />
    <span class="muted">The original icon is kept. Turn on "Change the icon" to edit hue, add a badge or text, or upload your own.</span>
  </div>
{/if}

<StepNav {go} onnext={next} {busy} canNext={pkgValid && !pkgTaken} />

<style>
  .ids {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
    margin-bottom: 8px;
  }
  .pkgrow {
    display: flex;
    gap: 8px;
    align-items: center;
  }
  .notice {
    margin-top: 10px;
  }
  .icon-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: 24px;
  }
  .toggle {
    font-weight: 600;
    cursor: pointer;
  }
  .toggle input {
    width: 18px;
    height: 18px;
    accent-color: var(--olive);
  }
  .noicon {
    display: flex;
    gap: 14px;
    align-items: center;
  }
  @media (max-width: 760px) {
    .ids {
      grid-template-columns: 1fr;
    }
  }
</style>
