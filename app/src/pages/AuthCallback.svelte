<script lang="ts">
  import { onMount } from 'svelte';
  import { navigate } from '$lib/router.svelte';
  import { setToken, initSession, session } from '$lib/store.svelte';

  let message = $state('Signing you in…');
  onMount(async () => {
    const p = new URLSearchParams(location.hash.slice(1));
    const token = p.get('token');
    const ret = p.get('return') || '/dashboard';
    history.replaceState(null, '', '/auth');
    if (!token) {
      message = 'Sign-in did not complete.';
      setTimeout(() => navigate('/', { replace: true }), 1500);
      return;
    }
    setToken(token);
    await initSession();
    if (session.status === 'needs-setup') navigate(ret.startsWith('/recipe') ? ret : '/setup', { replace: true });
    else if (session.status === 'ready') navigate(ret === '/' ? '/dashboard' : ret, { replace: true });
    else navigate('/', { replace: true });
  });
</script>

<div class="wrap">
  <img src="/logo.svg" alt="" width="64" height="64" />
  <p>{message}</p>
</div>

<style>
  .wrap {
    min-height: 100dvh;
    display: grid;
    place-content: center;
    justify-items: center;
    gap: 12px;
    color: var(--muted);
  }
  img {
    animation: spin 2.4s var(--ease-spring) infinite;
  }
</style>
