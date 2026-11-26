<script lang="ts">
  import { onMount } from 'svelte';
  import Icon from '$c/Icon.svelte';
  import ToolLogo from '$c/ToolLogo.svelte';
  import { signInUrl, session } from '$lib/store.svelte';
  import { parallax, reveal, ripple, setTheme, isDark } from '$lib/ui.svelte';
  import { router } from '$lib/router.svelte';

  const authError = router.route.query.get('auth_error');
  const signedIn = $derived(!!session.token);
  const ctaHref = $derived(signedIn ? '/dashboard' : signInUrl());

  // the little live build in the product glimpse
  const stages = ['Fetch APK', 'Patch with Morphe', 'Customize icon', 'Sign', 'Publish to F-Droid'];
  let stage = $state(0);
  let pct = $state(8);
  onMount(() => {
    const t = setInterval(() => {
      pct += 3 + Math.random() * 6;
      if (pct >= 100) {
        pct = 6;
        stage = 0;
      } else stage = Math.min(stages.length - 1, Math.floor((pct / 100) * stages.length));
    }, 650);
    return () => clearInterval(t);
  });

  const steps = [
    { art: 'source', title: 'Point to an app', text: 'Paste a link from APKPure, F-Droid or GitHub Releases, use any APK URL, or upload one.' },
    { art: 'tool', title: 'Pick one tool', text: 'ReVanced, Morphe or LSPatch with Xposed modules. Start from the recommended patches.' },
    { art: 'customize', title: 'Make it yours', text: 'Rename it, give it its own package, and paint a new icon with badges and text.' },
    { art: 'storefront', title: 'Your own store', text: 'Builds run in your GitHub Actions and land in your F-Droid repository and store site.' },
  ];
  const tiles = [
    { name: 'YouTube', ver: 'v20.40 · Morphe', hues: ['#f2b8a2', '#e98c6f', '#c9e0a5'], status: 'Up to date' },
    { name: 'Reddit', ver: 'v2026.40 · Morphe', hues: ['#f7d2b6', '#ef9f74', '#9fc28a'], status: 'Building' },
    { name: 'Binary Eye', ver: 'v1.76 · renamed', hues: ['#cfe3b0', '#8db36a', '#f4e1b5'], status: 'Up to date' },
  ];
</script>

