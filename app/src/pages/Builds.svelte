<script lang="ts">
  import { onMount } from 'svelte';
  import { flip } from 'svelte/animate';
  import Icon from '$c/Icon.svelte';
  import Hero from '$c/Hero.svelte';
  import AppIcon from '$c/AppIcon.svelte';
  import RunningCard from '$c/RunningCard.svelte';
  import { data, refresh, displayName, checkUpdates, publishSite, runningBuilds } from '$lib/store.svelte';
  import { ripple, timeAgo, duration, toast, errorToast } from '$lib/ui.svelte';

  let filter = $state<'all' | 'build' | 'publish' | 'updates'>('all');
  onMount(() => refresh({ states: false }));
  const running = $derived(runningBuilds());
  const list = $derived(data.runs.filter((r) => (filter === 'all' ? r.kind !== 'other' : r.kind === filter)).filter((r) => !(r.kind === 'build' && r.status !== 'completed')));
  const label = { build: 'Build', publish: 'Publish', updates: 'Update check', other: 'Other' };
  async function act(fn: () => Promise<void>, msg: string) {
    try {
      await fn();
      toast(msg, 'success');
      setTimeout(() => refresh({ states: false }), 3000);
    } catch (e) {
      errorToast(e);
    }
  }
</script>

<Hero title="Builds" subtitle="Everything running in your GitHub Actions." art="builds" artWidth={420} compact>
  <div class="wrap-row">
    <button class="btn" onclick={() => act(() => checkUpdates(), 'Checking all apps for updates')} use:ripple><Icon name="sync" /> Check all for updates</button>
    <button class="btn outlined" onclick={() => act(publishSite, 'Republishing your store')} use:ripple><Icon name="storefront" /> Republish store</button>
  </div>
</Hero>

{#if running.length}
  <section class="card pad run">
    <h2 class="section-title"><Icon name="ecg_heart" /> Running now</h2>
    {#each running as r (r.id)}<div animate:flip><RunningCard run={r} /></div>{/each}
  </section>
{/if}

<div class="chips">
  {#each [['all', 'All'], ['build', 'Builds'], ['publish', 'Store publishes'], ['updates', 'Update checks']] as [k, l]}
    <button class="chip" class:selected={filter === k} onclick={() => (filter = k as any)} use:ripple>{#if filter === k}<Icon name="check" size={16} />{/if}{l}</button>
  {/each}
</div>

<section class="card list">
  {#each list as r, i (r.id)}
    {@const app = data.config?.apps.find((a) => a.id === r.appId)}
    <a class="row-item" href="/builds/{r.id}" animate:flip={{ duration: 300 }} style="--i:{Math.min(i, 15)}">
      <span class="res {r.status !== 'completed' ? 'running' : r.conclusion}">
        <Icon name={r.status !== 'completed' ? 'sync' : r.conclusion === 'success' ? 'check' : r.conclusion === 'cancelled' ? 'block' : r.conclusion === 'skipped' ? 'remove' : 'close'} size={16} />
      </span>
      {#if app}<AppIcon {app} size={40} />{:else}<span class="ph"><Icon name={r.kind === 'publish' ? 'storefront' : r.kind === 'updates' ? 'update' : 'deployed_code'} size={20} /></span>{/if}
      <span class="grow">
        <b>{app ? displayName(app) : r.kind === 'build' ? r.appId : label[r.kind]}</b>
        <span class="muted small">{label[r.kind]} · {r.event === 'schedule' ? 'daily' : r.event === 'workflow_dispatch' ? 'manual' : r.event} · #{r.id}</span>
      </span>
      <span class="muted small hide-s">{r.status === 'completed' ? duration(new Date(r.updatedAt).getTime() - new Date(r.runStartedAt || r.createdAt).getTime()) : r.status}</span>
      <span class="muted small">{timeAgo(r.createdAt)}</span>
      <Icon name="chevron_right" size={18} />
    </a>
  {:else}
    <div class="empty"><img src="/art/builds.webp" alt="" class="art" /><p class="muted">No runs yet. Add an app to start your first build.</p></div>
  {/each}
</section>

<style>
  .run {
    margin-bottom: 18px;
  }
  .chips {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    margin-bottom: 14px;
  }
  .list {
    padding: 6px;
  }
  .row-item {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 10px 12px;
    border-radius: 16px;
    text-decoration: none;
    animation: rise 0.45s var(--ease-out) both;
    animation-delay: calc(var(--i) * 35ms);
    transition: background 0.2s;
  }
  .row-item:hover {
    background: var(--container);
  }
  .row-item:hover :global(svg:last-child) {
    transform: translateX(3px);
  }
  .grow {
    flex: 1;
    display: grid;
    min-width: 0;
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
  .res.failure,
  .res.timed_out {
    background: var(--terra-c);
    color: var(--on-terra-c);
  }
  .res.running {
    background: var(--plum-c);
    color: var(--plum);
  }
  .res.running :global(svg) {
    animation: spin 1.3s linear infinite;
  }
  .ph {
    width: 40px;
    height: 40px;
    border-radius: 24%;
    display: grid;
    place-items: center;
    background: var(--container);
    flex: 0 0 auto;
  }
  .empty {
    display: grid;
    justify-items: center;
    padding: 20px;
  }
  .empty img {
    width: 200px;
  }
  @media (max-width: 600px) {
    .hide-s {
      display: none;
    }
  }
</style>
