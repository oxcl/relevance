<script lang="ts">
  import { onMount } from 'svelte';
  import Icon from '$c/Icon.svelte';
  import Stepper from '$c/Stepper.svelte';
  import { router, navigate, goBack } from '$lib/router.svelte';
  import { draft, resetDraft, restoreDraft, persistDraft } from '$lib/draft.svelte';
  import { data, appState, displayName, appIconUrl } from '$lib/store.svelte';
  import { freshEdit } from '$lib/iconRender';
  import SourceStep from './add/SourceStep.svelte';
  import ToolStep from './add/ToolStep.svelte';
  import PatchesStep from './add/PatchesStep.svelte';
  import CustomizeStep from './add/CustomizeStep.svelte';
  import ListingStep from './add/ListingStep.svelte';
  import ReviewStep from './add/ReviewStep.svelte';

  const ALL = [
    { id: 'source', label: 'Source', short: 'Source', comp: SourceStep },
    { id: 'tool', label: 'Tool', short: 'Tool', comp: ToolStep },
    { id: 'patches', label: 'Patches', short: 'Patches', comp: PatchesStep },
    { id: 'customize', label: 'Customize', short: 'Custom', comp: CustomizeStep },
    { id: 'listing', label: 'Store listing', short: 'Store', comp: ListingStep },
    { id: 'review', label: 'Review', short: 'Review', comp: ReviewStep },
  ];

  const editId = router.route.name === 'edit' ? router.route.params.id : null;
  const base = editId ? `/apps/${editId}/edit` : '/add';
  const fromId = !editId ? router.route.query.get('from') : null;

  // set up the draft
  if (editId) {
    if (draft.d.editing !== editId) {
      const app = data.config?.apps.find((a) => a.id === editId);
      resetDraft();
      if (app) {
        const d = draft.d;
        d.editing = editId;
        d.app = structuredClone($state.snapshot(app)) as any;
        d.app.listing ||= { summary: '', description: '', category: 'System', screenshots: [] };
        d.iconMode = app.customize.icon?.mode || 'none';
        d.iconEdit = app.customize.icon?.edit ? structuredClone($state.snapshot(app.customize.icon.edit)) as any : freshEdit();
        d.iconBase = app.iconUrl || null;
        d.visited = 5;
        d.info = { versions: null, autoUpdates: true, latest: appState(app.id).latestAvailable, name: app.name, packageName: app.packageName, iconUrl: app.iconUrl };
      }
    }
  } else if (fromId) {
    // duplicate: same app, source, tool and patches; a new name and package so both can be installed
    const orig = data.config?.apps.find((a) => a.id === fromId);
    if (orig && draft.d.cloneOf !== fromId) {
      resetDraft();
      const d = draft.d;
      d.cloneOf = fromId;
      const now = new Date().toISOString();
      d.app = { ...(structuredClone($state.snapshot(orig)) as any), id: '', createdAt: now, updatedAt: now, enabled: true };
      d.app.listing ||= { summary: '', description: '', category: 'System', screenshots: [] };
      const names = new Set((data.config?.apps || []).map((a) => displayName(a)));
      const baseName = displayName(orig).replace(/ \d+$/, '');
      let n = 2;
      while (names.has(`${baseName} ${n}`)) n++;
      d.app.customize.name = `${baseName} ${n}`;
      const pkgs = new Set((data.config?.apps || []).flatMap((a) => [a.packageName, a.customize.packageName, appState(a.id).current?.apk.split('_')[0]].filter(Boolean)));
      const basePkg = (orig.customize.packageName || orig.packageName).replace(/\.clone\d*$/, '');
      let pkg = `${basePkg}.clone`;
      for (let i = 2; pkgs.has(pkg); i++) pkg = `${basePkg}.clone${i}`;
      d.app.customize.packageName = pkg;
      d.iconMode = orig.customize.icon?.mode || 'none';
      d.iconEdit = orig.customize.icon?.edit ? (structuredClone($state.snapshot(orig.customize.icon.edit)) as any) : freshEdit();
      const basePath = orig.customize.icon?.mode === 'upload' ? orig.customize.icon.basePath : undefined;
      appIconUrl({ ...orig, customize: basePath ? { icon: { mode: 'edit', path: basePath } } : {} } as any).then((u) => (draft.d.iconBase = u));
      d.info = { versions: null, autoUpdates: true, latest: appState(orig.id).latestAvailable, name: orig.name, packageName: orig.packageName, iconUrl: orig.iconUrl };
      // jump straight to the patches, but walk through customize (it renders the new icon) before review
      const order = ALL.filter((s) => s.id !== 'patches' || orig.tool !== 'none').map((s) => s.id);
      d.visited = order.indexOf('customize') - 1;
      navigate(`/add/${orig.tool === 'none' ? 'customize' : 'patches'}`, { replace: true });
    }
  } else if (router.route.params.step === undefined && !router.route.query.has('keep')) {
    if (draft.d.editing) resetDraft();
  } else if (!draft.d.info && !draft.d.app.packageName && !draft.d.editing) {
    restoreDraft();
  }

  const steps = $derived(ALL.filter((s) => s.id !== 'patches' || draft.d.app.tool !== 'none'));
  const stepId = $derived(router.route.params.step || 'source');
  const index = $derived(Math.max(0, steps.findIndex((s) => s.id === stepId)));
  const Comp = $derived(steps[index]?.comp || SourceStep);

  // guard: can't jump past what has been completed
  $effect(() => {
    if (router.route.name !== 'add' && router.route.name !== 'edit') return;
    if (index > draft.d.visited + 1 && !draft.d.editing) navigate(`${base}/${steps[Math.min(draft.d.visited, steps.length - 1)].id}`, { replace: true });
    if (stepId === 'patches' && draft.d.app.tool === 'none') navigate(`${base}/customize`, { replace: true });
  });

  export function go(delta: number) {
    const ni = index + delta;
    if (ni < 0) return goBack(editId ? `/apps/${editId}` : '/dashboard');
    if (ni >= steps.length) return;
    if (delta > 0) draft.d.visited = Math.max(draft.d.visited, ni);
    persistDraft();
    navigate(`${base}/${steps[ni].id}`, { back: delta < 0 });
  }

  onMount(() => {
    const save = () => persistDraft();
    addEventListener('beforeunload', save);
    return () => removeEventListener('beforeunload', save);
  });