{#snippet tileIcon(h: string[], size: number)}
  <svg width={size} height={size} viewBox="0 0 48 48" class="mini-ic" aria-hidden="true">
    <rect width="48" height="48" rx="12" fill={h[0]} />
    <circle cx="33" cy="16" r="6" fill="#fbe7a8" />
    <path d="M0 34 C10 26 18 27 26 32 S40 30 48 26 V48 H0Z" fill={h[2]} />
    <path d="M0 40 C12 34 22 36 30 40 S42 38 48 36 V48 H0Z" fill={h[1]} opacity=".85" />
  </svg>
{/snippet}

<div class="landing">
  <header class="nav">
    <a class="brand" href="/"><img src="/logo.svg" alt="" width="36" height="36" /><span>Relevance</span></a>
    <nav class="links">
      <a href="#how">How it works</a>
      <a href="#repo">Your repository</a>
      <a href="https://github.com/oxcl/relevance" target="_blank" rel="noreferrer">Source</a>
    </nav>
    <div class="spacer"></div>
    <button class="icon-btn" aria-label="Toggle theme" onclick={(e) => setTheme(isDark() ? 'light' : 'dark', { x: e.clientX, y: e.clientY })}>
      <Icon name={isDark() ? 'light_mode' : 'dark_mode'} />
    </button>
    {#if signedIn}
      <a class="btn sm" href="/dashboard" use:ripple>Dashboard <Icon name="arrow_forward" size={18} /></a>
    {:else}
      <a class="btn sm outlined" href={signInUrl()} data-native use:ripple><Icon name="github" size={18} /> Sign in</a>
    {/if}
  </header>

  <section class="hero">
    <img class="hero-art" src="/art/welcome.webp" alt="" aria-hidden="true" use:parallax={0.05} />
    <div class="copy">
      <span class="pill"><Icon name="eco" size={15} fill /> Free · open source · runs in your GitHub</span>
      <h1>Your apps,<br />the way you like&nbsp;them.</h1>
      <p class="lede">
        Patch and personalise Android apps, build them in your own GitHub Actions, and publish them to your own F-Droid
        repository and app store. Relevance keeps every app and patch up to date for you.
      </p>
      {#if authError}<div class="notice error"><Icon name="error" /> Sign-in didn't complete ({authError}). Please try again.</div>{/if}
      <div class="cta">
        {#if signedIn}
          <a class="btn lg" href="/dashboard" use:ripple>
            {#if session.status === 'loading'}<Icon name="sync" class="spin" />{/if} Open your dashboard <Icon name="arrow_forward" />
          </a>
        {:else}
          <a class="btn lg" href={ctaHref} data-native use:ripple><Icon name="github" /> Sign in with GitHub</a>
          <a class="btn lg text" href="#how">How it works</a>
        {/if}
      </div>
      <p class="fine"><Icon name="info" size={16} /> You build and publish under your own account and are responsible for what you build.</p>
    </div>

    <div class="glimpse" aria-hidden="true">
      <div class="window">
        <div class="win-bar"><span></span><span></span><span></span><div class="url">relevance · dashboard</div></div>
        <div class="win-body">
          <aside class="win-side">
            <img src="/logo.svg" alt="" width="22" height="22" />
            <i class="on"></i><i></i><i></i><i></i>
          </aside>
          <div class="win-main">
            <div class="g-title">Good morning!</div>
            <div class="g-run">
              {@render tileIcon(tiles[1].hues, 38)}
              <div class="g-run-text">
                <b>Reddit</b>
                <span class="mono">v2026.40 → mod</span>
              </div>
              <div class="g-step">
                <span class="muted">Current step</span>
                {#key stage}<b class="g-stage">{stages[stage]}</b>{/key}
              </div>
              <div class="g-bar"><span style="transform:scaleX({pct / 100})"></span></div>
            </div>
            <div class="g-tiles">
              {#each tiles as t, i}
                <div class="g-tile" style="--i:{i}">
                  {@render tileIcon(t.hues, 34)}
                  <b>{t.name}</b>
                  <span class="mono muted">{t.ver}</span>
                  <span class="g-status" class:busy={t.status === 'Building'}>{t.status}</span>
                </div>
              {/each}
            </div>
          </div>
        </div>
      </div>
      <div class="phone">
        <div class="notch"></div>
        <div class="p-head">{@render tileIcon(tiles[0].hues, 44)}<div><b>YouTube</b><span class="mono muted">latest 20.40</span></div></div>
        <div class="p-btn">Download APK</div>
        <div class="p-row"><span>Share</span><span>Use this recipe</span></div>
        <div class="p-label">Patches applied</div>
        {#each ['Hide ads', 'Background playback', 'SponsorBlock'] as p}<div class="p-check"><Icon name="check_circle" size={14} fill />{p}</div>{/each}
        <div class="p-label">Add to F-Droid</div>
        <div class="p-qr"></div>
      </div>
    </div>
  </section>

  <section class="strip" use:reveal>
    <span><Icon name="github" size={20} /> Builds run in your GitHub Actions</span>
    <span><Icon name="lock" size={20} /> No APKs or accounts on our servers</span>
    <span><Icon name="android" size={20} /> Your own F-Droid repository</span>
    <span><Icon name="update" size={20} /> Daily, patch-aware updates</span>
  </section>

  <section class="how" id="how">
    <div class="sec-head" use:reveal>
      <span class="kicker">How it works</span>
      <h2>From a link to your own store, in four calm steps</h2>
    </div>
    <div class="steps">
      {#each steps as s, i}
        <article class="step" use:reveal={i}>
          <div class="step-art"><img class="art" src="/art/{s.art}.webp" alt="" loading="lazy" /></div>
          <span class="num">0{i + 1}</span>
          <h3>{s.title}</h3>
          <p>{s.text}</p>
        </article>
      {/each}
    </div>
    <div class="tools" use:reveal>
      <span class="muted">Works with</span>
      <span class="tool"><ToolLogo tool="revanced" size={28} /> ReVanced</span>
      <span class="tool"><ToolLogo tool="morphe" size={28} /> Morphe</span>
      <span class="tool"><ToolLogo tool="lspatch" size={28} /> LSPatch + Xposed modules</span>
    </div>
  </section>

  <section class="repo" id="repo">
    <div class="repo-copy" use:reveal>
      <span class="kicker">Yours, entirely</span>
      <h2>Everything lives in one GitHub repository you own</h2>
      <p>Relevance is a static app with a tiny bit of glue. Your apps, patches, build history, signing key and store all live in your repository, and keep working even without Relevance.</p>
      <ul>
        <li><Icon name="key" size={20} /><span><b>Your signing key</b>, generated in your browser and kept as an encrypted GitHub secret.</span></li>
        <li><Icon name="verified_user" size={20} /><span><b>Verified originals.</b> Every download's signature is checked against the developer's key.</span></li>
        <li><Icon name="notifications" size={20} /><span><b>Told when it matters</b>: a notice here, a GitHub issue, and a warning in F-Droid.</span></li>
      </ul>
    </div>
    <div class="tree card" use:reveal={1}>
      <div class="tree-head"><Icon name="github" size={18} /><span class="mono">you/my-apps</span></div>
      {#each [['description', 'relevance.json', 'apps, patches, settings'], ['folder_open', '.github/workflows/', 'build · publish · daily updates'], ['folder_open', '.relevance/', 'build engine, state, icons'], ['deployed_code', 'Releases', 'every APK you ever built'], ['public', 'GitHub Pages', 'F-Droid repo + store site']] as [ic, name, note], i}
        <div class="tree-row" style="--i:{i}"><Icon name={ic} size={18} /><span class="mono">{name}</span><span class="muted small">{note}</span></div>
      {/each}
    </div>
  </section>

  <section class="closing" use:reveal>
    <img class="art" src="/art/storefront.webp" alt="" loading="lazy" />
    <div>
      <h2>Your store, your domain, your rules.</h2>
      <p>Everything Relevance produces is static files on your GitHub Pages. Point your own domain at it, or download it as a zip anytime.</p>
      <a class="btn lg terra" href={ctaHref} data-native={!signedIn || undefined} use:ripple>{signedIn ? 'Open your dashboard' : 'Get started — it’s free'} <Icon name="arrow_forward" /></a>
    </div>
  </section>

  <footer class="foot">
    <span>Relevance is a tool. It doesn't host, distribute or store any apps.</span>
    <a href="https://github.com/oxcl/relevance" target="_blank" rel="noreferrer">Source on GitHub</a>
  </footer>
</div>

<style>
  .landing {
    max-width: 1240px;
    margin: 0 auto;
    padding: 0 clamp(16px, 4vw, 44px);
  }
  .nav {
    position: sticky;
    top: 0;
    z-index: 10;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 16px 0;
    background: linear-gradient(var(--bg) 70%, transparent);
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 10px;
    font-weight: 760;
    font-size: 1.35rem;
    letter-spacing: -0.02em;
    text-decoration: none;
    color: var(--ink);
  }
  .links {
    display: flex;
    gap: 4px;
    margin-left: 28px;
  }
  .links a {
    padding: 8px 12px;
    border-radius: 999px;
    color: var(--text-2);
    text-decoration: none;
    font-weight: 500;
    transition: background-color 0.2s, color 0.2s;
  }
  .links a:hover {
    background: var(--container);
    color: var(--text);
  }

  /* hero */
  .hero {
    position: relative;
    display: grid;
    grid-template-columns: minmax(0, 0.95fr) minmax(0, 1.05fr);
    gap: 40px;
    align-items: center;
    min-height: min(760px, 86vh);
    padding: 20px 0 40px;
  }
  .hero-art {
    position: absolute;
    z-index: 0;
    right: -8%;
    top: -4%;
    width: 72%;
    filter: var(--art-filter);
    opacity: calc(var(--art-opacity) * 0.92);
    pointer-events: none;
    -webkit-mask-image: radial-gradient(ellipse 62% 60% at 55% 48%, #000 52%, transparent 100%);
    mask-image: radial-gradient(ellipse 62% 60% at 55% 48%, #000 52%, transparent 100%);
    animation: fade 1.6s var(--ease-out) both;
  }
  .copy {
    position: relative;
    z-index: 1;
  }
  .pill {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--olive-c) 70%, transparent);
    color: var(--on-olive-c);
    font-size: 0.85rem;
    font-weight: 560;
    animation: rise 0.6s var(--ease-out) both;
  }
  h1 {
    margin: 22px 0 18px;
    font-size: clamp(2.8rem, 6vw, 4.6rem);
    font-weight: 780;
    letter-spacing: -0.035em;
    line-height: 1;
    font-variation-settings: 'opsz' 144;
    color: var(--ink);
    animation: rise 0.8s var(--ease-out) 0.05s both;
  }
  .lede {
    max-width: 540px;
    font-size: 1.14rem;
    line-height: 1.6;
    color: var(--text-2);
    animation: rise 0.8s var(--ease-out) 0.15s both;
  }
  .cta {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    margin: 28px 0 18px;
    animation: rise 0.8s var(--ease-out) 0.25s both;
  }
  .fine {
    display: flex;
    gap: 6px;
    align-items: center;
    font-size: 0.85rem;
    color: var(--muted);
    animation: fade 1s 0.5s both;
  }
  .notice {
    margin-top: 14px;
  }

  /* product glimpse */
  .glimpse {
    position: relative;
    z-index: 1;
    height: 520px;
    animation: glimpse-in 1.1s var(--ease-out) 0.2s both;
  }
  @keyframes glimpse-in {
    from {
      opacity: 0;
      transform: translateY(24px);
    }
  }
  .window {
    position: absolute;
    left: 0;
    top: 30px;
    width: 76%;
    border-radius: 22px;
    background: color-mix(in srgb, var(--surface) 92%, transparent);
    backdrop-filter: blur(10px);
    border: 1px solid color-mix(in srgb, var(--outline) 80%, transparent);
    box-shadow: 0 30px 80px rgba(80, 50, 20, 0.18), 0 4px 14px rgba(80, 50, 20, 0.08);
    overflow: hidden;
  }
  .win-bar {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 12px 14px;
    border-bottom: 1px solid var(--outline);
  }
  .win-bar > span {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--sand);
  }
  .url {
    margin-left: 14px;
    padding: 4px 14px;
    border-radius: 999px;
    background: var(--container);
    font: 0.72rem var(--mono);
    color: var(--muted);
  }
  .win-body {
    display: flex;
    min-height: 300px;
  }
  .win-side {
    display: grid;
    align-content: start;
    justify-items: center;
    gap: 12px;
    width: 56px;
    padding: 16px 0;
    background: var(--bg-2);
  }
  .win-side i {
    width: 28px;
    height: 8px;
    border-radius: 99px;
    background: var(--container-high);
  }
  .win-side i.on {
    background: var(--olive-c);
    width: 36px;
    height: 14px;
  }
  .win-main {
    flex: 1;
    padding: 18px 20px 22px;
    display: grid;
    gap: 14px;
  }
  .g-title {
    font-size: 1.4rem;
    font-weight: 760;
    letter-spacing: -0.02em;
    color: var(--ink);
  }
  .g-run {
    display: grid;
    grid-template-columns: auto 1fr;
    grid-template-areas: 'ic txt' 'step step' 'bar bar';
    gap: 10px 12px;
    align-items: center;
    padding: 14px;
    border-radius: 16px;
    background: var(--surface);
    border: 1px solid var(--outline);
  }
  .g-run :global(.mini-ic) {
    grid-area: ic;
  }
  .g-run-text {
    grid-area: txt;
    display: grid;
    font-size: 0.9rem;
  }
  .g-run-text .mono {
    font-size: 0.72rem;
    color: var(--muted);
  }
  .g-step {
    grid-area: step;
    display: flex;
    gap: 8px;
    align-items: baseline;
    font-size: 0.72rem;
  }
  .g-stage {
    font-size: 0.92rem;
    animation: rise 0.4s var(--ease-out);
  }
  .g-bar {
    grid-area: bar;
    height: 8px;
    border-radius: 99px;
    background: var(--container-high);
    overflow: hidden;
  }
  .g-bar span {
    display: block;
    height: 100%;
    background: linear-gradient(90deg, color-mix(in srgb, var(--olive) 70%, #fff), var(--olive));
    transform-origin: left;
    transition: transform 0.6s var(--ease-emph);
  }
  .g-tiles {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 10px;
  }
  .g-tile:nth-child(3) {
    display: none;
  }
  .g-tile {
    display: grid;
    gap: 3px;
    padding: 12px;
    border-radius: 14px;
    background: var(--surface);
    border: 1px solid var(--outline);
    font-size: 0.82rem;
    animation: rise 0.6s var(--ease-out) both;
    animation-delay: calc(0.5s + var(--i) * 0.08s);
  }
  .g-tile .mono {
    font-size: 0.66rem;
  }
  .g-status {
    justify-self: start;
    margin-top: 4px;
    padding: 2px 8px;
    border-radius: 99px;
    background: var(--olive-c);
    color: var(--on-olive-c);
    font-size: 0.66rem;
    font-weight: 600;
  }
  .g-status.busy {
    background: var(--plum-c);
    color: var(--plum);
  }
  .phone {
    position: absolute;
    right: 0;
    bottom: -10px;
    width: 188px;
    padding: 26px 14px 16px;
    border-radius: 30px;
    background: var(--surface);
    border: 6px solid #3a2c22;
    box-shadow: 0 30px 70px rgba(80, 50, 20, 0.22);
    display: grid;
    gap: 8px;
    font-size: 0.78rem;
    animation: phone-in 1.2s var(--ease-out) 0.5s both;
  }
  @keyframes phone-in {
    from {
      opacity: 0;
      transform: translateY(40px) rotate(3deg);
    }
  }
  .notch {
    position: absolute;
    top: 8px;
    left: 50%;
    width: 46px;
    height: 10px;
    border-radius: 99px;
    background: #3a2c22;
    transform: translateX(-50%);
  }
  .p-head {
    display: flex;
    gap: 10px;
    align-items: center;
  }
  .p-head div {
    display: grid;
    font-size: 0.95rem;
  }
  .p-head .mono {
    font-size: 0.62rem;
  }
  .p-btn {
    padding: 7px;
    border-radius: 99px;
    background: var(--olive);
    color: var(--on-olive);
    text-align: center;
    font-weight: 600;
  }
  .p-row {
    display: flex;
    gap: 6px;
  }
  .p-row span {
    flex: 1;
    padding: 5px;
    border-radius: 99px;
    border: 1px solid var(--outline-strong);
    text-align: center;
    font-size: 0.66rem;
  }
  .p-label {
    margin-top: 4px;
    font-weight: 700;
  }
  .p-check {
    display: flex;
    gap: 6px;
    align-items: center;
    font-size: 0.7rem;
    color: var(--text-2);
  }
  .p-check :global(svg) {
    color: var(--olive);
  }
  .p-qr {
    width: 64px;
    height: 64px;
    border-radius: 8px;
    background:
      conic-gradient(from 90deg at 3px 3px, #3a2c22 25%, transparent 0) 0 0 / 8px 8px,
      #fff;
    opacity: 0.85;
  }

  /* strip */
  .strip {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 14px 34px;
    padding: 22px;
    border-radius: var(--radius-l);
    background: var(--surface-2);
    border: 1px solid var(--outline);
    color: var(--text-2);
    font-weight: 500;
  }
  .strip span {
    display: inline-flex;
    gap: 8px;
    align-items: center;
  }
  .strip :global(svg) {
    color: var(--olive);
  }

  /* sections */
  .sec-head {
    text-align: center;
    max-width: 680px;
    margin: 0 auto 34px;
  }
  .kicker {
    display: inline-block;
    margin-bottom: 10px;
    color: var(--terra);
    font-weight: 650;
    font-size: 0.85rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
  h2 {
    font-size: clamp(1.7rem, 3.4vw, 2.5rem);
    font-weight: 760;
    letter-spacing: -0.028em;
    line-height: 1.1;
    color: var(--ink);
  }
  .how {
    padding: 90px 0 30px;
  }
  .steps {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 18px;
  }
  .step {
    position: relative;
    display: grid;
    gap: 8px;
    align-content: start;
    padding: 0 18px 22px;
    border-radius: var(--radius-l);
    background: var(--surface);
    border: 1px solid color-mix(in srgb, var(--outline) 70%, transparent);
    box-shadow: var(--shadow-1);
    transition: box-shadow 0.3s var(--ease), transform 0.3s var(--ease);
  }
  .step:hover {
    box-shadow: var(--shadow-2);
    transform: translateY(-2px);
  }
  .step-art {
    height: 150px;
    margin: 0 -18px;
    display: grid;
    place-items: center;
    overflow: hidden;
  }
  .step-art img {
    height: 140%;
    width: auto;
  }
  .num {
    font: 600 0.8rem var(--mono);
    color: var(--terra);
  }
  .step h3 {
    font-size: 1.15rem;
    font-weight: 700;
  }
  .step p {
    margin: 0;
    color: var(--text-2);
    line-height: 1.55;
  }
  .tools {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    align-items: center;
    gap: 12px 24px;
    margin-top: 30px;
  }
  .tool {
    display: inline-flex;
    gap: 8px;
    align-items: center;
    font-weight: 560;
  }
  .repo {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 50px;
    align-items: center;
    padding: 80px 0;
  }
  .repo-copy p {
    color: var(--text-2);
    font-size: 1.05rem;
    line-height: 1.6;
  }
  .repo ul {
    list-style: none;
    padding: 0;
    margin: 22px 0 0;
    display: grid;
    gap: 14px;
  }
  .repo li {
    display: flex;
    gap: 12px;
    color: var(--text-2);
    line-height: 1.5;
  }
  .repo li :global(svg) {
    flex: 0 0 auto;
    color: var(--olive);
    margin-top: 2px;
  }
  .repo li b {
    color: var(--text);
  }
  .tree {
    padding: 8px;
  }
  .tree-head {
    display: flex;
    gap: 8px;
    align-items: center;
    padding: 12px 14px;
    border-bottom: 1px solid var(--outline);
  }
  .tree-row {
    display: grid;
    grid-template-columns: 20px auto 1fr;
    gap: 12px;
    align-items: center;
    padding: 13px 14px;
    border-radius: 12px;
    transition: background-color 0.2s;
  }
  .tree-row:hover {
    background: var(--container);
  }
  .tree-row :global(svg) {
    color: var(--olive);
  }
  .tree-row .small {
    text-align: right;
  }
  .closing {
    display: grid;
    grid-template-columns: 1fr 1fr;
    align-items: center;
    gap: 30px;
    padding: 30px 40px;
    border-radius: var(--radius-xl);
    background: linear-gradient(135deg, var(--surface), color-mix(in srgb, var(--olive-c) 30%, var(--surface)));
    border: 1px solid var(--outline);
    box-shadow: var(--shadow-1);
  }
  .closing img {
    width: 100%;
  }
  .closing p {
    color: var(--text-2);
    font-size: 1.05rem;
    margin: 12px 0 22px;
  }
  .foot {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 6px 18px;
    padding: 40px 0 50px;
    color: var(--muted);
    font-size: 0.86rem;
  }
  @media (max-width: 980px) {
    .hero {
      grid-template-columns: 1fr;
      min-height: 0;
    }
    .hero-art {
      width: 120%;
      right: -30%;
      top: 0;
      opacity: 0.45;
    }
    .glimpse {
      height: 470px;
    }
    .steps {
      grid-template-columns: 1fr 1fr;
    }
    .repo,
    .closing {
      grid-template-columns: 1fr;
    }
    .links {
      display: none;
    }
  }
  @media (max-width: 560px) {
    .glimpse {
      height: 430px;
    }
    .window {
      width: 100%;
    }
    .g-tiles {
      grid-template-columns: 1fr 1fr;
    }
    .g-tile:nth-child(3) {
      display: none;
    }
    .phone {
      width: 170px;
      right: -6px;
    }
    .steps {
      grid-template-columns: 1fr;
    }
    .closing {
      padding: 22px;
    }
  }
</style>
