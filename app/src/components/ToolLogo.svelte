<script lang="ts">
  import Icon from './Icon.svelte';
  let { tool, size = 48 }: { tool: string; size?: number } = $props();
  const src: Record<string, string> = { revanced: '/logos/revanced.svg', morphe: '/logos/morphe.svg', lspatch: '/logos/lspatch.png' };
</script>

{#if src[tool]}
  <img class="tl" src={src[tool]} alt="" width={size} height={size} style="width:{size}px;height:{size}px" />
{:else}
  <span class="tl none" style="width:{size}px;height:{size}px"><Icon name="eco" size={size * 0.55} fill /></span>
{/if}

<style>
  .tl {
    flex: 0 0 auto;
    display: grid;
    place-items: center;
    border-radius: 26%;
    object-fit: cover;
    background: var(--surface);
  }
  .none {
    background: var(--olive-c);
    color: var(--olive-text);
  }
</style>
