<script lang="ts">
  import { slide } from 'svelte/transition';
  import Icon from '$c/Icon.svelte';
  import Hero from '$c/Hero.svelte';
  import Switch from '$c/Switch.svelte';
  import Dialog from '$c/Dialog.svelte';
  import QR from '$c/QR.svelte';
  import { data, session, gh, saveConfig, signOut, publishSite } from '$lib/store.svelte';
  import { ripple, toast, errorToast, copy, downloadBlob, setTheme, theme } from '$lib/ui.svelte';
  import { navigate } from '$lib/router.svelte';
  import type { NotificationSettings } from '$shared/types';

  const formatFingerprint = (fp?: string) => (fp ? fp.replace(/(.{4})/g, '$1 ').trim() : '');
  const cfg = $derived(data.config!);
  const n = $derived(cfg?.settings.notifications);
  let replaceOpen = $state(false);
  let deleteOpen = $state(false);
  let confirmText = $state('');
  let busy = $state('');
  let title = $state(data.config?.settings.store.title || '');
  let description = $state(data.config?.settings.store.description || '');
  let domain = $state(data.config?.settings.store.domain || '');
  let newKey = $state<any>(null);
  let upFile = $state<File | null>(null);
  let upPass = $state('');

  const fdroid = $derived(data.pagesUrl ? `${data.pagesUrl}/fdroid/repo` : '');
  const fdroidAdd = $derived(fdroid && cfg?.settings.signing.fingerprint ? `${fdroid}?fingerprint=${cfg.settings.signing.fingerprint}` : fdroid);

  async function toggle(k: keyof NotificationSettings, v: boolean) {
    try {
      if (k === 'email' && v && !cfg.settings.emailToken) await connectEmail();
      await saveConfig((c) => (c.settings.notifications[k] = v), `relevance: ${v ? 'enable' : 'disable'} ${k} notifications`);
    } catch (e) {
      errorToast(e);
    }
  }
  async function connectEmail() {
    if (!session.server.email) throw new Error('Email isn\'t available on this server yet');
    const r = await fetch('/api/email/token', {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ repo: session.repo }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error);
    await saveConfig((c) => ((c.settings.emailToken = j.token), (c.settings.emailHint = j.hint)), 'relevance: connect email notifications');
    toast(`Emails go to ${j.hint}`, 'success');
  }
  async function saveStore() {
    busy = 'store';
    try {
      await saveConfig((c) => (c.settings.store = { title, description, domain: domain.trim() || undefined }), 'relevance: update store settings', domain.trim() ? [{ path: 'CNAME', content: domain.trim() + '\n' }] : []);
      if (domain.trim()) await gh().req(`/repos/${session.repo}/pages`, { method: 'PUT', body: JSON.stringify({ cname: domain.trim() }) }).catch(() => {});
      await publishSite().catch(() => {});
      toast('Saved — your store republishes in a few minutes', 'success');
    } catch (e) {
      errorToast(e);
    }
    busy = '';
  }
  async function generateNew() {
    busy = 'gen';
    const { generateKeystore } = await import('$lib/keystore');
    newKey = await generateKeystore(session.user!.login);
    busy = '';
  }
  async function useUpload() {
    try {
      const { inspectKeystore } = await import('$lib/keystore');
      const bytes = new Uint8Array(await upFile!.arrayBuffer());
      const info = await inspectKeystore(bytes, upPass);
      newKey = { p12: bytes, password: upPass, ...info, uploaded: true };
    } catch (e) {
      errorToast(e);
    }
  }
  async function applyKey() {
    busy = 'apply';
    try {
      let bin = '';
      for (const b of newKey.p12) bin += String.fromCharCode(b);
      await gh().setSecret(session.repo!, 'RELEVANCE_KEYSTORE', btoa(bin));
      await gh().setSecret(session.repo!, 'RELEVANCE_KEYSTORE_PASSWORD', newKey.password);
      await saveConfig(
        (c) => (c.settings.signing = { mode: newKey.uploaded ? 'custom' : 'generated', fingerprint: newKey.fingerprint, alias: newKey.alias, createdAt: new Date().toISOString() }),
        'relevance: replace signing key',
        [{ path: '.relevance/signing-cert.pem', content: newKey.certPem }],
      );
      toast('Signing key replaced. Future builds use the new key.', 'success');
      replaceOpen = false;
      newKey = null;
    } catch (e) {
      errorToast(e);
    }
    busy = '';
  }
  function backup() {
    downloadBlob(newKey.p12, 'relevance-signing-key.p12', 'application/x-pkcs12');
    setTimeout(() => downloadBlob(`Alias: ${newKey.alias}\nPassword: ${newKey.password}\nSHA-256: ${newKey.fingerprint}\n`, 'relevance-signing-key.txt', 'text/plain'), 400);
  }
  async function downloadCert() {
    const t = await gh().readText(session.repo!, '.relevance/signing-cert.pem');
    if (!t) return toast('No certificate stored. The private key is a write-only GitHub secret — use your backup.', 'error');
    downloadBlob(t.text, 'relevance-signing-cert.pem', 'application/x-pem-file');
  }
  async function exportZip() {
    busy = 'zip';
    try {
      const a = await gh().latestPagesArtifact(session.repo!);
      if (!a) throw new Error('No published store yet — build an app first');
      const r = await fetch(`/api/gh/artifact?repo=${encodeURIComponent(session.repo!)}&id=${a.id}`, { headers: { Authorization: `Bearer ${session.token}` } });
      if (!r.ok) throw new Error(`Download failed (${r.status})`);
      downloadBlob(await r.blob(), `${session.repo!.split('/')[1]}-store.zip`, 'application/zip');
    } catch (e) {
      errorToast(e);
    }
    busy = '';
  }
  async function deleteAccount() {
    busy = 'delete';
    await signOut({ revoke: true });
    toast('Your Relevance account is gone. Your GitHub repository was left untouched.', 'success', undefined, 7000);
    navigate('/', { replace: true });
  }
  const channels: [keyof NotificationSettings, string, string, string][] = [
    ['email', 'mail', 'Email', 'Build failures and updates that need a review.'],
    ['issue', 'github', 'GitHub issue', 'Open an issue in your repository on failure.'],
    ['inApp', 'notifications', 'In Relevance', 'Show notices here (bell in the header).'],
    ['fdroid', 'android', 'F-Droid warning', 'A warning at the top of the app description in F-Droid.'],
  ];
