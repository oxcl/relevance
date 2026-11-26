<script lang="ts">
  import { fly, slide } from 'svelte/transition';
  import { flip } from 'svelte/animate';
  import Icon from '$c/Icon.svelte';
  import Hero from '$c/Hero.svelte';
  import AppCard from '$c/AppCard.svelte';
  import RunningCard from '$c/RunningCard.svelte';
  import { data, session, attentionItems, runningBuilds, appStatus, patchSources, displayName } from '$lib/store.svelte';
  import { greeting, ripple, timeAgo } from '$lib/ui.svelte';

  let filter = $state<'all' | 'active' | 'update' | 'disabled'>('all');
  const apps = $derived(data.config?.apps || []);
  const attention = $derived(attentionItems());
  const running = $derived(runningBuilds());
  const counts = $derived({
    all: apps.length,
    active: apps.filter((a) => a.enabled).length,
    update: apps.filter((a) => ['update', 'failed', 'needs-review'].includes(appStatus(a))).length,
    disabled: apps.filter((a) => !a.enabled).length,
  });
  const shown = $derived(
    apps.filter((a) =>
      filter === 'all' ? true : filter === 'active' ? a.enabled : filter === 'disabled' ? !a.enabled : ['update', 'failed', 'needs-review'].includes(appStatus(a)),
    ),
  );
  const custom = $derived(patchSources().filter((s) => !s.builtin));
  const recent = $derived(data.runs.filter((r) => r.kind === 'build' && r.status === 'completed').slice(0, 4));
  const first = $derived((session.user?.name || session.user?.login || '').split(' ')[0]);
</script>

<Hero title="{greeting()}{first ? `, ${first}` : ''}!" subtitle="Let's make your apps even better." art="dashboard" artWidth={620} />

