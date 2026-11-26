<script lang="ts">
  import Icon from '$c/Icon.svelte';
  import { signInUrl, session } from '$lib/store.svelte';
  import { parallax, reveal, ripple, tilt, setTheme, isDark } from '$lib/ui.svelte';
  import { router } from '$lib/router.svelte';

  const authError = router.route.query.get('auth_error');
  const steps = [
    { icon: 'link', title: 'Point to an app', text: 'Paste a link from APKPure, F-Droid, GitHub Releases or any APK URL — or upload one.' },
    { icon: 'extension', title: 'Pick one tool', text: 'ReVanced, Morphe or LSPatch with Xposed modules. Choose patches, set their options.' },
    { icon: 'palette', title: 'Make it yours', text: 'Rename, change the package, and paint a new icon with badges and text.' },
    { icon: 'storefront', title: 'Your own store', text: 'Builds run in your GitHub Actions and land in your F-Droid repo and store site.' },
  ];
  const facts = [
    { icon: 'lock', title: 'Nothing stored here', text: 'Your data lives in one GitHub repository you own. Relevance keeps no APKs and no database.' },
    { icon: 'update', title: 'Quietly up to date', text: 'Daily checks pick the newest version all your patches support — not just the latest.' },
    { icon: 'key', title: 'Your keys, your name', text: 'A signing key generated for you, kept as an encrypted secret. Or bring your own.' },
    { icon: 'notifications', title: 'Told when it matters', text: 'Email, a GitHub issue, a notice here, and a warning in F-Droid when a build needs you.' },
  ];
  let path: SVGPathElement;
</script>

