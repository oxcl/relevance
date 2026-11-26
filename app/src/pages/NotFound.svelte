<script lang="ts">
  import { session } from '$lib/store.svelte';
</script>

<div class="nf">
  <img class="art" src="/art/notfound.webp" alt="" />
  <h1 class="display">This path doesn't lead anywhere</h1>
  <p class="muted">The page may have moved, or the app was removed.</p>
  <a class="btn" href={session.status === 'ready' ? '/dashboard' : '/'}>Back home</a>
</div>

<style>
  .nf {
    display: grid;
    justify-items: center;
    text-align: center;
    gap: 12px;
    padding: 40px 16px;
  }
  .art {
    width: min(320px, 80vw);
    animation: sway 8s ease-in-out infinite;
  }
</style>
