<script lang="ts">
  import qrcode from 'qrcode-generator';
  let { text, size = 140 }: { text: string; size?: number } = $props();
  const svg = $derived.by(() => {
    const q = qrcode(0, 'M');
    q.addData(text);
    q.make();
    return q.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
  });
</script>

<div class="qr" style="width:{size}px;height:{size}px">{@html svg}</div>

<style>
  .qr {
    background: #fff;
    padding: 10px;
    border-radius: 16px;
    box-shadow: var(--shadow-1);
    flex: 0 0 auto;
    animation: rise 0.6s var(--ease-out);
  }
  .qr :global(svg) {
    width: 100%;
    height: 100%;
    display: block;
  }
  .qr :global(path) {
    fill: #36271d;
  }
</style>