</script>

<div class="wizard">
  <div class="head">
    <a class="back" href={editId ? `/apps/${editId}` : '/dashboard'} data-back>
      <Icon name="arrow_back" />
      {editId ? `Edit ${displayName(draft.d.app)}` : draft.d.cloneOf ? 'Duplicate app' : 'Add app'}
    </a>
  </div>
  {#if draft.d.cloneOf && !editId}
    {@const orig = data.config?.apps.find((a) => a.id === draft.d.cloneOf)}
    {#if orig}
      <div class="clone-banner">
        <Icon name="content_copy" />
        <span>Duplicating <b>{displayName(orig)}</b> — same source, tool and patches. It gets its own name and package so both install side by side; change anything along the way.</span>
      </div>
    {/if}
  {/if}
  <div class="stepper">
    <Stepper
      steps={steps.map((s) => s.label)}
      compactLabels={steps.map((s) => s.short)}
      current={index}
      onjump={(i) => (i <= draft.d.visited || draft.d.editing) && navigate(`${base}/${steps[i].id}`, { back: i < index })}
    />
  </div>
  <Comp {go} />
</div>

<style>
  .wizard {
    padding-top: 4px;
  }
  .head {
    display: flex;
    align-items: center;
    margin: 0 0 14px;
  }
  .back {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    font-weight: 600;
    font-size: 1.05rem;
    text-decoration: none;
    padding: 6px 12px 6px 6px;
    border-radius: 999px;
    transition: background 0.2s;
  }
  .back:hover {
    background: var(--container);
  }
  .back:hover :global(svg) {
    transform: translateX(-3px);
  }
  .stepper {
    max-width: 880px;
    margin: 0 auto 18px;
  }
  .clone-banner {
    display: flex;
    gap: 12px;
    align-items: center;
    margin: 0 0 14px;
    padding: 12px 16px;
    border-radius: 16px;
    background: color-mix(in srgb, var(--olive-c) 55%, var(--surface));
    color: var(--text);
    animation: rise 0.5s var(--ease-out) both;
  }
  .clone-banner :global(svg) {
    color: var(--olive-text);
    flex: 0 0 auto;
  }
</style>