{#if attention.length}
  <section class="attention" transition:slide>
    <h2 class="section-title"><Icon name="notifications_active" fill /> Needs attention</h2>
    <ul>
      {#each attention as a, i (a.appId)}
        <li in:fly={{ x: -12, delay: i * 60 }}>
          <span class="bullet"></span>
          <span class="msg"><b>{a.title}:</b> {a.message} <span class="when">{timeAgo(a.at)}</span></span>
          <a class="btn sm review" href="/apps/{a.appId}" use:ripple>Review</a>
        </li>
      {/each}
    </ul>
  </section>
{/if}

{#if running.length}
  <section class="card pad running" transition:slide>
    <h2 class="section-title"><Icon name="ecg_heart" /> Running now <span class="live"></span></h2>
    <div class="runs">
      {#each running as r (r.id)}
        <div animate:flip={{ duration: 300 }} transition:slide><RunningCard run={r} /></div>
      {/each}
    </div>
  </section>
{/if}

<section class="apps">
  <div class="apps-head">
    <h2 class="section-title"><Icon name="grid_view" fill /> Your apps</h2>
    <a class="btn add-btn" href="/add" use:ripple>Add app <Icon name="add" /></a>
  </div>
  <div class="chips">
    {#each [['all', 'All'], ['active', 'Active'], ['update', 'Needs update'], ['disabled', 'Disabled']] as [k, l]}
      <button class="chip" class:selected={filter === k} onclick={() => (filter = k as any)} use:ripple>
        {#if filter === k}<Icon name="check" size={16} />{/if}{l} <span class="count">{counts[k as keyof typeof counts]}</span>
      </button>
    {/each}
  </div>
  {#if !apps.length}
    <div class="empty card pad">
      <img src="/art/empty.webp" alt="" class="art" />
      <div>
        <h3 class="headline">Plant your first app</h3>
        <p class="muted">Paste a link to an app, pick patches and Relevance will build it in your GitHub Actions.</p>
        <a class="btn terra" href="/add" use:ripple><Icon name="add" /> Add your first app</a>
      </div>
    </div>
  {:else}
    <div class="grid">
      {#each shown as app, i (app.id)}
        <div animate:flip={{ duration: 400 }}><AppCard {app} {i} /></div>
      {:else}
        <p class="muted">No apps match this filter.</p>
      {/each}
    </div>
  {/if}
</section>

<div class="lower">
  <section class="card pad">
    <h2 class="section-title"><Icon name="history" /> Recent builds</h2>
    {#each recent as r (r.id)}
      {@const app = data.config?.apps.find((a) => a.id === r.appId)}
      <a class="line" href="/builds/{r.id}">
        <span class="res {r.conclusion}"><Icon name={r.conclusion === 'success' ? 'check' : r.conclusion === 'cancelled' ? 'block' : 'close'} size={16} /></span>
        <span class="grow">{app ? displayName(app) : r.appId}</span>
        <span class="muted small">{timeAgo(r.updatedAt)}</span>
      </a>
    {:else}
      <p class="muted">No builds yet.</p>
    {/each}
    <a class="btn text sm" href="/builds">All builds <Icon name="chevron_right" size={18} /></a>
  </section>
  <section class="card pad">
    <h2 class="section-title"><Icon name="extension" /> Custom patch repositories</h2>
    {#each custom as s (s.id)}
      <div class="line"><span class="tag {s.tool === 'lspatch' ? 'plum' : s.tool === 'morphe' ? 'terra' : 'olive'}">{s.tool}</span><span class="grow">{s.name}</span><span class="mono muted small ell">{s.url.replace(/^https?:\/\//, '')}</span></div>
    {:else}
      <p class="muted">Only the built-in ReVanced, Morphe and LSPosed sources so far.</p>
    {/each}
    <a class="btn text sm" href="/patches">Manage <Icon name="chevron_right" size={18} /></a>
  </section>
  {#if data.pagesUrl}
    <section class="card pad store">
      <h2 class="section-title"><Icon name="storefront" /> Your store</h2>
      <p class="muted small">Your F-Droid repository and store website, published on GitHub Pages.</p>
      <div class="wrap-row">
        <a class="btn sm" href={data.pagesUrl} target="_blank" rel="noreferrer"><Icon name="open_in_new" size={18} /> Open store</a>
        <a class="btn sm outlined" href="/settings#repository">F-Droid link</a>
      </div>
    </section>
  {/if}
</div>

<style>
  .attention {
    position: relative;
    padding: 18px 22px;
    border-radius: var(--radius-l);
    background: linear-gradient(135deg, var(--terra), color-mix(in srgb, var(--terra) 80%, #8c3a22));
    color: var(--on-terra);
    box-shadow: var(--shadow-2);
    margin-bottom: 18px;
    overflow: hidden;
  }
  .attention::after {
    content: '';
    position: absolute;
    inset: 0;
    background: radial-gradient(circle at 90% -20%, rgba(255, 255, 255, 0.2), transparent 50%);
    pointer-events: none;
  }
  .attention .section-title :global(svg) {
    color: inherit;
    animation: ring 3s ease-in-out infinite;
  }
  @keyframes ring {
    0%, 85%, 100% { transform: rotate(0); }
    88% { transform: rotate(14deg); }
    92% { transform: rotate(-10deg); }
    96% { transform: rotate(5deg); }
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 8px;
  }
  li {
    display: flex;
    gap: 12px;
    align-items: center;
  }
  .bullet {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #ffd7b5;
    flex: 0 0 auto;
  }
  .msg {
    flex: 1;
  }
  .when {
    opacity: 0.75;
    font-size: 0.82rem;
  }
  .review {
    --bg-btn: #fff8f3;
    --fg-btn: #8c3a22;
  }
  .running {
    margin-bottom: 18px;
  }
  .live {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: var(--terra);
    animation: pulse-dot 1.3s infinite;
  }
  .runs {
    display: grid;
    gap: 12px;
  }
  .apps-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .add-btn {
    margin-bottom: 14px;
  }
  .chips {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    margin-bottom: 16px;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 16px;
  }
  .empty {
    display: flex;
    gap: 24px;
    align-items: center;
  }
  .empty img {
    width: 180px;
  }
  .empty p {
    margin: 6px 0 14px;
  }
  .lower {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 16px;
    margin-top: 24px;
  }
  .line {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 6px;
    border-radius: 12px;
    text-decoration: none;
    transition: background 0.2s;
  }
  a.line:hover {
    background: var(--container);
  }
  .grow {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .ell {
    max-width: 40%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .res {
    width: 24px;
    height: 24px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    background: var(--container);
  }
  .res.success {
    background: var(--olive-c);
    color: var(--on-olive-c);
  }
  .res.failure {
    background: var(--terra-c);
    color: var(--on-terra-c);
  }
  @media (max-width: 560px) {
    .empty {
      flex-direction: column;
      text-align: center;
    }
    .grid {
      grid-template-columns: 1fr;
    }
  }
</style>
