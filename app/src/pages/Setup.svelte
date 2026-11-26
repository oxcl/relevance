<script lang="ts">
  import { onMount } from 'svelte';
  import { fly, slide, fade } from 'svelte/transition';
  import Icon from '$c/Icon.svelte';
  import Stepper from '$c/Stepper.svelte';
  import QR from '$c/QR.svelte';
  import { gh, session, useRepo, engineFiles, signOut } from '$lib/store.svelte';
  import type { RepoSummary } from '$lib/provider';
  import type { RelevanceConfig } from '$shared/types';
  import { repoReadme } from '$shared/templates';
  import { ripple, errorToast, downloadBlob, petals, copy } from '$lib/ui.svelte';
  import { navigate } from '$lib/router.svelte';

  let step = $state(0);
  let mode = $state<'new' | 'existing'>('new');
  let repoName = $state('my-apps');
  let isPrivate = $state(false);
  let repos = $state<RepoSummary[]>([]);
  let query = $state('');
  let picked = $state<RepoSummary | null>(null);
  let pickerOpen = $state(false);

  let keyMode = $state<'generate' | 'upload'>('generate');
  let key = $state<{ p12: Uint8Array; password: string; alias: string; fingerprint: string; certPem?: string } | null>(null);
  let generating = $state(false);
  let uploadPassword = $state('');
  let uploadFile = $state<File | null>(null);
  let backedUp = $state(false);

  let agreed = $state(false);

  type Task = { label: string; status: 'wait' | 'run' | 'ok' | 'warn' | 'fail'; note?: string };
  let tasks = $state<Task[]>([]);
  let working = $state(false);
  let finished = $state(false);
  let fullName = $state('');
  let pagesUrl = $state('');

  onMount(async () => {
    try {
      repos = await gh().listRepos();
    } catch {}
  });

  const filtered = $derived(repos.filter((r) => r.fullName.toLowerCase().includes(query.toLowerCase())).slice(0, 30));
  const nameValid = $derived(/^[A-Za-z0-9._-]{1,100}$/.test(repoName) && !repos.some((r) => r.name.toLowerCase() === repoName.toLowerCase()));
  const step0Valid = $derived(mode === 'new' ? nameValid : !!picked);

  async function generate() {
    generating = true;
    try {
      const { generateKeystore } = await import('$lib/keystore');
      key = await generateKeystore(session.user!.login);
    } catch (e) {
      errorToast(e, 'Key generation failed');
    }
    generating = false;
  }

  async function useUploaded() {
    if (!uploadFile) return;
    try {
      const { inspectKeystore } = await import('$lib/keystore');
      const bytes = new Uint8Array(await uploadFile.arrayBuffer());
      const info = await inspectKeystore(bytes, uploadPassword);
      key = { p12: bytes, password: uploadPassword, alias: info.alias, fingerprint: info.fingerprint, certPem: info.certPem };
      backedUp = true;
    } catch (e) {
      errorToast(e);
    }
  }

  function backup() {
    if (!key) return;
    downloadBlob(key.p12 as BlobPart, 'relevance-signing-key.p12', 'application/x-pkcs12');
    setTimeout(
      () =>
        downloadBlob(
          `Relevance signing key\n\nKeystore: relevance-signing-key.p12 (PKCS#12)\nAlias: ${key!.alias}\nPassword: ${key!.password}\nSHA-256: ${key!.fingerprint}\n\nKeep this safe. Anyone with this file and password can sign apps as you.\n`,
          'relevance-signing-key.txt',
          'text/plain',
        ),
      400,
    );
    backedUp = true;
  }

  function next() {
    if (step < 3) step++;
    if (step === 3 && !working && !finished) run();
  }

  async function run() {
    working = true;
    const owner = session.user!.login;
    tasks = [
      { label: mode === 'new' ? `Create ${owner}/${repoName}` : `Connect ${picked!.fullName}`, status: 'wait' },
      { label: 'Write configuration and build workflows', status: 'wait' },
      { label: 'Store the signing key as encrypted secrets', status: 'wait' },
      { label: 'Turn on GitHub Pages', status: 'wait' },
      { label: 'Publish your empty F-Droid repository', status: 'wait' },
    ];
    const t = (i: number, status: Task['status'], note?: string) => {
      tasks[i].status = status;
      if (note) tasks[i].note = note;
    };
    try {
      t(0, 'run');
      let repo: RepoSummary;
      if (mode === 'new') repo = await gh().createRepo(repoName, isPrivate);
      else {
        repo = picked!;
        if (repo.private !== isPrivate) await gh().setVisibility(repo.fullName, isPrivate);
      }
      fullName = repo.fullName;
      await gh().markRelevance(fullName).catch(() => {});
      t(0, 'ok');

      t(1, 'run');
      if (mode === 'new') await new Promise((r) => setTimeout(r, 1200));
      const existing = await gh().readText(fullName, 'relevance.json');
      const guessPages = owner.toLowerCase() + '.github.io/' + repo.name;
      let emailToken: string | undefined;
      let emailHint: string | undefined;
      if (session.server.email) {
        try {
          const r = await fetch('/api/email/token', {
            method: 'POST',
            headers: { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ repo: fullName }),
          });
          if (r.ok) ({ token: emailToken, hint: emailHint } = await r.json());
        } catch {}
      }
      const cfg: RelevanceConfig = existing
        ? JSON.parse(existing.text)
        : {
            version: 1,
            owner,
            createdAt: new Date().toISOString(),
            settings: {
              notifications: { email: true, issue: true, inApp: true, fdroid: true },
              emailToken,
              emailHint,
              store: { title: `${session.user!.name || owner}'s apps`, description: 'A small, honest collection of apps — kept up to date automatically.' },
              relevanceUrl: location.origin,
              signing: { mode: keyMode === 'generate' ? 'generated' : 'custom', fingerprint: key!.fingerprint, alias: key!.alias, createdAt: new Date().toISOString() },
            },
            patchSources: [],
            apps: [],
          };
      cfg.settings.relevanceUrl = location.origin;
      cfg.settings.signing = { mode: keyMode === 'generate' ? 'generated' : 'custom', fingerprint: key!.fingerprint, alias: key!.alias, createdAt: new Date().toISOString() };
      const files = [
        { path: 'relevance.json', content: JSON.stringify(cfg, null, 2) + '\n' },
        ...(await engineFiles(fullName)),
        ...(key!.certPem ? [{ path: '.relevance/signing-cert.pem', content: key!.certPem }] : []),
      ];
      const readme = await gh().readText(fullName, 'README.md');
      if (!readme || readme.text.length < 200) files.push({ path: 'README.md', content: repoReadme(owner, repo.name, location.origin, `https://${guessPages}`) });
      await gh().commit(fullName, files, 'relevance: set up repository');
      t(1, 'ok');

      t(2, 'run');
      let bin = '';
      for (const b of key!.p12) bin += String.fromCharCode(b);
      await gh().setSecret(fullName, 'RELEVANCE_KEYSTORE', btoa(bin));
      await gh().setSecret(fullName, 'RELEVANCE_KEYSTORE_PASSWORD', key!.password);
      await gh().setSecret(fullName, 'RELEVANCE_KEY_ALIAS', key!.alias);
      t(2, 'ok');

      t(3, 'run');
      try {
        pagesUrl = (await gh().enablePages(fullName)) || `https://${guessPages}`;
        t(3, 'ok');
      } catch (e: any) {
        pagesUrl = `https://${guessPages}`;
        t(3, 'warn', isPrivate ? 'GitHub Pages needs a public repository on free plans' : e.message);
      }
      pagesUrl = pagesUrl.replace(/\/$/, '');

      t(4, 'run');
      try {
        await new Promise((r) => setTimeout(r, 1500));
        await gh().dispatch(fullName, 'relevance-publish.yml', {});
        t(4, 'ok', 'Running in your GitHub Actions — ready in a few minutes');
      } catch (e: any) {
        t(4, 'warn', e.message);
      }
      finished = true;
      petals();
    } catch (e: any) {
      const i = tasks.findIndex((x) => x.status === 'run');
      if (i >= 0) t(i, 'fail', e.message);
      errorToast(e, 'Setup failed');
    }
    working = false;
  }

  async function finish() {
    await useRepo(fullName);
    navigate('/dashboard', { replace: true });
  }

  const fdroidUrl = $derived(`${pagesUrl}/fdroid/repo${key ? `?fingerprint=${key.fingerprint}` : ''}`);
  const arts = ['setup', 'settings', 'review', 'build-ok'];
  const titles = ['Where should Relevance live?', 'Your signing key', 'A word on responsibility', 'Add it to F-Droid'];
