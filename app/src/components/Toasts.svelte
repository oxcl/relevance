<script lang="ts">
  import { flip } from 'svelte/animate';
  import { fly, scale } from 'svelte/transition';
  import { toasts, dismiss } from '$lib/ui.svelte';
  import Icon from './Icon.svelte';
</script>

<div class="toasts" aria-live="polite">
  {#each toasts as t (t.id)}
    <div class="toast {t.kind}" animate:flip={{ duration: 350 }} in:fly={{ y: 30, duration: 420, opacity: 0 }} out:scale={{ duration: 220, start: 0.9 }}>
      <Icon name={t.kind === 'error' ? 'error' : t.kind === 'success' ? 'check_circle' : 'info'} size={20} />
      <span>{t.text}</span>
      {#if t.action}
        <button class="act" onclick={() => { t.action!.run(); dismiss(t.id); }}>{t.action.label}</button>
      {/if}
      <button class="x" aria-label="Dismiss" onclick={() => dismiss(t.id)}><Icon name="close" size={18} /></button>
    </div>
  {/each}
</div>

<style>
  .toasts {
    position: fixed;
    left: 50%;
    bottom: calc(24px + env(safe-area-inset-bottom));
    transform: translateX(-50%);
    z-index: 1000;
    display: grid;
    gap: 8px;
    width: min(520px, calc(100vw - 24px));
    pointer-events: none;
  }
  @media (max-width: 860px) {
    .toasts {
      bottom: calc(92px + env(safe-area-inset-bottom));
    }
  }
  .toast {
    pointer-events: auto;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 10px 12px 16px;
    border-radius: 16px;
    background: var(--text);
    color: var(--bg);
    box-shadow: var(--shadow-3);
    font-size: 0.92rem;
  }
  .toast span {
    flex: 1;
  }
  .toast.error :global(svg:first-child) {
    color: var(--terra-c);
  }
  .toast.success :global(svg:first-child) {
    color: var(--olive-c);
  }
  .act {
    border: 0;
    background: transparent;
    color: var(--terra-c);
    font-weight: 600;
    cursor: pointer;
    padding: 6px 8px;
    border-radius: 8px;
  }
  .x {
    border: 0;
    background: transparent;
    color: inherit;
    opacity: 0.7;
    cursor: pointer;
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    border-radius: 50%;
  }
  .x:hover {
    opacity: 1;
    background: rgba(255, 255, 255, 0.1);
  }
</style>
