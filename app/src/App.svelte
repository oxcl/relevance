<script lang="ts">
  import { onMount } from 'svelte';
  import { fly, fade, scale } from 'svelte/transition';
  import { router, navigate, initRouter, definePatterns } from '$lib/router.svelte';
  import { session, data, initSession, refresh, ensureEngine, attentionItems, runningBuilds, signOut, loadServerConfig, displayName } from '$lib/store.svelte';
  import { setTheme, theme, isDark, toast, ripple, timeAgo } from '$lib/ui.svelte';
  import Icon from '$c/Icon.svelte';
  import Toasts from '$c/Toasts.svelte';
  import Landing from './pages/Landing.svelte';
  import AuthCallback from './pages/AuthCallback.svelte';
  import Setup from './pages/Setup.svelte';
  import Dashboard from './pages/Dashboard.svelte';
  import Apps from './pages/Apps.svelte';
  import AppDetail from './pages/AppDetail.svelte';
  import AddApp from './pages/AddApp.svelte';
  import Builds from './pages/Builds.svelte';
  import BuildDetail from './pages/BuildDetail.svelte';
  import PatchSources from './pages/PatchSources.svelte';
  import Settings from './pages/Settings.svelte';
  import Recipe from './pages/Recipe.svelte';
  import NotFound from './pages/NotFound.svelte';

  definePatterns([
    ['landing', '/'],
    ['auth', '/auth'],
    ['setup', '/setup'],
    ['dashboard', '/dashboard'],
    ['apps', '/apps'],
    ['edit', '/apps/:id/edit/:step?'],
    ['app', '/apps/:id'],
    ['add', '/add/:step?'],
    ['builds', '/builds'],
    ['build', '/builds/:run'],
    ['patches', '/patches'],
    ['settings', '/settings'],
    ['recipe', '/recipe'],
  ]);

  const pages: Record<string, any> = {
    landing: Landing,
    auth: AuthCallback,
    setup: Setup,
    dashboard: Dashboard,
    apps: Apps,
    app: AppDetail,
    edit: AddApp,
    add: AddApp,
    builds: Builds,
    build: BuildDetail,
    patches: PatchSources,
    settings: Settings,
    recipe: Recipe,
    notfound: NotFound,
  };
  const publicRoutes = new Set(['landing', 'auth', 'notfound', 'recipe']);
  const chromeless = new Set(['landing', 'auth', 'setup']);

  const nav = [
    { name: 'dashboard', href: '/dashboard', label: 'Dashboard', icon: 'home', match: ['dashboard'] },
    { name: 'apps', href: '/apps', label: 'Apps', icon: 'apps', match: ['apps', 'app', 'edit', 'add'] },
    { name: 'builds', href: '/builds', label: 'Builds', icon: 'play_arrow', match: ['builds', 'build'] },
    { name: 'patches', href: '/patches', label: 'Patches', icon: 'extension', match: ['patches'] },
    { name: 'settings', href: '/settings', label: 'Settings', icon: 'settings', match: ['settings'] },
  ];

  let bellOpen = $state(false);
  let userOpen = $state(false);
  const name = $derived(router.route.name);
  const Page = $derived(pages[name] || NotFound);
  const showChrome = $derived(session.status === 'ready' && !chromeless.has(name));
  const attention = $derived(data.config?.settings.notifications.inApp !== false ? attentionItems() : []);
  const running = $derived(runningBuilds());
  const badge = $derived(attention.length + running.length);

  // routing guards
  $effect(() => {
    const st = session.status;
    const n = router.route.name;
    if (st === 'signed-out' && !publicRoutes.has(n)) navigate('/', { replace: true });
    else if (st === 'needs-setup' && n !== 'setup' && n !== 'auth' && n !== 'recipe') navigate('/setup', { replace: true });
    else if (st === 'ready' && (n === 'landing' || n === 'setup')) navigate('/dashboard', { replace: true });
  });

  // polling
  let lastRunning = 0;
  $effect(() => {
    if (session.status !== 'ready') return;
    const fast = running.length > 0;
    const t = setInterval(
      () => {
        const nowRunning = runningBuilds().length;
        refresh({ states: !fast || nowRunning !== lastRunning });
        lastRunning = nowRunning;
      },
      fast ? 7000 : 60000,
    );
    return () => clearInterval(t);
  });

  onMount(() => {
    initRouter();
    loadServerConfig();
    initSession().then(async () => {
      if (session.status === 'ready' && data.config) {
        try {
          if (await ensureEngine()) toast('Build engine updated in your repository', 'success');
        } catch (e: any) {
          if (/workflow/i.test(e.message)) toast('Sign in again to let Relevance update its workflows', 'error');
        }
      }
    });
    const vis = () => document.visibilityState === 'visible' && session.status === 'ready' && refresh();
    document.addEventListener('visibilitychange', vis);
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        bellOpen = false;
        userOpen = false;
      }
    };
    addEventListener('keydown', key);
    return () => {
      document.removeEventListener('visibilitychange', vis);
      removeEventListener('keydown', key);
    };
  });

  function toggleTheme(e: MouseEvent) {
    setTheme(isDark() ? 'light' : 'dark', { x: e.clientX, y: e.clientY });
  }
