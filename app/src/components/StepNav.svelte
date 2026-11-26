<script lang="ts">
  import Icon from './Icon.svelte';
  import { ripple } from '$lib/ui.svelte';
  let { go, canNext = true, nextLabel = 'Continue', busy = false, onnext }: { go: (d: number) => void; canNext?: boolean; nextLabel?: string; busy?: boolean; onnext?: () => void } = $props();
</script>

<div class="nav">
  <button class="btn tonal-terra" onclick={() => go(-1)} use:ripple><Icon name="arrow_back" /> Back</button>
  <button class="btn lg" disabled={!canNext || busy} onclick={() => (onnext ? onnext() : go(1))} use:ripple>
    {#if busy}<Icon name="sync" class="spin" />{/if}{nextLabel} <Icon name="arrow_forward" />
  </button>
</div>

<style>
  .nav {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-top: 26px;
    padding-top: 18px;
    border-top: 1px solid var(--outline);
  }
  @media (max-width: 860px) {
    .nav {
      position: sticky;
      bottom: calc(80px + env(safe-area-inset-bottom));
      z-index: 5;
      background: color-mix(in srgb, var(--bg) 88%, transparent);
      backdrop-filter: blur(12px);
      padding: 12px 0;
      margin-bottom: -12px;
    }
  }
</style>
