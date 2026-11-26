<script lang="ts">
  import Icon from './Icon.svelte';
  let { status }: { status: string } = $props();
  const map: Record<string, [string, string, string]> = {
    ok: ['Up to date', 'olive', 'check_circle'],
    update: ['Update available', 'amber', 'update'],
    building: ['Building', 'plum', 'sync'],
    failed: ['Build failed', 'terra', 'error'],
    'needs-review': ['Needs review', 'amber', 'warning'],
    never: ['Not built yet', '', 'schedule'],
    disabled: ['Disabled', '', 'pause'],
  };
  const m = $derived(map[status] || map.never);
</script>

<span class="tag {m[1]} pill" class:spin={status === 'building'}><Icon name={m[2]} size={14} fill />{m[0]}</span>

<style>
  .pill {
    gap: 5px;
    animation: rise 0.4s var(--ease-out);
  }
  .spin :global(svg) {
    animation: spin 1.4s linear infinite;
  }
</style>
