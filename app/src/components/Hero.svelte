<script lang="ts">
  import type { Snippet } from 'svelte';
  import { parallax } from '$lib/ui.svelte';
  let { title, subtitle = '', art, artWidth = 460, compact = false, children, eyebrow }: { title: string; subtitle?: string; art: string; artWidth?: number; compact?: boolean; children?: Snippet; eyebrow?: Snippet } = $props();
</script>

<section class="hero" class:compact>
  <div class="text">
    {#if eyebrow}<div class="eyebrow">{@render eyebrow()}</div>{/if}
    <h1 class="display">
      {#each title.split(' ') as w, i}<span class="w" style="--i:{i}">{w}</span>{' '}{/each}
    </h1>
    {#if subtitle}<p class="sub">{subtitle}</p>{/if}
    {#if children}<div class="extra">{@render children()}</div>{/if}
  </div>
  <div class="art-wrap" style="--w:{artWidth}px" aria-hidden="true">
    <img class="art sway" src="/art/{art}.webp" alt="" use:parallax={0.06} />
  </div>
</section>

<style>
  .hero {
    position: relative;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 12px;
    min-height: 220px;
    margin-bottom: 8px;
  }
  .hero.compact {
    min-height: 170px;
  }
  .text {
    position: relative;
    z-index: 1;
    padding: 12px 0;
  }
  .w {
    display: inline-block;
    animation: word 0.8s var(--ease-out) both;
    animation-delay: calc(var(--i) * 60ms + 60ms);
  }
  @keyframes word {
    from {
      opacity: 0;
      transform: translateY(0.4em) rotate(2deg);
      filter: blur(4px);
    }
  }
  .sub {
    margin: 10px 0 0;
    color: var(--text-2);
    font-size: 1.05rem;
    max-width: 520px;
    animation: rise 0.8s var(--ease-out) 0.25s both;
  }
  .extra {
    margin-top: 14px;
    animation: rise 0.8s var(--ease-out) 0.35s both;
  }
  .eyebrow {
    margin-bottom: 10px;
    animation: rise 0.6s var(--ease-out) both;
  }
  .art-wrap {
    width: var(--w);
    max-width: 46vw;
    margin: -24px -12px -18px 0;
    animation: art-in 1.2s var(--ease-out) both;
  }
  .art-wrap img {
    width: 100%;
    display: block;
  }
  .sway {
    animation: sway 9s ease-in-out infinite;
    transform-origin: 50% 90%;
  }
  @keyframes art-in {
    from {
      opacity: 0;
      transform: translateX(30px) scale(0.96);
      filter: blur(6px);
    }
  }
  @media (max-width: 760px) {
    .hero {
      grid-template-columns: 1fr;
      min-height: 0;
    }
    .art-wrap {
      order: 2;
      width: 100%;
      max-width: 100%;
      margin: -10px 0 0;
      max-height: 180px;
      display: flex;
      justify-content: center;
      overflow: visible;
    }
    .art-wrap img {
      max-height: 190px;
      width: auto;
    }
  }
</style>
