<script lang="ts">
  import { onMount } from 'svelte';
  import Icon from '$c/Icon.svelte';
  import Stepper from '$c/Stepper.svelte';
  import { router, navigate, goBack } from '$lib/router.svelte';
  import { draft, resetDraft, restoreDraft, persistDraft } from '$lib/draft.svelte';
  import { data, appState, displayName } from '$lib/store.svelte';
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
      {editId ? `Edit ${displayName(draft.d.app)}` : 'Add app'}
    </a>
  </div>
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
</style>
