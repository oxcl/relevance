<script lang="ts">
  import { flip } from 'svelte/animate';
  import Icon from '$c/Icon.svelte';
  import Hero from '$c/Hero.svelte';
  import AppCard from '$c/AppCard.svelte';
  import { data, appStatus, displayName, displayPackage } from '$lib/store.svelte';
  import { ripple } from '$lib/ui.svelte';

  let filter = $state('all');
  let q = $state('');
  const apps = $derived(data.config?.apps || []);
  const groups: [string, string, (s: string, a: any) => boolean][] = [
    ['all', 'All', () => true],
    ['ok', 'Up to date', (s) => s === 'ok'],
    ['attention', 'Needs attention', (s) => ['failed', 'needs-review', 'update'].includes(s)],
    ['building', 'Building', (s) => s === 'building'],
    ['disabled', 'Disabled', (s) => s === 'disabled'],
  ];
  const shown = $derived(
    apps.filter((a) => groups.find((g) => g[0] === filter)![2](appStatus(a), a)).filter((a) => !q || `${displayName(a)} ${displayPackage(a)}`.toLowerCase().includes(q.toLowerCase())),
  );
</script>

<Hero title="Your apps" subtitle="Everything growing in your store." art="apps" artWidth={420} compact>
  <a class="btn terra" href="/add" use:ripple><Icon name="add" /> Add app</a>
</Hero>

<div class="bar">
  <div class="chips">
    {#each groups as [k, l, f]}
      <button class="chip" class:selected={filter === k} onclick={() => (filter = k)} use:ripple>
        {#if filter === k}<Icon name="check" size={16} />{/if}{l}<span class="count">{apps.filter((a) => f(appStatus(a), a)).length}</span>
      </button>
    {/each}
  </div>
  <div class="search"><Icon name="search" size={20} /><input class="input" placeholder="Search apps" bind:value={q} /></div>
</div>

<div class="grid">
  {#each shown as app, i (app.id)}
    <div animate:flip={{ duration: 400 }}><AppCard {app} {i} /></div>
  {:else}
    <div class="empty card pad">
      <img src="/art/empty.webp" alt="" class="art" />
      <p class="muted">{apps.length ? 'No apps match.' : 'No apps yet — add your first one.'}</p>
      {#if !apps.length}<a class="btn" href="/add">Add app</a>{/if}
    </div>
  {/each}
</div>

<style>
  .bar {
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 18px;
  }
  .chips {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }
  .search {
    position: relative;
    width: min(320px, 100%);
  }
  .search :global(svg) {
    position: absolute;
    left: 12px;
    top: 13px;
    color: var(--muted);
  }
  .search .input {
    padding-left: 40px;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
    gap: 16px;
  }
  .empty {
    grid-column: 1 / -1;
    display: grid;
    justify-items: center;
    text-align: center;
  }
  .empty img {
    width: 160px;
  }
</style>
