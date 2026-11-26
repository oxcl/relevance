<script lang="ts">
  import type { WorkflowRun, Job } from '$lib/provider';
  import Icon from './Icon.svelte';
  import AppIcon from './AppIcon.svelte';
  import Progress from './Progress.svelte';
  import { data, gh, session, appState, displayName, refresh } from '$lib/store.svelte';
  import { toast, errorToast, ripple, duration } from '$lib/ui.svelte';
  let { run }: { run: WorkflowRun } = $props();
  const app = $derived(data.config?.apps.find((a) => a.id === run.appId) || null);
  let jobs = $state<Job[]>([]);
  let now = $state(Date.now());
  $effect(() => {
    let alive = true;
    const tick = async () => {
      try {
        jobs = await gh().getJobs(session.repo!, run.id);
      } catch {}
    };
    tick();
    const t = setInterval(tick, 5000);
    const c = setInterval(() => (now = Date.now()), 1000);
    return () => {
      alive = false;
      clearInterval(t);
      clearInterval(c);
    };
  });
  const steps = $derived(jobs.flatMap((j) => j.steps.filter((s) => s.id)));
  const doneN = $derived(steps.filter((s) => s.status === 'completed').length);
  const cur = $derived(steps.find((s) => s.status === 'in_progress'));
  const progress = $derived(steps.length ? (doneN + (cur ? 0.5 : 0)) / Math.max(steps.length, 5) : 0.04);
  const curName = $derived(cur ? cur.name.replace(/\s*\[\w+\]\s*$/, '') : run.status === 'queued' ? 'Waiting for a runner' : 'Setting up');
  const st = $derived(app ? appState(app.id) : null);
  async function cancel() {
    try {
      await gh().cancelRun(session.repo!, run.id);
      toast('Cancelling the build…');
      setTimeout(() => refresh(), 3000);
    } catch (e) {
      errorToast(e);
    }
  }
</script>

<div class="run">
  <div class="who">
    {#if app}<AppIcon {app} size={56} />{:else}<span class="ph"><Icon name="deployed_code" /></span>{/if}
    <div class="min">
      <div class="title">{app ? displayName(app) : run.appId || run.displayTitle}</div>
      <div class="mono muted">
        {st?.current?.version ? `v${st.current.version}` : 'first build'}
        {#if st?.targetVersion && st.targetVersion !== st?.current?.version} → v{st.targetVersion}{/if}
      </div>
    </div>
  </div>
  <div class="step">
    <span class="muted small">Current step</span>
    {#key curName}<span class="cur">{curName}</span>{/key}
  </div>
  <div class="bar">
    <Progress value={progress} />
    <span class="muted small mono">{duration(now - new Date(run.runStartedAt || run.createdAt).getTime())}</span>
  </div>
  <div class="acts">
    <a class="btn outlined sm" href="/builds/{run.id}" use:ripple>View log</a>
    <button class="btn terra sm" onclick={cancel} use:ripple>Cancel</button>
  </div>
</div>

<style>
  .run {
    display: grid;
    grid-template-columns: minmax(180px, 1.2fr) minmax(120px, 0.8fr) minmax(140px, 1.3fr) auto;
    gap: 18px;
    align-items: center;
    padding: 6px 0;
  }
  .who {
    display: flex;
    gap: 14px;
    align-items: center;
    min-width: 0;
  }
  .min {
    min-width: 0;
  }
  .ph {
    width: 56px;
    height: 56px;
    border-radius: 24%;
    display: grid;
    place-items: center;
    background: var(--container);
  }
  .step {
    display: grid;
    border-left: 1px solid var(--outline);
    padding-left: 18px;
  }
  .cur {
    font-weight: 700;
    font-size: 1.08rem;
    animation: rise 0.5s var(--ease-out);
  }
  .bar {
    display: grid;
    gap: 6px;
  }
  .acts {
    display: flex;
    gap: 8px;
  }
  @media (max-width: 900px) {
    .run {
      grid-template-columns: 1fr;
      gap: 12px;
    }
    .step {
      border: 0;
      padding: 0;
    }
  }
</style>