</script>

{#if cfg}
  <Hero title="Settings" art="settings" artWidth={520} compact />

  <div class="grid">
    <section class="card pad" id="notifications">
      <h2 class="section-title"><Icon name="notifications" /> Notifications</h2>
      <p class="muted small sub">Choose how you're told when a build fails or an update changes what you picked.</p>
      {#each channels as [k, ic, l, d], i}
        <div class="opt" style="--i:{i}">
          <span class="oi"><Icon name={ic} /></span>
          <div class="grow"><b>{l}</b><div class="muted small">{d}{#if k === 'email' && cfg.settings.emailHint} · <span class="mono">{cfg.settings.emailHint}</span>{/if}</div></div>
          <Switch checked={n[k]} onchange={(v) => toggle(k, v)} label={l} />
        </div>
      {/each}
      {#if n.email && !cfg.settings.emailToken}
        <div class="notice small" transition:slide><Icon name="info" />{session.server.email ? 'Connect your verified GitHub email to receive emails.' : 'Email delivery is not configured on this server yet.'}
          {#if session.server.email}<button class="btn sm" onclick={() => connectEmail().catch(errorToast)}>Connect</button>{/if}</div>
      {/if}
    </section>

    <section class="card pad" id="signing">
      <h2 class="section-title"><Icon name="key" /> Signing key</h2>
      <p class="muted small sub">The key used to sign your apps and your F-Droid repository. Stored as encrypted GitHub Actions secrets.</p>
      <div class="label">Fingerprint (SHA-256)</div>
      <button class="fp mono" onclick={() => copy(cfg.settings.signing.fingerprint || '')}>{formatFingerprint(cfg.settings.signing.fingerprint) || '—'} <Icon name="content_copy" size={16} /></button>
      <div class="muted small">{cfg.settings.signing.mode === 'generated' ? 'Generated by Relevance' : 'Your own key'} · alias <span class="mono">{cfg.settings.signing.alias}</span>
        {#if !data.secrets.includes('RELEVANCE_KEYSTORE')}<span class="tag terra">secret missing</span>{/if}</div>
      <div class="wrap-row acts">
        <button class="btn tonal-terra" onclick={() => (replaceOpen = true)} use:ripple><Icon name="sync" /> Replace</button>
        <button class="btn" onclick={downloadCert} use:ripple><Icon name="download" /> Certificate</button>
      </div>
    </section>

    <section class="card pad" id="repository">
      <h2 class="section-title"><Icon name="layers" /> Repository</h2>
      <p class="muted small sub">Your source of truth, and where your builds are published.</p>
      <div class="kv">
        <Icon name="github" size={20} /><span>GitHub repository</span>
        <a class="tag mono" href="https://github.com/{session.repo}" target="_blank" rel="noreferrer">{session.repo} <Icon name="open_in_new" size={12} /></a>
        <Icon name="public" size={20} /><span>Store website</span>
        {#if data.pagesUrl}<a class="tag mono" href={data.pagesUrl} target="_blank" rel="noreferrer">{data.pagesUrl.replace(/^https:\/\//, '')} <Icon name="open_in_new" size={12} /></a>{:else}<span class="muted small">Not published yet</span>{/if}
        <Icon name="android" size={20} /><span>F-Droid repository</span>
        {#if fdroid}<button class="tag mono copyable" onclick={() => copy(fdroidAdd)}>{fdroid.replace(/^https:\/\//, '')} <Icon name="content_copy" size={12} /></button>{:else}<span class="muted small">—</span>{/if}
      </div>
      {#if session.repoInfo?.private}<div class="notice small"><Icon name="warning" />This repository is private: the F-Droid repository, store site and direct downloads don't work.</div>{/if}
      {#if fdroidAdd}
        <div class="qrrow"><QR text={fdroidAdd} size={130} /><p class="muted small">Scan with F-Droid → Settings → Repositories → + to get updates automatically.</p></div>
      {/if}
    </section>

    <section class="card pad" id="store">
      <h2 class="section-title"><Icon name="storefront" /> Store site</h2>
      <label class="field"><span class="label">Title</span><input class="input" bind:value={title} /></label>
      <label class="field"><span class="label">Description</span><textarea class="textarea" rows="2" bind:value={description}></textarea></label>
      <label class="field"><span class="label">Custom domain (optional)</span><input class="input mono" placeholder="apps.example.com" bind:value={domain} /></label>
      {#if domain}<p class="hint" transition:slide><Icon name="info" size={16} />Point a CNAME record for {domain} to {session.user?.login.toLowerCase()}.github.io.</p>{/if}
      <div class="wrap-row acts">
        <button class="btn" onclick={saveStore} disabled={busy === 'store'} use:ripple><Icon name="check" /> Save & republish</button>
        <button class="btn outlined" onclick={exportZip} disabled={busy === 'zip'} use:ripple><Icon name="folder_zip" /> {busy === 'zip' ? 'Preparing…' : 'Download as zip'}</button>
      </div>
    </section>

    <section class="card pad">
      <h2 class="section-title"><Icon name="contrast" /> Appearance</h2>
      <div class="seg">
        {#each [['system', 'contrast', 'System'], ['light', 'light_mode', 'Light'], ['dark', 'dark_mode', 'Dark']] as [k, ic, l]}
          <button class:on={theme.pref === k} onclick={(e) => setTheme(k as any, { x: e.clientX, y: e.clientY })}><Icon name={ic} />{l}</button>
        {/each}
      </div>
    </section>

    <section class="card pad danger-card">
      <h2 class="section-title"><Icon name="warning" /> Danger zone</h2>
      <p class="muted small sub">Irreversible actions.</p>
      <button class="btn danger" onclick={() => (deleteOpen = true)} use:ripple><Icon name="delete" /> Delete account</button>
      <p class="hint"><Icon name="info" size={16} />Deletes your Relevance account and revokes its access. Your GitHub repository, builds, F-Droid repository and store are left untouched.</p>
    </section>
  </div>

  <Dialog bind:open={replaceOpen} title="Replace signing key" icon="key">
    <div class="notice"><Icon name="warning" />Android won't install updates signed with a different key over existing installs. Users will need to uninstall and reinstall your apps.</div>
    {#if !newKey}
      <div class="stack" style="margin-top:14px">
        <button class="btn" onclick={generateNew} disabled={busy === 'gen'}><Icon name="key" /> {busy === 'gen' ? 'Generating…' : 'Generate a new key'}</button>
        <div class="or muted small">or upload a PKCS#12 keystore</div>
        <input class="input" type="file" accept=".p12,.pfx" onchange={(e) => (upFile = (e.target as HTMLInputElement).files?.[0] || null)} />
        <input class="input" type="password" placeholder="Password" bind:value={upPass} />
        <button class="btn outlined" disabled={!upFile} onclick={useUpload}>Use this keystore</button>
      </div>
    {:else}
      <div class="stack" style="margin-top:14px">
        <div class="label">New fingerprint</div>
        <div class="fp mono">{formatFingerprint(newKey.fingerprint)}</div>
        {#if !newKey.uploaded}<button class="btn tonal" onclick={backup}><Icon name="download" /> Download backup</button>{/if}
      </div>
    {/if}
    {#snippet actions()}
      <button class="btn soft" onclick={() => ((replaceOpen = false), (newKey = null))}>Cancel</button>
      <button class="btn terra" disabled={!newKey || busy === 'apply'} onclick={applyKey}>{busy === 'apply' ? 'Saving…' : 'Replace key'}</button>
    {/snippet}
  </Dialog>

  <Dialog bind:open={deleteOpen} title="Delete your Relevance account?" icon="delete">
    <p>Relevance keeps nothing on its servers, so this signs you out everywhere and revokes Relevance's access to GitHub. <b>Your repository {session.repo} is left untouched</b> — your apps keep building and your store keeps working.</p>
    <label class="field"><span class="label">Type <span class="mono">delete</span> to confirm</span><input class="input" bind:value={confirmText} /></label>
    {#snippet actions()}
      <button class="btn soft" onclick={() => (deleteOpen = false)}>Cancel</button>
      <button class="btn danger" disabled={confirmText !== 'delete' || busy === 'delete'} onclick={deleteAccount}>Delete account</button>
    {/snippet}
  </Dialog>
{/if}

<style>
  .grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
    align-items: start;
  }
  .sub {
    margin: -8px 0 12px;
  }
  .opt {
    display: flex;
    gap: 14px;
    align-items: center;
    padding: 12px 0;
    border-top: 1px solid var(--outline);
    animation: rise 0.5s var(--ease-out) both;
    animation-delay: calc(var(--i) * 50ms);
  }
  .oi {
    width: 38px;
    height: 38px;
    border-radius: 12px;
    display: grid;
    place-items: center;
    background: var(--container);
    color: var(--text-2);
  }
  .grow {
    flex: 1;
  }
  .fp {
    display: flex;
    justify-content: space-between;
    gap: 10px;
    align-items: center;
    width: 100%;
    margin: 6px 0 8px;
    padding: 12px 14px;
    border: 0;
    border-radius: 14px;
    background: var(--container);
    text-align: left;
    line-height: 1.6;
    word-break: break-all;
    cursor: pointer;
  }
  .acts {
    margin-top: 14px;
  }
  .kv {
    display: grid;
    grid-template-columns: 22px auto 1fr;
    gap: 12px 12px;
    align-items: center;
    margin-bottom: 12px;
  }
  .kv .tag {
    justify-self: start;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    text-decoration: none;
    height: auto;
    padding: 4px 10px;
  }
  .copyable {
    border: 0;
    cursor: pointer;
  }
  .qrrow {
    display: flex;
    gap: 16px;
    align-items: center;
  }
  #store {
    display: grid;
    gap: 12px;
  }
  #store .section-title {
    margin-bottom: 0;
  }
  .seg {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 6px;
    padding: 5px;
    border-radius: 16px;
    background: var(--container);
  }
  .seg button {
    display: grid;
    justify-items: center;
    gap: 4px;
    padding: 12px 0;
    border: 0;
    border-radius: 12px;
    background: none;
    cursor: pointer;
    font-weight: 600;
    transition: all 0.3s var(--ease);
  }
  .seg button.on {
    background: var(--surface);
    box-shadow: var(--shadow-1);
  }
  .danger-card {
    background: linear-gradient(160deg, var(--error-c), color-mix(in srgb, var(--error-c) 40%, var(--surface)));
  }
  .danger-card .section-title :global(svg) {
    color: var(--error);
  }
  .or {
    text-align: center;
  }
  @media (max-width: 900px) {
    .grid {
      grid-template-columns: 1fr;
    }
  }
</style>
