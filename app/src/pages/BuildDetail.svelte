<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { slide, fly, fade } from 'svelte/transition';
  import Icon from '$c/Icon.svelte';
  import AppIcon from '$c/AppIcon.svelte';
  import Progress from '$c/Progress.svelte';
  import { router } from '$lib/router.svelte';
  import { data, gh, session, appState, displayName, refresh } from '$lib/store.svelte';
  import type { Job, WorkflowRun } from '$lib/provider';
  import { buildSteps } from '$shared/logic';
  import { duration, ripple, toast, errorToast, petals, copy, timeAgo } from '$lib/ui.svelte';

  const runId = Number(router.route.params.run);
  let run = $state<WorkflowRun | null>(null);
  let jobs = $state<Job[]>([]);
  let logs = $state<Record<string, { t: number; line: string }[]>>({});
  let relayStatus = $state<Record<string, string>>({});
  let open = $state<Record<string, boolean>>({});
  let autoScroll = $state(true);
  let now = $state(Date.now());
  let ws: WebSocket | null = null;
  let live = $state(false);
  let error = $state('');
  let celebrated = false;
  const fetchedJobLogs = new Set<number>();

  const app = $derived(run?.appId ? data.config?.apps.find((a) => a.id === run!.appId) : null);
  const st = $derived(run?.appId ? appState(run.appId) : null);
  const done = $derived(run?.status === 'completed');

  const stepDefs = $derived.by(() => {
    if (run?.kind === 'publish') return [{ id: 'site', title: 'Publish to F-Droid repo', subtitle: 'Generate the index and store site' }];
    if (run?.kind === 'updates') return [{ id: 'check', title: 'Check for updates', subtitle: 'Apps, versions and patches' }];
    if (app) return buildSteps(app);
    return [
      { id: 'plan', title: 'Plan', subtitle: '' },
      { id: 'fetch', title: 'Fetch APK', subtitle: '' },
      { id: 'patch', title: 'Patch', subtitle: '' },
      { id: 'customize', title: 'Customize', subtitle: '' },
      { id: 'sign', title: 'Sign', subtitle: '' },
      { id: 'publish', title: 'Publish', subtitle: '' },
      { id: 'site', title: 'Publish to F-Droid repo', subtitle: '' },
    ];
  });

  const ghSteps = $derived(Object.fromEntries(jobs.flatMap((j) => j.steps.filter((s) => s.id).map((s) => [s.id!, { ...s, jobId: j.id }]))));

  function stepState(id: string): 'pending' | 'running' | 'success' | 'failure' | 'skipped' | 'cancelled' {
    const g = ghSteps[id];
    const r = relayStatus[id];
    if (g?.status === 'completed') {
      if (g.conclusion === 'success') return 'success';
      if (g.conclusion === 'skipped') return 'skipped';
      if (g.conclusion === 'cancelled') return 'cancelled';
      return 'failure';
    }
    if (r?.startsWith('failure')) return 'failure';
    if (r === 'success') return done ? 'success' : g ? 'success' : 'success';
    if (g?.status === 'in_progress' || r === 'running') return 'running';
    if (done) return run?.conclusion === 'cancelled' ? 'cancelled' : 'skipped';
    return 'pending';
  }
  function stepDuration(id: string) {
    const g = ghSteps[id];
    if (g?.startedAt) return (g.completedAt ? new Date(g.completedAt).getTime() : now) - new Date(g.startedAt).getTime();
    const l = logs[id];
    if (l?.length) return (stepState(id) === 'running' ? now : l[l.length - 1].t) - l[0].t;
    return undefined;
  }
  const states = $derived(stepDefs.map((s) => stepState(s.id)));
  const finishedN = $derived(states.filter((s) => s === 'success' || s === 'skipped' || s === 'failure').length);
  const runningIdx = $derived(states.indexOf('running'));
  const progress = $derived(done ? 1 : (finishedN + (runningIdx >= 0 ? 0.5 : 0)) / stepDefs.length);
  const current = $derived(runningIdx >= 0 ? stepDefs[runningIdx] : null);
  const elapsed = $derived(run ? (done ? new Date(run.updatedAt).getTime() : now) - new Date(run.runStartedAt || run.createdAt).getTime() : 0);

  // auto-expand running / failed steps
  $effect(() => {
    stepDefs.forEach((s, i) => {
      const stt = states[i];
      if (stt === 'running' && open[s.id] === undefined) open[s.id] = true;
      if (stt === 'failure' && open[s.id] === undefined) open[s.id] = true;
    });
  });

  async function poll() {
    try {
      run = await gh().getRun(session.repo!, runId);
      jobs = await gh().getJobs(session.repo!, runId);
      // fill logs from GitHub for completed jobs whose lines we don't have
      for (const j of jobs) {
        if (j.status === 'completed' && !fetchedJobLogs.has(j.id)) {
          const ids = j.steps.filter((s) => s.id).map((s) => s.id!);
          if (ids.some((id) => !logs[id]?.length)) {
            fetchedJobLogs.add(j.id);
            gh().jobLog(session.repo!, j.id).then(parseJobLog).catch(() => {});
          }
        }
      }
      if (run.status === 'completed' && !celebrated) {
        celebrated = true;
        if (run.conclusion === 'success' && run.kind === 'build' && Date.now() - new Date(run.updatedAt).getTime() < 120_000) petals();
        refresh();
      }
    } catch (e: any) {
      error = e.message;
    }
  }

  function parseJobLog(text: string) {
    let cur: string | null = null;
    const out: Record<string, { t: number; line: string }[]> = {};
    for (const raw of text.split('\n')) {
      const m = raw.match(/^(\d{4}-\d\d-\d\dT[\d:.]+Z)\s?(.*)$/);
      const t = m ? new Date(m[1]).getTime() : 0;
      let line = (m ? m[2] : raw).replace(/\r$/, '');
      const g = line.match(/^##\[group\]Run node \.relevance\/engine\.mjs (\w+)/);
      if (g) {
        cur = g[1] === 'skipped' || g[1] === 'fail' ? null : g[1];
        continue;
      }
      if (/^##\[group\]Run /.test(line)) {
        cur = null;
        continue;
      }
      if (!cur || /^##\[(endgroup|group)\]/.test(line) || /^\s+(APP|GITHUB_TOKEN|RELEVANCE_\w+|JAVA_HOME\w*):/.test(line) || /^shell: /.test(line)) continue;
      line = line.replace(/^##\[(error|warning)\]/, '! ').replace(/^::warning::/, '! ');
      (out[cur] ||= []).push({ t, line });
    }
    for (const [k, v] of Object.entries(out)) if (!logs[k]?.length || logs[k].length < v.length) logs[k] = v;
  }

  function connect() {
    if (ws || done) return;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    try {
      ws = new WebSocket(`${proto}://${location.host}/api/relay/subscribe?repo=${encodeURIComponent(session.repo!)}&run=${runId}`, ['relevance', session.token!]);
    } catch {
      return;
    }
    ws.onopen = () => (live = true);
    ws.onclose = () => {
      live = false;
      ws = null;
      if (!done) setTimeout(connect, 4000);
    };
    ws.onmessage = (m) => {
      if (m.data === 'pong') return;
      const msg = JSON.parse(m.data);
      const evs = msg.events || [];
      const fresh: Record<string, { t: number; line: string }[]> = {};
      for (const e of evs) {
        if (e.status) relayStatus[e.step] = e.status;
        if (e.line !== undefined) (fresh[e.step] ||= []).push({ t: e.t, line: e.line });
      }
      for (const [k, v] of Object.entries(fresh)) logs[k] = msg.type === 'backlog' ? v : [...(logs[k] || []), ...v];
      if (autoScroll) scrollLogs();
    };
  }

  async function scrollLogs() {
    await tick();
    document.querySelectorAll<HTMLElement>('.log.live').forEach((el) => (el.scrollTop = el.scrollHeight));
  }

  onMount(() => {
    poll().then(connect);
    const p = setInterval(() => !done && poll(), 3500);
    const c = setInterval(() => (now = Date.now()), 1000);
    const ping = setInterval(() => ws?.readyState === 1 && ws.send('ping'), 25000);
    return () => {
      clearInterval(p);
      clearInterval(c);
      clearInterval(ping);
      ws?.close();
      ws = null;
    };
  });

  async function cancel() {
    try {
      await gh().cancelRun(session.repo!, runId);
      toast('Cancelling…');
      setTimeout(poll, 2000);
    } catch (e) {
      errorToast(e);
    }
  }
  const fmtT = (t: number) => (t ? new Date(t).toLocaleTimeString([], { hour12: false }) : '');
  const cls = (l: string) => (/^✓/.test(l) ? 'ok' : /^(✗|Error|error:|Exception)/.test(l) ? 'err' : /^!/.test(l) ? 'warn' : /^>/.test(l) ? 'cmd' : /^…/.test(l) ? 'prog' : '');
  const lastLine = (id: string) => logs[id]?.filter((l) => l.line.trim()).slice(-1)[0]?.line;
  const title = $derived(run?.kind === 'publish' ? 'Store publish' : run?.kind === 'updates' ? 'Update check' : app ? displayName(app) : run?.appId || 'Build');
</script>

<a class="crumb" href="/builds" data-back><Icon name="arrow_back" size={20} /> Builds <span class="muted">/ #{runId}</span></a>

{#if !run}
  {#if error}<div class="notice error"><Icon name="error" />{error}</div>{:else}<div class="skel" style="height:140px"></div>{/if}
{:else}
  <section class="head">
    <div class="who">
      {#if app}<AppIcon {app} size={92} vt="icon-{app.id}" />{:else}<span class="ph"><Icon name={run.kind === 'publish' ? 'storefront' : 'sync'} size={40} /></span>{/if}
      <div>
        <h1 class="display name">{title}</h1>
        {#if run.kind === 'build'}
          <div class="vers mono">
            <span>{st?.current && (!done || run.conclusion !== 'success') ? `v${st.current.version}` : st?.releases[1] ? `v${st.releases[1].version}` : 'new'}</span>
            <Icon name="arrow_forward" size={18} />
            <span>{st?.targetVersion ? `v${st.targetVersion}` : 'latest'}{app?.customize.name || app?.tool !== 'none' ? '-mod' : ''}</span>
          </div>
        {/if}
      </div>
    </div>
    <img class="art mill" src="/art/{done && run.conclusion === 'success' ? 'build-ok' : 'builds'}.webp" alt="" />
  </section>

  <div class="status">
    <div class="pbar">
      <Progress value={progress} tone={run.conclusion === 'failure' ? 'terra' : 'olive'} />
      <div class="meta muted">
        <span class="row"><Icon name="schedule" size={18} /> {done ? 'Took' : 'Running for'} {duration(elapsed)}</span>
        <span>·</span>
        {#if done}
          <span class="row concl {run.conclusion}"><Icon name={run.conclusion === 'success' ? 'check_circle' : run.conclusion === 'cancelled' ? 'block' : 'error'} size={18} fill /> {run.conclusion === 'success' ? 'Finished' : run.conclusion === 'cancelled' ? 'Cancelled' : 'Failed'}</span>
        {:else}
          <span class="row"><span class="spinner"></span> {current ? current.title + '…' : run.status === 'queued' ? 'Waiting for a runner…' : 'Setting up…'}</span>
          {#if live}<span class="tag olive live" in:fade><span class="dot"></span>Live</span>{/if}
        {/if}
      </div>
    </div>
    <div class="acts">
      {#if !done}<button class="btn terra" onclick={cancel} use:ripple><Icon name="close" /> Cancel build</button>{/if}
      <a class="btn outlined" href={run.htmlUrl} target="_blank" rel="noreferrer"><Icon name="github" size={18} /> On GitHub</a>
    </div>
  </div>

  {#if done && run.conclusion === 'success' && run.kind === 'build' && st?.current}
    <div class="notice success done" in:fly={{ y: 10 }}>
      <Icon name="celebration" />
      <span><b>{app ? displayName(app) : 'App'} v{st.current.version}</b> is published. It appears in your F-Droid repository and store once the publish step finishes.</span>
      <a class="btn sm" href={st.current.url} data-native><Icon name="download" size={18} /> APK</a>
    </div>
  {/if}
  {#if done && run.conclusion === 'failure' && st?.attention}
    <div class="notice error done" in:fly={{ y: 10 }}><Icon name="error" /><span>{st.attention.details?.[0] || st.attention.message} The last good build stays published.</span></div>
  {/if}

  <div class="steps">
    {#each stepDefs as s, i (s.id)}
      {@const stt = states[i]}
      <section class="step {stt}" style="--i:{i}">
        <button class="sh" onclick={() => (open[s.id] = !open[s.id])} aria-expanded={!!open[s.id]}>
          <span class="si">
            {#if stt === 'success'}<Icon name="check" size={18} />{:else if stt === 'failure'}<Icon name="close" size={18} />{:else if stt === 'running'}<span class="ring"></span>{:else if stt === 'skipped' || stt === 'cancelled'}<Icon name="remove" size={16} />{/if}
          </span>
          <span class="st">{s.title}</span>
          <span class="ss muted">{stt === 'running' ? lastLine(s.id) || s.subtitle : stt === 'skipped' ? 'Skipped' : (stt === 'success' && lastLine(s.id)) || s.subtitle}</span>
          <span class="sd mono muted">{stt === 'running' ? `Running · ${duration(stepDuration(s.id))}` : stepDuration(s.id) !== undefined ? duration(stepDuration(s.id)) : '—'}</span>
          <Icon name={open[s.id] ? 'keyboard_arrow_up' : 'keyboard_arrow_down'} />
        </button>
        {#if open[s.id]}
          <div class="body" transition:slide={{ duration: 300 }}>
            <div class="logbar">
              <label class="chk"><input type="checkbox" bind:checked={autoScroll} /> Auto-scroll</label>
              <button class="btn soft sm" onclick={() => copy((logs[s.id] || []).map((l) => l.line).join('\n'), 'Log copied')}><Icon name="content_copy" size={16} /> Copy</button>
            </div>
            <div class="log" class:live={stt === 'running'}>
              {#each logs[s.id] || [] as l, k (k)}
                <div class="ll {cls(l.line)}"><span class="ts">[{fmtT(l.t)}]</span><span class="tx">{l.line}</span></div>
              {:else}
                <div class="ll muted">{stt === 'pending' ? 'Waiting to start…' : stt === 'running' ? 'Connecting to the live log…' : stt === 'skipped' ? 'This step was skipped.' : 'The log will appear here when GitHub makes it available.'}</div>
              {/each}
              {#if stt === 'running'}<span class="cursor"></span>{/if}
            </div>
          </div>
        {/if}
      </section>
    {/each}
  </div>
  <p class="muted small foot">Started {timeAgo(run.runStartedAt || run.createdAt)} · triggered by {run.event === 'schedule' ? 'the daily check' : run.event}</p>
{/if}

<style>
  .crumb {
    display: inline-flex;
    gap: 6px;
    align-items: center;
    text-decoration: none;
    color: var(--text-2);
    font-weight: 500;
    margin: 6px 0 8px;
  }
  .head {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: 170px;
  }
  .who {
    display: flex;
    gap: 22px;
    align-items: center;
    position: relative;
    z-index: 1;
  }
  .ph {
    width: 92px;
    height: 92px;
    border-radius: 24%;
    display: grid;
    place-items: center;
    background: var(--container);
  }
  .name {
    font-size: clamp(1.8rem, 4vw, 2.7rem);
  }
  .vers {
    display: inline-flex;
    gap: 12px;
    align-items: center;
    margin-top: 8px;
    padding: 6px 14px;
    border-radius: 12px;
    background: var(--container);
    font-size: 1.05rem;
  }
  .mill {
    position: absolute;
    right: -10px;
    top: -30px;
    z-index: 0;
    width: min(340px, 34%);
    animation: rise 1s var(--ease-out), sway 10s ease-in-out infinite;
  }
  .status {
    display: flex;
    gap: 20px;
    align-items: center;
    margin: 14px 0 18px;
    position: relative;
    z-index: 1;
  }
  .pbar {
    flex: 1;
    display: grid;
    gap: 10px;
  }
  .pbar :global(.bar) {
    height: 16px;
  }
  .meta {
    display: flex;
    gap: 10px;
    align-items: center;
    flex-wrap: wrap;
  }
  .concl.success {
    color: var(--success);
  }
  .concl.failure {
    color: var(--error);
  }
  .spinner {
    width: 16px;
    height: 16px;
    border-radius: 50%;
    border: 2.5px dotted var(--olive);
    animation: spin 2s linear infinite;
  }
  .live {
    gap: 6px;
  }
  .live .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--success);
    animation: pulse-dot 1.4s infinite;
  }
  .acts {
    display: flex;
    gap: 8px;
  }
  .done {
    position: relative;
    z-index: 1;
    margin-bottom: 16px;
    align-items: center;
  }
  .done span {
    flex: 1;
  }
  .steps {
    position: relative;
    z-index: 1;
    display: grid;
    gap: 10px;
  }
  .step {
    border-radius: 20px;
    background: var(--surface);
    border: 1px solid var(--outline);
    box-shadow: var(--shadow-1);
    overflow: hidden;
    animation: rise 0.5s var(--ease-out) both;
    animation-delay: calc(var(--i) * 50ms);
    transition: background 0.4s, border-color 0.4s;
  }
  .step.running {
    background: color-mix(in srgb, var(--olive-c) 30%, var(--surface));
    border-color: color-mix(in srgb, var(--olive) 40%, var(--outline));
  }
  .step.failure {
    background: color-mix(in srgb, var(--error-c) 35%, var(--surface));
    border-color: color-mix(in srgb, var(--error) 30%, var(--outline));
  }
  .sh {
    width: 100%;
    display: grid;
    grid-template-columns: 28px minmax(120px, auto) 1fr auto 24px;
    gap: 14px;
    align-items: center;
    padding: 14px 18px;
    border: 0;
    background: none;
    text-align: left;
    cursor: pointer;
  }
  .si {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    border: 2px solid var(--outline-strong);
    transition: all 0.4s var(--ease-spring);
  }
  .success .si {
    background: var(--olive);
    border-color: var(--olive);
    color: var(--on-olive);
    animation: pop 0.45s var(--ease-spring);
  }
  .failure .si {
    background: var(--error);
    border-color: var(--error);
    color: #fff;
  }
  .skipped .si,
  .cancelled .si {
    color: var(--muted);
  }
  .running .si {
    border: 0;
  }
  .ring {
    width: 26px;
    height: 26px;
    border-radius: 50%;
    border: 3px dotted var(--olive);
    animation: spin 2.2s linear infinite;
  }
  @keyframes pop {
    from {
      transform: scale(0.4);
    }
  }
  .st {
    font-weight: 700;
    font-size: 1.05rem;
  }
  .ss {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.9rem;
    min-width: 0;
  }
  .sd {
    font-size: 0.82rem;
  }
  .body {
    padding: 0 14px 14px;
  }
  .logbar {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    align-items: center;
    padding: 4px 0 8px;
  }
  .chk {
    display: flex;
    gap: 6px;
    align-items: center;
    font-size: 0.85rem;
    padding: 4px 12px;
    border-radius: 999px;
    background: var(--container);
    cursor: pointer;
  }
  .chk input {
    accent-color: var(--olive);
  }
  .log {
    max-height: 420px;
    overflow: auto;
    padding: 12px 14px;
    border-radius: 14px;
    background: color-mix(in srgb, var(--bg) 80%, var(--container));
    border: 1px solid var(--outline);
    font: 0.8rem/1.65 var(--mono);
  }
  .ll {
    display: flex;
    gap: 12px;
    animation: line-in 0.3s var(--ease-out);
  }
  @keyframes line-in {
    from {
      opacity: 0;
      transform: translateX(-4px);
    }
  }
  .ts {
    color: var(--muted);
    flex: 0 0 auto;
    user-select: none;
  }
  .tx {
    white-space: pre-wrap;
    word-break: break-word;
  }
  .ll.ok .tx {
    color: var(--success);
  }
  .ll.err .tx {
    color: var(--error);
    font-weight: 500;
  }
  .ll.warn .tx {
    color: var(--amber);
  }
  .ll.cmd .tx {
    color: var(--text-2);
  }
  .ll.prog .tx {
    color: var(--olive-text);
  }
  .cursor {
    display: inline-block;
    width: 8px;
    height: 14px;
    background: var(--text);
    animation: blink 1s steps(1) infinite;
    margin-left: 92px;
  }
  @keyframes blink {
    50% {
      opacity: 0;
    }
  }
  .foot {
    margin-top: 16px;
  }
  @media (max-width: 760px) {
    .mill {
      opacity: 0.35;
      width: 60%;
    }
    .status {
      flex-direction: column;
      align-items: stretch;
    }
    .sh {
      grid-template-columns: 28px 1fr auto 24px;
    }
    .ss {
      display: none;
    }
    .cursor {
      margin-left: 0;
    }
  }
</style>