</script>

<svelte:window onclick={() => ((bellOpen = false), (userOpen = false))} />

{#if session.status === 'idle' || (session.status === 'loading' && !publicRoutes.has(name))}
  <div class="boot" out:fade={{ duration: 300 }}>
    <img src="/logo.svg" alt="" class="boot-logo" />
    <div class="boot-text">Gathering your garden…</div>
  </div>
{:else if showChrome}
  <div class="shell">
    <aside class="rail">
      <a class="brand" href="/dashboard" aria-label="Relevance home">
        <img src="/logo.svg" alt="" width="40" height="40" />
        <span>Relevance</span>
      </a>
      <a class="btn terra add" href="/add" use:ripple><Icon name="add" /> Add app</a>
      <nav>
        {#each nav as n, i}
          {@const active = n.match.includes(name)}
          <a href={n.href} class="nav-item" class:active style="--i:{i}" use:ripple aria-current={active ? 'page' : undefined}>
            <span class="ind"></span>
            <Icon name={n.icon} fill={active} />
            <span>{n.label}</span>
            {#if n.name === 'builds' && running.length}<span class="live-dot" title="{running.length} running"></span>{/if}
          </a>
        {/each}
      </nav>
      <div class="spacer"></div>
      {#if session.repo}
        <a class="repo" href="https://github.com/{session.repo}" target="_blank" rel="noreferrer">
          <Icon name="github" size={22} />
          <span class="repo-text">
            <span class="mono">{session.repo.split('/')[1]}</span>
            <span class="conn"><span class="dot"></span>Connected</span>
          </span>
          <Icon name="open_in_new" size={16} />
        </a>
      {/if}
    </aside>

    <header class="topbar">
      <a class="brand mobile" href="/dashboard"><img src="/logo.svg" alt="" width="32" height="32" /><span>Relevance</span></a>
      <div class="spacer"></div>
      <div class="actions" role="toolbar">
        <button class="icon-btn" aria-label="Toggle dark mode" onclick={toggleTheme}>
          {#key theme.pref + String(isDark())}<span in:scale={{ duration: 400, start: 0.3 }}><Icon name={isDark() ? 'light_mode' : 'dark_mode'} /></span>{/key}
        </button>
        <div class="pop-anchor">
          <button class="icon-btn" class:ringing={badge > 0} aria-label="Notifications" onclick={(e) => { e.stopPropagation(); bellOpen = !bellOpen; userOpen = false; }}>
            <Icon name={badge ? 'notifications_active' : 'notifications'} fill={bellOpen} />
            {#if badge}<span class="badge" in:scale={{ start: 0.2, duration: 400 }}>{badge}</span>{/if}
          </button>
          {#if bellOpen}
            <div class="popover" role="dialog" aria-label="Notifications" onclick={(e) => e.stopPropagation()} onkeydown={() => {}} tabindex="-1" transition:fly={{ y: -8, duration: 260 }}>
              <div class="pop-title">Notifications</div>
              {#each running as r (r.id)}
                <a class="note" href="/builds/{r.id}" onclick={() => (bellOpen = false)}>
                  <span class="note-ic plum"><Icon name="sync" size={18} /></span>
                  <span><b>Building {data.config?.apps.find((a) => a.id === r.appId) ? displayName(data.config.apps.find((a) => a.id === r.appId)!) : r.appId}</b><br /><span class="muted small">Started {timeAgo(r.runStartedAt || r.createdAt)}</span></span>
                </a>
              {/each}
              {#each attention as a (a.appId)}
                <a class="note" href="/apps/{a.appId}" onclick={() => (bellOpen = false)}>
                  <span class="note-ic terra"><Icon name="warning" size={18} /></span>
                  <span><b>{a.title}</b><br /><span class="muted small">{a.message}</span></span>
                </a>
              {/each}
              {#if !badge}
                <div class="empty-note"><img src="/art/empty.webp" alt="" class="art" /><span class="muted">All calm. Nothing needs you.</span></div>
              {/if}
            </div>
          {/if}
        </div>
        <div class="pop-anchor">
          <button class="avatar" aria-label="Account" onclick={(e) => { e.stopPropagation(); userOpen = !userOpen; bellOpen = false; }}>
            {#if session.user?.avatarUrl}<img src={session.user.avatarUrl} alt="" />{:else}{session.user?.login?.[0]}{/if}
          </button>
          {#if userOpen}
            <div class="popover user" onclick={(e) => e.stopPropagation()} onkeydown={() => {}} role="menu" tabindex="-1" transition:fly={{ y: -8, duration: 260 }}>
              <div class="who">
                <img src={session.user?.avatarUrl} alt="" />
                <div><b>{session.user?.name || session.user?.login}</b><div class="muted small mono">@{session.user?.login}</div></div>
              </div>
              <div class="seg" role="radiogroup" aria-label="Theme">
                {#each [['system', 'contrast'], ['light', 'light_mode'], ['dark', 'dark_mode']] as [k, ic]}
                  <button class:on={theme.pref === k} onclick={(e) => setTheme(k as any, { x: e.clientX, y: e.clientY })}><Icon name={ic} size={18} />{k}</button>
                {/each}
              </div>
              <a class="menu-item" href="/settings" onclick={() => (userOpen = false)}><Icon name="settings" size={20} />Settings</a>
              <button class="menu-item" onclick={() => { signOut(); navigate('/'); }}><Icon name="logout" size={20} />Sign out</button>
            </div>
          {/if}
        </div>
      </div>
    </header>

    <main class="content" style="view-transition-name: page">
      {#key router.route.path}
        <Page />
      {/key}
    </main>

    <nav class="bottom">
      {#each nav as n}
        {@const active = n.match.includes(name)}
        <a href={n.href} class:active aria-current={active ? 'page' : undefined}>
          <span class="pill"><Icon name={n.icon} fill={active} />{#if n.name === 'builds' && running.length}<span class="live-dot"></span>{/if}</span>
          <span class="lbl">{n.label}</span>
        </a>
      {/each}
    </nav>
    {#if name !== 'add' && name !== 'edit'}
      <a class="fab" href="/add" aria-label="Add app" use:ripple in:scale={{ duration: 400, start: 0.4 }}><Icon name="add" size={26} /></a>
    {/if}
  </div>
{:else}
  <main style="view-transition-name: page">
    {#key router.route.path}
      <Page />
    {/key}
  </main>
{/if}

<Toasts />

<style>
  .boot {
    position: fixed;
    inset: 0;
    display: grid;
    place-items: center;
    align-content: center;
    gap: 16px;
  }
  .boot-logo {
    width: 72px;
    height: 72px;
    animation: grow 1.6s var(--ease-spring) infinite alternate;
  }
  @keyframes grow {
    from {
      transform: scale(0.86) rotate(-6deg);
    }
    to {
      transform: scale(1.04) rotate(4deg);
    }
  }
  .boot-text {
    color: var(--muted);
    animation: fade 1s 0.3s both;
  }

  .shell {
    min-height: 100dvh;
    display: grid;
    grid-template-columns: var(--rail) minmax(0, 1fr);
    grid-template-rows: auto 1fr;
    grid-template-areas: 'rail top' 'rail main';
  }
  .rail {
    grid-area: rail;
    position: sticky;
    top: 0;
    height: 100dvh;
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 22px 16px 18px;
    background: color-mix(in srgb, var(--bg-2) 70%, transparent);
    border-right: 1px solid color-mix(in srgb, var(--outline) 60%, transparent);
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 4px 10px 14px;
    text-decoration: none;
    font-weight: 900;
    font-size: 1.45rem;
    letter-spacing: -0.03em;
  }
  .brand img {
    transition: transform 0.6s var(--ease-spring);
  }
  .brand:hover img {
    transform: rotate(-12deg) scale(1.1);
  }
  .add {
    margin: 0 4px 12px;
    justify-content: flex-start;
    min-height: 50px;
    border-radius: 18px;
    box-shadow: var(--shadow-1);
  }
  nav {
    display: grid;
    gap: 4px;
  }
  .nav-item {
    position: relative;
    display: flex;
    align-items: center;
    gap: 14px;
    height: 48px;
    padding: 0 18px;
    border-radius: 999px;
    color: var(--text-2);
    text-decoration: none;
    font-weight: 500;
    overflow: hidden;
    isolation: isolate;
    animation: rise 0.5s var(--ease-out) both;
    animation-delay: calc(var(--i) * 40ms);
    transition: color 0.25s;
  }
  .nav-item:hover {
    color: var(--text);
  }
  .nav-item .ind {
    position: absolute;
    inset: 0;
    border-radius: inherit;
    background: var(--olive-c);
    transform: scaleX(0.3);
    opacity: 0;
    z-index: -1;
    transition:
      transform 0.45s var(--ease-spring),
      opacity 0.25s;
  }
  .nav-item:hover .ind {
    opacity: 0.45;
    transform: scaleX(1);
  }
  .nav-item.active {
    color: var(--on-olive-c);
    font-weight: 700;
  }
  .nav-item.active .ind {
    opacity: 1;
    transform: scaleX(1);
  }
  .nav-item.active :global(svg) {
    transform: scale(1.08);
  }
  .live-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--terra);
    margin-left: auto;
    animation: pulse-dot 1.4s infinite;
  }
  .repo {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px;
    border-radius: 18px;
    text-decoration: none;
    color: var(--text-2);
    border-top: 1px solid var(--outline);
    transition: background 0.2s;
  }
  .repo:hover {
    background: var(--container);
  }
  .repo-text {
    display: grid;
    flex: 1;
    min-width: 0;
  }
  .repo-text .mono {
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--text);
  }
  .conn {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 0.78rem;
    color: var(--muted);
  }
  .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--success);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--success) 25%, transparent);
  }

  .topbar {
    grid-area: top;
    position: sticky;
    top: 0;
    z-index: 20;
    display: flex;
    align-items: center;
    padding: 12px clamp(16px, 3vw, 36px) 0;
    pointer-events: none;
  }
  .topbar > * {
    pointer-events: auto;
  }
  .brand.mobile {
    display: none;
  }
  .actions {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--surface) 75%, transparent);
    backdrop-filter: blur(14px);
    box-shadow: var(--shadow-1);
  }
  .pop-anchor {
    position: relative;
  }
  .badge {
    position: absolute;
    top: 4px;
    right: 3px;
    min-width: 17px;
    height: 17px;
    padding: 0 4px;
    border-radius: 999px;
    background: var(--terra);
    color: var(--on-terra);
    font: 700 0.68rem/17px var(--font);
    text-align: center;
  }
  .ringing :global(svg) {
    animation: ring 2.6s ease-in-out infinite;
    transform-origin: 50% 10%;
  }
  @keyframes ring {
    0%,
    80%,
    100% {
      transform: rotate(0);
    }
    84% {
      transform: rotate(14deg);
    }
    88% {
      transform: rotate(-12deg);
    }
    92% {
      transform: rotate(8deg);
    }
    96% {
      transform: rotate(-4deg);
    }
  }
  .avatar {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    border: 0;
    padding: 0;
    overflow: hidden;
    cursor: pointer;
    background: var(--olive);
    color: var(--on-olive);
    font-weight: 700;
    transition: transform 0.3s var(--ease-spring), box-shadow 0.3s;
  }
  .avatar:hover {
    transform: scale(1.08);
    box-shadow: 0 0 0 3px var(--olive-c);
  }
  .avatar img {
    width: 100%;
    height: 100%;
  }
  .popover {
    position: absolute;
    right: 0;
    top: calc(100% + 10px);
    width: min(380px, calc(100vw - 24px));
    max-height: 70vh;
    overflow: auto;
    padding: 10px;
    border-radius: 24px;
    background: var(--surface);
    box-shadow: var(--shadow-3);
    border: 1px solid var(--outline);
    z-index: 30;
  }
  .popover.user {
    width: 270px;
  }
  .pop-title {
    font-weight: 800;
    padding: 8px 10px 10px;
  }
  .note {
    display: flex;
    gap: 12px;
    padding: 10px;
    border-radius: 16px;
    text-decoration: none;
    transition: background 0.2s;
    line-height: 1.35;
  }
  .note:hover {
    background: var(--container);
  }
  .note-ic {
    flex: 0 0 auto;
    width: 34px;
    height: 34px;
    display: grid;
    place-items: center;
    border-radius: 12px;
  }
  .note-ic.terra {
    background: var(--terra-c);
    color: var(--on-terra-c);
  }
  .note-ic.plum {
    background: var(--plum-c);
    color: var(--plum);
  }
  .note-ic.plum :global(svg) {
    animation: spin 1.6s linear infinite;
  }
  .empty-note {
    display: grid;
    justify-items: center;
    gap: 6px;
    padding: 4px 10px 16px;
  }
  .empty-note img {
    width: 120px;
  }
  .who {
    display: flex;
    gap: 10px;
    align-items: center;
    padding: 8px;
  }
  .who img {
    width: 40px;
    height: 40px;
    border-radius: 50%;
  }
  .seg {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 4px;
    padding: 4px;
    margin: 6px 4px 8px;
    background: var(--container);
    border-radius: 14px;
  }
  .seg button {
    display: grid;
    justify-items: center;
    gap: 2px;
    padding: 6px 0;
    border: 0;
    background: transparent;
    border-radius: 10px;
    font-size: 0.72rem;
    text-transform: capitalize;
    cursor: pointer;
    color: var(--text-2);
    transition: background 0.25s, color 0.25s;
  }
  .seg button.on {
    background: var(--surface);
    color: var(--text);
    box-shadow: var(--shadow-1);
  }
  .menu-item {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    padding: 10px 12px;
    border: 0;
    border-radius: 12px;
    background: none;
    text-decoration: none;
    cursor: pointer;
    font-size: 0.95rem;
  }
  .menu-item:hover {
    background: var(--container);
  }

  .content {
    grid-area: main;
    width: 100%;
    max-width: 1240px;
    padding: 0 clamp(16px, 3vw, 40px) 60px;
    margin: 0 auto;
  }
  .bottom,
  .fab {
    display: none;
  }

  @media (max-width: 860px) {
    .shell {
      grid-template-columns: 1fr;
      grid-template-areas: 'top' 'main';
    }
    .rail {
      display: none;
    }
    .topbar {
      padding: 10px 16px 6px;
      background: color-mix(in srgb, var(--bg) 80%, transparent);
      backdrop-filter: blur(14px);
    }
    .brand.mobile {
      display: flex;
      font-size: 1.2rem;
      padding: 0;
    }
    .actions {
      box-shadow: none;
      background: transparent;
    }
    .content {
      padding-bottom: 120px;
    }
    .bottom {
      position: fixed;
      left: 0;
      right: 0;
      bottom: 0;
      z-index: 40;
      display: grid;
      grid-template-columns: repeat(5, 1fr);
      padding: 10px 6px calc(12px + env(safe-area-inset-bottom));
      background: color-mix(in srgb, var(--bg-2) 88%, transparent);
      backdrop-filter: blur(16px);
      border-top: 1px solid var(--outline);
    }
    .bottom a {
      display: grid;
      justify-items: center;
      gap: 4px;
      text-decoration: none;
      color: var(--text-2);
      font-size: 0.72rem;
      font-weight: 500;
      -webkit-tap-highlight-color: transparent;
    }
    .bottom .pill {
      position: relative;
      display: grid;
      place-items: center;
      width: 56px;
      height: 32px;
      border-radius: 999px;
      transition: background-color 0.35s var(--ease);
    }
    .bottom .pill .live-dot {
      position: absolute;
      top: 2px;
      right: 12px;
    }
    .bottom a.active .pill {
      background: var(--olive-c);
      color: var(--on-olive-c);
      animation: pill-in 0.45s var(--ease-spring);
    }
    .bottom a.active {
      color: var(--text);
      font-weight: 700;
    }
    @keyframes pill-in {
      from {
        transform: scaleX(0.4);
      }
    }
    .fab {
      position: fixed;
      right: 18px;
      bottom: calc(92px + env(safe-area-inset-bottom));
      z-index: 41;
      display: grid;
      place-items: center;
      width: 58px;
      height: 58px;
      border-radius: 20px;
      background: var(--terra);
      color: var(--on-terra);
      box-shadow: var(--shadow-3);
      overflow: hidden;
      isolation: isolate;
      transition: transform 0.35s var(--ease-spring);
    }
    .fab:active {
      transform: scale(0.9);
    }
  }
</style>