<div class="landing">
  <header class="top">
    <a class="brand" href="/"><img src="/logo.svg" alt="" width="38" height="38" /><span>Relevance</span></a>
    <div class="spacer"></div>
    <button class="icon-btn" aria-label="Toggle theme" onclick={(e) => setTheme(isDark() ? 'light' : 'dark', { x: e.clientX, y: e.clientY })}>
      <Icon name={isDark() ? 'light_mode' : 'dark_mode'} />
    </button>
    <a class="btn outlined sm" href={signInUrl()} data-native use:ripple><Icon name="github" size={18} /> Sign in</a>
  </header>

  <section class="hero">
    <div class="copy">
      <span class="eyebrow tag olive"><Icon name="eco" size={14} fill /> Free, open and calm</span>
      <h1 class="display big">
        {#each 'Your apps, the way you like them.'.split(' ') as w, i}<span class="w" style="--i:{i}">{w}</span>{' '}{/each}
      </h1>
      <p class="lede">
        Relevance applies patches and tweaks to Android apps, builds them in <b>your own GitHub Actions</b>, and publishes them to your own
        <b>F-Droid repository</b> and app store website. It keeps everything updated for you.
      </p>
      {#if authError}
        <div class="notice error"><Icon name="error" /> Sign-in didn't complete ({authError}). Please try again.</div>
      {/if}
      {#if !session.server.oauth}
        <div class="notice info"><Icon name="info" /> Sign in with GitHub is being set up on this server.</div>
      {/if}
      <div class="cta">
        <a class="btn lg" href={signInUrl()} data-native use:ripple><Icon name="github" /> Sign in with GitHub</a>
        <a class="btn lg text" href="#how">How it works <Icon name="keyboard_arrow_down" /></a>
      </div>
      <p class="fine muted small"><Icon name="info" size={16} /> You build and publish under your own account and are responsible for what you build.</p>
    </div>
    <div class="art-col">
      <img class="art hero-art" src="/art/welcome.webp" alt="" use:parallax={0.05} />
      <div class="float f1" use:tilt><img src="/art/tool.webp" alt="" /></div>
      <div class="float f2" use:tilt><img src="/art/build-ok.webp" alt="" /></div>
    </div>
  </section>

  <section class="how" id="how">
    <h2 class="headline" use:reveal>From a link to your own store, in four calm steps</h2>
    <div class="flow">
      <svg class="vine" viewBox="0 0 1000 120" preserveAspectRatio="none" aria-hidden="true">
        <path bind:this={path} d="M20 60 C 180 0, 300 120, 500 60 S 820 0, 980 60" />
      </svg>
      {#each steps as s, i}
        <article class="card pad step" use:reveal={i} use:tilt={4}>
          <span class="num">{i + 1}</span>
          <span class="step-ic"><Icon name={s.icon} size={26} /></span>
          <h3 class="title">{s.title}</h3>
          <p class="muted">{s.text}</p>
        </article>
      {/each}
    </div>
  </section>

  <section class="facts">
    {#each facts as f, i}
      <article class="fact" use:reveal={i}>
        <span class="fact-ic"><Icon name={f.icon} /></span>
        <div><h3 class="title">{f.title}</h3><p class="muted">{f.text}</p></div>
      </article>
    {/each}
  </section>

  <section class="closing card" use:reveal>
    <img class="art" src="/art/storefront.webp" alt="" />
    <div>
      <h2 class="headline">Your store, your domain, your rules.</h2>
      <p class="muted">Everything Relevance produces is static files on your GitHub Pages — download it as a zip anytime.</p>
      <a class="btn terra" href={signInUrl()} data-native use:ripple><Icon name="rocket_launch" /> Get started</a>
    </div>
  </section>

  <footer class="foot muted small">
    Relevance is a tool. It doesn't host, distribute or store any apps. ·
    <a href="https://github.com/oxcl/relevance" target="_blank" rel="noreferrer">Source on GitHub</a>
  </footer>
</div>

<style>
  .landing {
    max-width: 1200px;
    margin: 0 auto;
    padding: 0 clamp(16px, 4vw, 40px);
  }
  .top {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 18px 0;
    position: sticky;
    top: 0;
    z-index: 5;
    background: linear-gradient(var(--bg) 60%, transparent);
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 10px;
    font-weight: 900;
    font-size: 1.4rem;
    letter-spacing: -0.03em;
    text-decoration: none;
  }
  .hero {
    display: grid;
    grid-template-columns: 1.05fr 1fr;
    gap: 30px;
    align-items: center;
    min-height: min(78vh, 720px);
  }
  .big {
    font-size: clamp(2.6rem, 6.4vw, 4.6rem);
    margin: 18px 0 18px;
  }
  .w {
    display: inline-block;
    animation: word 0.9s var(--ease-out) both;
    animation-delay: calc(var(--i) * 70ms + 100ms);
  }
  @keyframes word {
    from {
      opacity: 0;
      transform: translateY(0.5em) rotate(3deg);
      filter: blur(6px);
    }
  }
  .eyebrow {
    animation: rise 0.6s var(--ease-out) both;
  }
  .lede {
    font-size: 1.15rem;
    color: var(--text-2);
    max-width: 560px;
    animation: rise 0.8s var(--ease-out) 0.5s both;
  }
  .cta {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    margin: 26px 0 16px;
    animation: rise 0.8s var(--ease-out) 0.65s both;
  }
  .fine {
    display: flex;
    gap: 6px;
    align-items: center;
    animation: fade 1s 1s both;
  }
  .notice {
    margin-top: 14px;
  }
  .art-col {
    position: relative;
    animation: art 1.4s var(--ease-out) 0.2s both;
  }
  @keyframes art {
    from {
      opacity: 0;
      transform: scale(0.94) translateY(20px);
      filter: blur(8px);
    }
  }
  .hero-art {
    width: 100%;
    display: block;
    -webkit-mask-image: radial-gradient(ellipse 70% 68% at 50% 50%, #000 55%, transparent 100%);
    mask-image: radial-gradient(ellipse 70% 68% at 50% 50%, #000 55%, transparent 100%);
  }
  .float {
    position: absolute;
    width: 34%;
    padding: 10px;
    border-radius: 26px;
    background: color-mix(in srgb, var(--surface) 80%, transparent);
    backdrop-filter: blur(8px);
    box-shadow: var(--shadow-2);
    transition: transform 0.4s var(--ease-out);
  }
  .float img {
    width: 100%;
    display: block;
    filter: var(--art-filter);
  }
  .f1 {
    left: -4%;
    bottom: 2%;
    animation: bob 7s ease-in-out infinite;
  }
  .f2 {
    right: -2%;
    top: 0;
    width: 26%;
    animation: bob 8s ease-in-out 1s infinite reverse;
  }
  @keyframes bob {
    50% {
      translate: 0 -12px;
    }
  }
  .how {
    padding: 70px 0 30px;
    text-align: center;
  }
  .how h2 {
    max-width: 640px;
    margin: 0 auto 34px;
    font-size: clamp(1.5rem, 3vw, 2.1rem);
  }
  .flow {
    position: relative;
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 18px;
  }
  .vine {
    position: absolute;
    left: 0;
    right: 0;
    top: 30%;
    width: 100%;
    height: 120px;
    z-index: 0;
    overflow: visible;
  }
  .vine path {
    fill: none;
    stroke: var(--olive);
    stroke-opacity: 0.35;
    stroke-width: 2.5;
    stroke-dasharray: 8 10;
    animation: dash 30s linear infinite;
  }
  @keyframes dash {
    to {
      stroke-dashoffset: -1000;
    }
  }
  .step {
    position: relative;
    z-index: 1;
    text-align: left;
    display: grid;
    gap: 10px;
    align-content: start;
    transition: transform 0.4s var(--ease-out), box-shadow 0.3s;
  }
  .step:hover {
    box-shadow: var(--shadow-2);
  }
  .num {
    position: absolute;
    top: 14px;
    right: 18px;
    font: 900 2.6rem var(--font);
    color: var(--container-high);
  }
  .step-ic {
    width: 52px;
    height: 52px;
    border-radius: 18px;
    display: grid;
    place-items: center;
    background: var(--terra-c);
    color: var(--on-terra-c);
  }
  .step p {
    margin: 0;
  }
  .facts {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 18px 36px;
    padding: 40px 0;
  }
  .fact {
    display: flex;
    gap: 16px;
  }
  .fact p {
    margin: 4px 0 0;
  }
  .fact-ic {
    flex: 0 0 auto;
    width: 46px;
    height: 46px;
    border-radius: 16px;
    display: grid;
    place-items: center;
    background: var(--olive-c);
    color: var(--on-olive-c);
  }
  .closing {
    display: grid;
    grid-template-columns: 1fr 1fr;
    align-items: center;
    gap: 20px;
    padding: 20px 34px;
    margin: 20px 0 30px;
    overflow: hidden;
  }
  .closing img {
    width: 100%;
  }
  .closing h2 {
    font-size: 1.8rem;
    margin-bottom: 8px;
  }
  .closing .btn {
    margin-top: 12px;
  }
  .foot {
    text-align: center;
    padding: 20px 0 40px;
  }
  @media (max-width: 860px) {
    .hero,
    .closing {
      grid-template-columns: 1fr;
    }
    .art-col {
      order: -1;
      max-width: 520px;
      margin: 0 auto;
    }
    .flow {
      grid-template-columns: 1fr 1fr;
    }
    .vine {
      display: none;
    }
    .facts {
      grid-template-columns: 1fr;
    }
  }
  @media (max-width: 520px) {
    .flow {
      grid-template-columns: 1fr;
    }
    .top .btn {
      display: none;
    }
  }
</style>
