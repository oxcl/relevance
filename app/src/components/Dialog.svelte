<script lang="ts">
  import type { Snippet } from 'svelte';
  import Icon from './Icon.svelte';
  let {
    open = $bindable(false),
    title = '',
    icon = '',
    wide = false,
    children,
    actions,
    onclose,
  }: { open?: boolean; title?: string; icon?: string; wide?: boolean; children: Snippet; actions?: Snippet; onclose?: () => void } = $props();
  let el: HTMLDialogElement;
  let closing = $state(false);
  $effect(() => {
    if (!el) return;
    if (open && !el.open) {
      closing = false;
      el.showModal();
    } else if (!open && el.open) close();
  });
  function close() {
    if (!el?.open || closing) return;
    closing = true;
    setTimeout(() => {
      el.close();
      closing = false;
      open = false;
      onclose?.();
    }, 200);
  }
</script>

<dialog
  bind:this={el}
  class:wide
  class:closing
  oncancel={(e) => {
    e.preventDefault();
    close();
  }}
  onclick={(e) => e.target === el && close()}
>
  <div class="sheet">
    <header>
      {#if icon}<span class="ic"><Icon name={icon} size={22} /></span>{/if}
      <h2>{title}</h2>
      <button class="icon-btn" aria-label="Close" onclick={close}><Icon name="close" /></button>
    </header>
    <div class="body">{@render children()}</div>
    {#if actions}<footer>{@render actions()}</footer>{/if}
  </div>
</dialog>

<style>
  dialog {
    border: 0;
    padding: 0;
    background: transparent;
    max-width: min(560px, calc(100vw - 24px));
    width: 100%;
    max-height: min(86dvh, 860px);
    color: var(--text);
    overflow: visible;
  }
  dialog.wide {
    max-width: min(860px, calc(100vw - 24px));
  }
  dialog[open] {
    animation: dlg-in 0.42s var(--ease-out);
  }
  dialog.closing {
    animation: dlg-out 0.2s var(--ease) forwards;
  }
  dialog::backdrop {
    background: var(--scrim);
    backdrop-filter: blur(6px);
    animation: fade 0.3s var(--ease);
  }
  dialog.closing::backdrop {
    opacity: 0;
    transition: opacity 0.2s;
  }
  @keyframes dlg-in {
    from {
      opacity: 0;
      transform: translateY(24px) scale(0.94);
    }
  }
  @keyframes dlg-out {
    to {
      opacity: 0;
      transform: translateY(10px) scale(0.97);
    }
  }
  .sheet {
    display: flex;
    flex-direction: column;
    max-height: min(86dvh, 860px);
    background: var(--surface);
    border-radius: var(--radius-xl);
    box-shadow: var(--shadow-3);
    overflow: hidden;
  }
  header {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 20px 16px 10px 24px;
  }
  header h2 {
    flex: 1;
    font-size: 1.3rem;
    font-weight: 800;
  }
  .ic {
    display: grid;
    place-items: center;
    width: 40px;
    height: 40px;
    border-radius: 14px;
    background: var(--olive-c);
    color: var(--on-olive-c);
  }
  .body {
    padding: 6px 24px 20px;
    overflow: auto;
  }
  footer {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    padding: 14px 20px 18px;
    border-top: 1px solid var(--outline);
    background: var(--surface-2);
  }
  @media (max-width: 640px) {
    dialog {
      margin: auto 0 0;
      max-width: 100vw;
    }
    dialog.wide {
      max-width: 100vw;
    }
    .sheet {
      border-radius: 28px 28px 0 0;
    }
    dialog[open] {
      animation: sheet-in 0.45s var(--ease-out);
    }
    @keyframes sheet-in {
      from {
        transform: translateY(100%);
      }
    }
  }
</style>
