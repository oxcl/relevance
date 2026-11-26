<script lang="ts">
  let { value = 0, indeterminate = false, label = false, tone = 'olive' }: { value?: number; indeterminate?: boolean; label?: boolean; tone?: 'olive' | 'terra' } = $props();
  const pct = $derived(Math.round(Math.max(0, Math.min(1, value)) * 100));
</script>

<div class="wrap">
  <div class="bar {tone}" class:indeterminate role="progressbar" aria-valuenow={pct} aria-valuemin="0" aria-valuemax="100">
    <div class="fill" style="transform:scaleX({indeterminate ? 1 : value})">
      <span class="shine"></span>
    </div>
  </div>
  {#if label && !indeterminate}<span class="pct">{pct}%</span>{/if}
</div>

<style>
  .wrap {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .bar {
    flex: 1;
    position: relative;
    height: 10px;
    border-radius: 999px;
    background: var(--container-high);
    overflow: visible;
  }
  .fill {
    position: absolute;
    inset: 0;
    border-radius: inherit;
    background: linear-gradient(90deg, color-mix(in srgb, var(--olive) 75%, #fff), var(--olive));
    transform-origin: left;
    transition: transform 0.9s var(--ease-emph);
    overflow: hidden;
  }
  .terra .fill {
    background: linear-gradient(90deg, color-mix(in srgb, var(--terra) 70%, #fff), var(--terra));
  }
  .shine {
    position: absolute;
    inset: 0;
    background: linear-gradient(100deg, transparent 20%, rgba(255, 255, 255, 0.45) 50%, transparent 80%);
    transform: translateX(-100%);
    animation: shine 1.8s ease-in-out infinite;
  }
  .indeterminate .fill {
    transform: none !important;
    background: var(--container-high);
  }
  .indeterminate .shine {
    background: linear-gradient(90deg, transparent, var(--olive), transparent);
    animation-duration: 1.3s;
  }
  @keyframes shine {
    to {
      transform: translateX(100%);
    }
  }
  .pct {
    flex: 0 0 auto;
    min-width: 3.2em;
    text-align: right;
    font: 600 0.95rem var(--font);
    font-variant-numeric: tabular-nums;
    color: var(--text);
  }
</style>