</script>

<div class="setup">
  <header class="top">
    <a class="brand" href="/" data-native><img src="/logo.svg" alt="" width="36" height="36" /><span>Relevance</span></a>
    <div class="spacer"></div>
    <button class="btn text sm" onclick={() => { signOut(); navigate('/'); }}>Sign out</button>
  </header>
  <div class="stepper"><Stepper steps={['Repository', 'Signing key', 'Responsibility', 'Done']} current={step} onjump={(i) => !working && !finished && (step = i)} /></div>

  {#key step}
    <section class="body" in:fly={{ x: 40, duration: 450, opacity: 0 }}>
      <div class="main">
        <h1 class="display">{titles[step]}</h1>

        {#if step === 0}
          <div class="choices">
            <button class="choice card" class:on={mode === 'new'} onclick={() => (mode = 'new')} use:ripple>
              <span class="radio"></span>
              <span class="ch-body">
                <span class="title">Create a new repository</span>
                <span class="muted">Set up a fresh repository for your apps and configuration.</span>
                {#if mode === 'new'}
                  <span class="field" transition:slide={{ duration: 250 }}>
                    <span class="label">Repository name</span>
                    <input class="input mono" class:invalid={!nameValid} bind:value={repoName} onclick={(e) => e.stopPropagation()} />
                    {#if !nameValid}<span class="hint">That name is taken or invalid.</span>{/if}
                  </span>
                {/if}
              </span>
            </button>
            <button class="choice card" class:on={mode === 'existing'} onclick={() => (mode = 'existing')} use:ripple>
              <span class="radio"></span>
              <span class="ch-body">
                <span class="title">Use an existing repository</span>
                <span class="muted">Connect Relevance to a repository you already have.</span>
                {#if mode === 'existing'}
                  <span class="field picker" transition:slide={{ duration: 250 }}>
                    <span class="label">Repository</span>
                    <span class="search">
                      <Icon name="search" size={20} />
                      <input
                        class="input"
                        placeholder={picked ? picked.fullName : 'Search repositories…'}
                        bind:value={query}
                        onclick={(e) => { e.stopPropagation(); pickerOpen = true; }}
                        onfocus={() => (pickerOpen = true)}
                      />
                    </span>
                    {#if pickerOpen}
                      <span class="list" transition:fly={{ y: -6, duration: 200 }}>
                        {#each filtered as r (r.fullName)}
                          <span
                            class="opt"
                            role="option"
                            tabindex="0"
                            aria-selected={picked?.fullName === r.fullName}
                            onclick={(e) => { e.stopPropagation(); picked = r; isPrivate = r.private; query = ''; pickerOpen = false; }}
                            onkeydown={(e) => e.key === 'Enter' && ((picked = r), (isPrivate = r.private), (pickerOpen = false))}
                          >
                            <Icon name={r.private ? 'lock' : 'public'} size={16} /><span class="mono">{r.fullName}</span>
                            {#if r.isRelevance}<span class="tag olive">Relevance</span>{/if}
                          </span>
                        {:else}
                          <span class="opt muted">No repositories found</span>
                        {/each}
                      </span>
                    {/if}
                    {#if picked}<span class="tag olive mono">{picked.fullName}</span>{/if}
                  </span>
                {/if}
              </span>
            </button>
          </div>

          <h2 class="title vis">Visibility</h2>
          <div class="segmented" role="radiogroup">
            <span class="thumb" style="transform:translateX({isPrivate ? 100 : 0}%)"></span>
            <button role="radio" aria-checked={!isPrivate} class:on={!isPrivate} onclick={() => (isPrivate = false)}><Icon name="public" size={20} /> Public</button>
            <button role="radio" aria-checked={isPrivate} class:on={isPrivate} onclick={() => (isPrivate = true)}><Icon name="lock" size={20} /> Private</button>
          </div>
          {#key isPrivate}
            <div class="notice" class:error={isPrivate} in:fade={{ duration: 250 }}>
              <Icon name={isPrivate ? 'warning' : 'info'} />
              {#if isPrivate}
                <span>With a private repository, your <b>F-Droid repository</b>, <b>store site</b> and <b>direct downloads</b> won't work — they need a public repository.</span>
              {:else}
                <span>The repository's contents — your app list and configuration — will be <b>publicly visible</b>. Signing keys always stay secret.</span>
              {/if}
            </div>
          {/key}
        {:else if step === 1}
          <p class="muted lead">Every app you build is signed with this key, and your F-Droid repository index too. Relevance stores it only as encrypted GitHub Actions secrets in your repository.</p>
          <div class="segmented two">
            <span class="thumb" style="transform:translateX({keyMode === 'upload' ? 100 : 0}%)"></span>
            <button class:on={keyMode === 'generate'} onclick={() => ((keyMode = 'generate'), (key = null))}><Icon name="stars" size={20} /> Generate for me</button>
            <button class:on={keyMode === 'upload'} onclick={() => ((keyMode = 'upload'), (key = null))}><Icon name="upload" size={20} /> Use my own</button>
          </div>
          {#if keyMode === 'generate'}
            {#if !key}
              <div class="card pad keybox" in:fly={{ y: 10 }}>
                <span class="key-ic" class:spinning={generating}><Icon name="key" size={34} /></span>
                <div>
                  <div class="title">RSA 4096 · valid for 35 years</div>
                  <div class="muted small">Generated right here in your browser. It never touches Relevance's server.</div>
                </div>
                <button class="btn" onclick={generate} disabled={generating} use:ripple>
                  {#if generating}<Icon name="sync" class="spin" /> Generating…{:else}<Icon name="key" /> Generate key{/if}
                </button>
              </div>
            {/if}
          {:else if !key}
            <div class="card pad stack" in:fly={{ y: 10 }}>
              <div class="field">
                <span class="label">Keystore file (.p12 / .pfx)</span>
                <input class="input" type="file" accept=".p12,.pfx,application/x-pkcs12" onchange={(e) => (uploadFile = (e.target as HTMLInputElement).files?.[0] || null)} />
              </div>
              <div class="field"><span class="label">Password</span><input class="input" type="password" bind:value={uploadPassword} /></div>
              <div class="hint"><Icon name="info" size={16} />Have a JKS file? Convert it: <code class="mono">keytool -importkeystore -srckeystore my.jks -destkeystore my.p12 -deststoretype PKCS12</code></div>
              <button class="btn" disabled={!uploadFile} onclick={useUploaded}>Use this key</button>
            </div>
          {/if}
          {#if key}
            <div class="card pad keyok" in:fly={{ y: 14, duration: 500 }}>
              <div class="row"><span class="ok-ic"><Icon name="verified" fill /></span><b>Key ready</b><span class="tag mono">{key.alias}</span></div>
              <div class="label">SHA-256 fingerprint</div>
              <button class="fp mono" onclick={() => copy(key!.fingerprint)}>{key.fingerprint.replace(/(.{4})/g, '$1 ')}<Icon name="content_copy" size={16} /></button>
              {#if keyMode === 'generate'}
                <div class="notice">
                  <Icon name="warning" />
                  <span>Download a backup now. GitHub secrets can't be read back, so this is the only chance to keep a copy. Losing it means users must reinstall your apps after a key change.</span>
                </div>
                <button class="btn tonal" onclick={backup} use:ripple><Icon name="download" /> Download backup {#if backedUp}<Icon name="check" />{/if}</button>
              {/if}
            </div>
          {/if}
        {:else if step === 2}
          <div class="card pad legal">
            <p>Relevance is a tool that runs entirely under <b>your</b> GitHub account. You choose what apps to modify, what to build, and what to publish.</p>
            <ul>
              <li>You are responsible for the legal risk of what you build and publish, including respecting app licenses, trademarks and terms of service.</li>
              <li>Relevance does not host, store or distribute any APKs — everything lives in your repository.</li>
              <li>Published apps are signed with your key and released under your name.</li>
            </ul>
            <label class="agree">
              <input type="checkbox" bind:checked={agreed} />
              <span class="box"><Icon name="check" size={16} /></span>
              <span>I understand and accept responsibility for what I build and publish.</span>
            </label>
          </div>
        {:else}
          <div class="tasks">
            {#each tasks as t, i (i)}
              <div class="task {t.status}" in:fly={{ x: -14, delay: i * 70 }}>
                <span class="t-ic">
                  {#if t.status === 'run'}<Icon name="sync" size={18} />{:else if t.status === 'ok'}<Icon name="check" size={18} />{:else if t.status === 'warn'}<Icon name="priority_high" size={18} />{:else if t.status === 'fail'}<Icon name="close" size={18} />{/if}
                </span>
                <span><span>{t.label}</span>{#if t.note}<br /><span class="muted small">{t.note}</span>{/if}</span>
              </div>
            {/each}
          </div>
          {#if finished}
            <div class="card pad fdroid" in:fly={{ y: 20, duration: 600 }}>
              <div>
                <h3 class="title">Your F-Droid repository</h3>
                <p class="muted small">Scan the code in F-Droid (Settings → Repositories → +) or open the link on your phone.</p>
                <button class="fp mono" onclick={() => copy(fdroidUrl)}>{pagesUrl}/fdroid/repo<Icon name="content_copy" size={16} /></button>
                <div class="wrap-row">
                  <a class="btn sm" href="fdroidrepos://{fdroidUrl.replace(/^https?:\/\//, '')}" data-native><Icon name="android" size={18} /> Open in F-Droid</a>
                  <a class="btn sm outlined" href={pagesUrl} target="_blank" rel="noreferrer"><Icon name="storefront" size={18} /> Store site</a>
                </div>
              </div>
              <QR text={fdroidUrl} size={150} />
            </div>
          {/if}
        {/if}
      </div>
      <div class="art-col" aria-hidden="true"><img class="art" src="/art/{arts[step]}.webp" alt="" /></div>
    </section>
  {/key}

  <footer class="nav">
    <button class="btn soft" disabled={step === 0 || working || finished} onclick={() => step--}>Back</button>
    {#if step < 3}
      <button
        class="btn terra lg"
        disabled={(step === 0 && !step0Valid) || (step === 1 && (!key || (keyMode === 'generate' && !backedUp))) || (step === 2 && !agreed)}
        onclick={next}
        use:ripple
      >
        {step === 2 ? 'Set up my repository' : 'Continue'} <Icon name="arrow_forward" />
      </button>
    {:else}
      <button class="btn lg" disabled={!finished} onclick={finish} use:ripple>Go to dashboard <Icon name="arrow_forward" /></button>
    {/if}
  </footer>
</div>

<style>
  .setup {
    max-width: 1120px;
    margin: 0 auto;
    padding: 0 clamp(16px, 4vw, 40px) 40px;
    min-height: 100dvh;
    display: flex;
    flex-direction: column;
  }
  .top {
    display: flex;
    align-items: center;
    padding: 20px 0;
  }
  .brand {
    display: flex;
    gap: 10px;
    align-items: center;
    font-weight: 900;
    font-size: 1.4rem;
    text-decoration: none;
  }
  .stepper {
    max-width: 760px;
    width: 100%;
    margin: 6px auto 20px;
  }
  .body {
    display: grid;
    grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr);
    gap: 30px;
    align-items: start;
    flex: 1;
  }
  .main {
    display: grid;
    gap: 16px;
    align-content: start;
  }
  .lead {
    margin: 0;
    font-size: 1.02rem;
  }
  .art-col img {
    width: 100%;
    animation: rise 1s var(--ease-out), sway 10s ease-in-out infinite;
  }
  .choices {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 14px;
  }
  .choice {
    display: flex;
    gap: 14px;
    padding: 18px;
    text-align: left;
    cursor: pointer;
    align-items: flex-start;
    overflow: visible;
    border: 2px solid var(--outline);
  }
  .choice.on {
    border-color: var(--olive);
    background: color-mix(in srgb, var(--olive-c) 35%, var(--surface));
    box-shadow: var(--shadow-2);
  }
  .radio {
    flex: 0 0 auto;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    border: 2px solid var(--outline-strong);
    margin-top: 2px;
    position: relative;
    transition: border-color 0.2s;
  }
  .choice.on .radio {
    border-color: var(--olive);
  }
  .radio::after {
    content: '';
    position: absolute;
    inset: 3px;
    border-radius: 50%;
    background: var(--olive);
    transform: scale(0);
    transition: transform 0.35s var(--ease-spring);
  }
  .choice.on .radio::after {
    transform: scale(1);
  }
  .ch-body {
    display: grid;
    gap: 4px;
    flex: 1;
    min-width: 0;
  }
  .ch-body .field {
    margin-top: 10px;
  }
  .picker {
    position: relative;
  }
  .search {
    position: relative;
    display: block;
  }
  .search :global(svg) {
    position: absolute;
    left: 12px;
    top: 13px;
    color: var(--muted);
  }
  .search .input {
    padding-left: 40px;
  }
  .list {
    position: absolute;
    z-index: 5;
    top: 76px;
    left: 0;
    right: 0;
    max-height: 260px;
    overflow: auto;
    padding: 6px;
    background: var(--surface);
    border-radius: 16px;
    box-shadow: var(--shadow-3);
    border: 1px solid var(--outline);
  }
  .opt {
    display: flex;
    gap: 8px;
    align-items: center;
    padding: 9px 10px;
    border-radius: 10px;
    cursor: pointer;
  }
  .opt:hover {
    background: var(--container);
  }
  .vis {
    margin-top: 6px;
  }
  .segmented {
    position: relative;
    display: grid;
    grid-template-columns: 1fr 1fr;
    max-width: 460px;
    padding: 4px;
    border-radius: 999px;
    background: var(--container);
    border: 1px solid var(--outline);
  }
  .segmented .thumb {
    position: absolute;
    top: 4px;
    bottom: 4px;
    left: 4px;
    width: calc(50% - 4px);
    border-radius: 999px;
    background: var(--olive);
    box-shadow: var(--shadow-1);
    transition: transform 0.5s var(--ease-spring);
  }
  .segmented button {
    position: relative;
    z-index: 1;
    display: flex;
    gap: 8px;
    align-items: center;
    justify-content: center;
    height: 44px;
    border: 0;
    background: none;
    border-radius: 999px;
    font-weight: 600;
    cursor: pointer;
    color: var(--text-2);
    transition: color 0.3s;
  }
  .segmented button.on {
    color: var(--on-olive);
  }
  .keybox {
    display: flex;
    align-items: center;
    gap: 16px;
    flex-wrap: wrap;
  }
  .keybox > div {
    flex: 1;
    min-width: 200px;
  }
  .key-ic {
    width: 64px;
    height: 64px;
    border-radius: 22px;
    display: grid;
    place-items: center;
    background: var(--terra-c);
    color: var(--on-terra-c);
  }
  .key-ic.spinning :global(svg) {
    animation: spin 1.2s var(--ease) infinite;
  }
  :global(.spin) {
    animation: spin 1s linear infinite;
  }
  .keyok {
    display: grid;
    gap: 10px;
  }
  .ok-ic {
    color: var(--success);
    animation: pop-in 0.5s var(--ease-spring);
  }
  @keyframes pop-in {
    from {
      transform: scale(0) rotate(-90deg);
    }
  }
  .fp {
    display: flex;
    align-items: center;
    gap: 10px;
    justify-content: space-between;
    width: 100%;
    text-align: left;
    padding: 12px 14px;
    border-radius: 14px;
    border: 0;
    background: var(--container);
    cursor: pointer;
    word-break: break-all;
    line-height: 1.6;
    transition: background 0.2s;
  }
  .fp:hover {
    background: var(--container-high);
  }
  .legal p {
    margin-top: 0;
  }
  .legal li {
    margin: 8px 0;
  }
  .agree {
    display: flex;
    gap: 12px;
    align-items: center;
    margin-top: 16px;
    padding: 14px;
    border-radius: 16px;
    background: var(--container);
    cursor: pointer;
    font-weight: 500;
  }
  .agree input {
    position: absolute;
    opacity: 0;
  }
  .agree .box {
    flex: 0 0 auto;
    width: 24px;
    height: 24px;
    border-radius: 8px;
    border: 2px solid var(--outline-strong);
    display: grid;
    place-items: center;
    color: transparent;
    transition: all 0.3s var(--ease-spring);
  }
  .agree input:checked + .box {
    background: var(--olive);
    border-color: var(--olive);
    color: var(--on-olive);
    transform: scale(1.08);
  }
  .agree input:focus-visible + .box {
    outline: 2px solid var(--terra);
  }
  .tasks {
    display: grid;
    gap: 10px;
  }
  .task {
    display: flex;
    gap: 12px;
    align-items: flex-start;
    padding: 12px 14px;
    border-radius: 16px;
    background: var(--surface);
    box-shadow: var(--shadow-1);
    transition: background 0.4s;
  }
  .t-ic {
    flex: 0 0 auto;
    width: 26px;
    height: 26px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    border: 2px solid var(--outline);
    transition: all 0.4s var(--ease-spring);
  }
  .task.run .t-ic {
    border-color: var(--plum);
    color: var(--plum);
  }
  .task.run .t-ic :global(svg) {
    animation: spin 1s linear infinite;
  }
  .task.ok .t-ic {
    background: var(--olive);
    border-color: var(--olive);
    color: var(--on-olive);
    transform: scale(1.06);
  }
  .task.warn .t-ic {
    background: var(--amber-c);
    border-color: var(--amber);
    color: var(--on-amber-c);
  }
  .task.fail .t-ic {
    background: var(--error);
    border-color: var(--error);
    color: #fff;
  }
  .fdroid {
    display: flex;
    gap: 18px;
    align-items: center;
    justify-content: space-between;
  }
  .fdroid > div {
    display: grid;
    gap: 10px;
    min-width: 0;
  }
  .nav {
    display: flex;
    justify-content: space-between;
    padding-top: 28px;
  }
  @media (max-width: 860px) {
    .body {
      grid-template-columns: 1fr;
    }
    .art-col {
      order: -1;
      max-height: 200px;
      display: flex;
      justify-content: center;
    }
    .art-col img {
      max-height: 200px;
      width: auto;
    }
    .choices {
      grid-template-columns: 1fr;
    }
    .fdroid {
      flex-direction: column;
      align-items: stretch;
    }
  }
</style>
