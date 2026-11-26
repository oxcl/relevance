<script lang="ts">
  import Icon from './Icon.svelte';
  let { checked = $bindable(false), disabled = false, label = '', onchange }: { checked?: boolean; disabled?: boolean; label?: string; onchange?: (v: boolean) => void } = $props();
</script>

<button
  type="button"
  role="switch"
  aria-checked={checked}
  aria-label={label}
  class="switch"
  class:on={checked}
  {disabled}
  onclick={(e) => {
    e.stopPropagation();
    checked = !checked;
    onchange?.(checked);
  }}
>
  <span class="handle">
    <span class="glyph"><Icon name={checked ? 'check' : 'close'} size={14} /></span>
  </span>
</button>

<style>
  .switch {
    position: relative;
    flex: 0 0 auto;
    width: 52px;
    height: 32px;
    border-radius: 999px;
    border: 2px solid var(--outline-strong);
    background: var(--container-high);
    cursor: pointer;
    padding: 0;
    transition: background-color 0.3s var(--ease), border-color 0.3s var(--ease);
    -webkit-tap-highlight-color: transparent;
  }
  .switch.on {
    background: var(--olive);
    border-color: var(--olive);
  }
  .switch:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .handle {
    position: absolute;
    top: 50%;
    left: 4px;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: var(--outline-strong);
    color: var(--container-high);
    display: grid;
    place-items: center;
    transform: translate(0, -50%);
    transition:
      transform 0.45s var(--ease-spring),
      width 0.3s var(--ease),
      height 0.3s var(--ease),
      left 0.3s var(--ease),
      background-color 0.3s;
  }
  .switch.on .handle {
    width: 24px;
    height: 24px;
    left: 2px;
    background: var(--on-olive);
    color: var(--olive);
    transform: translate(20px, -50%);
  }
  .switch:active .handle {
    width: 26px;
    height: 26px;
  }
  .glyph {
    opacity: 0;
    transform: scale(0.4) rotate(-45deg);
    transition: all 0.35s var(--ease-spring);
    display: grid;
  }
  .switch.on .glyph {
    opacity: 1;
    transform: none;
  }
  .switch:hover .handle::after {
    content: '';
    position: absolute;
    inset: -8px;
    border-radius: 50%;
    background: currentColor;
    opacity: 0.08;
  }
</style>
