<script lang="ts">
  import type { Snippet } from 'svelte';
  import { parallax } from '$lib/ui.svelte';
  let {
    title,
    subtitle = '',
    art,
    artWidth = 460,
    compact = false,
    banner = false,
    children,
    eyebrow,
  }: { title: string; subtitle?: string; art: string; artWidth?: number; compact?: boolean; banner?: boolean; children?: Snippet; eyebrow?: Snippet } = $props();
</script>

<section class="hero" class:compact class:banner style="--w:{artWidth}px">
  <div class="art-wrap" aria-hidden="true">
    <img class="art" src="/art/{art}.webp" alt="" use:parallax={0.04} />
  </div>
  <div class="text">
    {#if eyebrow}<div class="eyebrow">{@render eyebrow()}</div>{/if}
    <h1 class="display">{title}</h1>
    {#if subtitle}<p class="sub">{subtitle}</p>{/if}
    {#if children}<div class="extra">{@render children()}</div>{/if}
  </div>
</section>

<style>
  .hero {
    position: relative;
    display: flex;
    align-items: center;
    min-height: 236px;
    margin: 0 0 12px;
    isolation: isolate;
  }
  .hero.compact {
    min-height: 196px;
  }
  .text {
    position: relative;
    z-index: 1;
    max-width: min(560px, 58%);
    padding: 18px 0 14px;
  }
  .display {
    animation: title-in 0.7s var(--ease-out) both;
  }
  @keyframes title-in {
    from {
      opacity: 0;
      transform: translateY(8px);
      letter-spacing: -0.01em;
    }
  }
  .sub {
    margin: 10px 0 0;
    color: var(--text-2);
    font-size: 1.05rem;
    line-height: 1.5;
    max-width: 480px;
    animation: rise 0.7s var(--ease-out) 0.12s both;
  }
  .extra {
    margin-top: 16px;
    animation: rise 0.7s var(--ease-out) 0.2s both;
  }
  .eyebrow {
    margin-bottom: 12px;
    animation: rise 0.5s var(--ease-out) both;
  }
  .art-wrap {
    position: absolute;
    z-index: 0;
    right: calc(-1 * clamp(16px, 3vw, 40px));
    top: -8px;
    bottom: -14px;
    width: min(var(--w), 50%);
    display: flex;
    align-items: center;
    justify-content: flex-end;
    pointer-events: none;
    animation: art-in 1.1s var(--ease-out) both;
  }
  .art-wrap img {
    width: 100%;
    max-height: 100%;
    object-fit: contain;
    object-position: right center;
    -webkit-mask-image: radial-gradient(ellipse 78% 76% at 58% 50%, #000 60%, transparent 100%);
    mask-image: radial-gradient(ellipse 78% 76% at 58% 50%, #000 60%, transparent 100%);
  }
  @keyframes art-in {
    from {
      opacity: 0;
      transform: translateX(16px);
    }
  }

  /* wide landscape behind the title (dashboard) */
  .banner {
    min-height: 300px;
    margin-top: -8px;
  }
  .banner .art-wrap {
    left: 18%;
    width: auto;
    top: -20px;
    bottom: -10px;
  }
  .banner .art-wrap img {
    height: 100%;
    max-height: none;
    object-fit: cover;
    object-position: right 40%;
    -webkit-mask-image: linear-gradient(90deg, transparent 0%, #000 34%), linear-gradient(180deg, #000 70%, transparent 100%);
    mask-image: linear-gradient(90deg, transparent 0%, #000 34%), linear-gradient(180deg, #000 70%, transparent 100%);
    -webkit-mask-composite: source-in;
    mask-composite: intersect;
  }

  @media (max-width: 760px) {
    .hero,
    .hero.compact {
      flex-direction: column;
      align-items: stretch;
      min-height: 0;
    }
    .text {
      max-width: 100%;
      order: 0;
      padding-bottom: 4px;
    }
    .art-wrap,
    .banner .art-wrap {
      position: relative;
      inset: auto;
      order: 1;
      width: calc(100% + 32px);
      margin: 0 -16px;
      height: 180px;
      justify-content: center;
    }
    .art-wrap img {
      height: 100%;
      width: auto;
      max-width: 100%;
    }
    .banner .art-wrap img {
      width: 100%;
      -webkit-mask-image: linear-gradient(180deg, transparent 0%, #000 20%, #000 75%, transparent 100%);
      mask-image: linear-gradient(180deg, transparent 0%, #000 20%, #000 75%, transparent 100%);
    }
  }
</style>
