<script lang="ts">
  import { ICONS } from '$lib/icon-data';
  let { name, size = 22, fill = false, class: cls = '', style = '' }: { name: string; size?: number; fill?: boolean; class?: string; style?: string } = $props();
  const GITHUB =
    'M480-880q-166 0-283 117T80-480q0 133 77 238t200 142q15 3 21.5-4t6.5-17v-57q-84 18-110-36-16-35-36-47l-3-2q-20-14-1-15 26 2 43 31 32 55 103 31 4-26 18-42-111-13-156-74t-24-152q-16-31 4-79 0 0 34-11 92 34 80-21 40-11 81-11t81 11q46-34 80 21 34 11 34 11 20 48 4 79 21 91-24 152t-156 74q20 18 20 54v91q0 10 6.5 17t21.5 4q123-37 200-142t77-238q0-166-117-283T480-880Z';
  const d = $derived(name === 'github' ? GITHUB : (fill ? ICONS[`${name}-fill`] : undefined) ?? ICONS[name] ?? ICONS[`${name}-fill`] ?? '');
</script>

<svg class="icon {cls}" {style} width={size} height={size} viewBox="0 -960 960 960" aria-hidden="true"><path fill="currentColor" {d} /></svg>

<style>
  .icon {
    flex: 0 0 auto;
    display: block;
    transition: transform 0.3s var(--ease-spring);
  }
</style>
