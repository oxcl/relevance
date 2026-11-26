// Build pipeline steps. Each step is invoked as a separate GitHub Actions step so that progress is
// visible both in GitHub and in Relevance (via the live log relay).
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import type { AppConfig, AppState, PatchIndex, PatchSource, RelevanceConfig, ReleaseEntry } from '../shared/types';
import { configHash, findPatch, needsRebuild, pickTarget, sortVersionsDesc } from '../shared/logic';
import { getDownload, resolveSource } from '../shared/sources';
import {
  BUILTIN_SOURCES,
  fetchBundle,
  fetchCli,
  loadIndex,
  moduleApk,
} from './patches';
import {
  download,
  env,
  ghApi,
  info,
  loadConfig,
  loadState,
  log,
  ok,
  readJson,
  REPO,
  run,
  RUN_ID,
  setOutput,
  shortErr,
  updateState,
  warn,
  WORK,
  writeJson,
} from './util';
import { notify } from './notify';

export interface Plan {
  appId: string;
  version: string | null;
  reason: string;
  download?: { url: string; fileName: string; version?: string };
  configHash: string;
  patchVersion?: string;
  skip?: boolean;
  rebuild: boolean;
  trigger: 'manual' | 'schedule' | 'config';
  startedAt: string;
}

const planPath = () => `${WORK}/plan.json`;
export const loadPlan = (): Plan => readJson(planPath(), null as any);

export function getApp(cfg: RelevanceConfig, id: string): AppConfig {
  const app = cfg.apps.find((a) => a.id === id);
  if (!app) throw new Error(`App "${id}" is not in relevance.json`);
  return app;
}

export function patchSourceFor(cfg: RelevanceConfig, app: AppConfig): PatchSource | null {
  if (app.tool === 'none') return null;
  const all = [...BUILTIN_SOURCES, ...(cfg.patchSources || [])];
  return (
    all.find((s) => s.id === app.patchSourceId && s.tool === app.tool) ||
    all.find((s) => s.builtin && s.tool === app.tool) ||
    null
  );
}

function buildTools(): string {
  const sdk = env.ANDROID_HOME || env.ANDROID_SDK_ROOT || '/usr/local/lib/android/sdk';
  const dir = join(sdk, 'build-tools');
  const vers = readdirSync(dir).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  return join(dir, vers[0]);
}

export async function apkInfo(apk: string): Promise<{ packageName: string; versionName: string; versionCode: number; label?: string }> {
  const out = await run(join(buildTools(), 'aapt2'), ['dump', 'badging', apk], { quiet: true }).catch(async () =>
    run(join(buildTools(), 'aapt'), ['dump', 'badging', apk], { quiet: true }),
  );
  const m = out.match(/package: name='([^']+)' versionCode='(\d+)' versionName='([^']*)'/);
  if (!m) throw new Error('Could not read the APK manifest');
  return { packageName: m[1], versionCode: Number(m[2]), versionName: m[3], label: out.match(/application-label:'([^']*)'/)?.[1] };
}

// ------------------------------------------------------------------ plan

export async function plan(appId: string, opts: { force: boolean; trigger: Plan['trigger'] }) {
  const cfg = loadConfig();
  const app = getApp(cfg, appId);
  const state = loadState(appId);
  info(`Planning build for ${app.name} (${app.packageName})`);
  const hash = await configHash(app);
  let index: PatchIndex | null = null;
  const ps = patchSourceFor(cfg, app);
  if (ps && app.tool !== 'lspatch') {
    index = await loadIndex(ps);
    if (index) ok(`Loaded ${ps.name} patch index ${index.version} (${index.patches.length} patches)`);
    else warn(`No patch index for ${ps.name}; version selection falls back to the latest`);
  }

  let available: string[] | null = null;
  try {
    const si = await resolveSource(app.source, { fetch, githubToken: env.GITHUB_TOKEN });
    available = si.versions;
    ok(`Source offers ${available ? available.length + ' versions, latest ' + (si.latest || available[0]) : 'the latest version only'}`);
  } catch (e) {
    warn(`Could not list source versions: ${shortErr(e)}`);
  }

  // Detect patches that disappeared from the tool (selection changed upstream).
  if (index && app.tool !== 'lspatch') {
    const missing = app.patches.filter((p) => !findPatch(index, p.name, app.packageName)).map((p) => p.name);
    if (missing.length) {
      throw Object.assign(new Error(`Selected patches no longer exist in ${index.name} ${index.version}: ${missing.join(', ')}`), {
        attention: 'selection-changed',
      });
    }
  }

  const t = app.tool === 'revanced' || app.tool === 'morphe' ? pickTarget(index, app.packageName, app.patches, available, app.pin) : pickTarget(null, app.packageName, [], available, app.pin);
  if (t.conflict) throw Object.assign(new Error(t.reason), { attention: 'no-compatible-version' });
  log(`Target version: ${t.target ?? 'latest'} — ${t.reason}`);

  const dl = await getDownload(app.source, t.target, { fetch, githubToken: env.GITHUB_TOKEN });
  const version = dl.version || t.target;
  const same =
    state.current &&
    version &&
    state.current.version === version &&
    state.configHash === hash &&
    (!index || state.patchVersion === index.version);
  const p: Plan = {
    appId,
    version: version || null,
    reason: t.reason,
    download: { url: dl.url, fileName: dl.fileName, version: dl.version },
    configHash: hash,
    patchVersion: index?.version,
    skip: Boolean(same && !opts.force),
    rebuild: needsRebuild(app),
    trigger: opts.trigger,
    startedAt: new Date().toISOString(),
  };
  writeJson(planPath(), p);
  if (p.skip) ok(`Already built ${version} with this configuration — nothing to do (use "Rebuild" to force)`);
  setOutput('skip', String(p.skip));
  setOutput('rebuild', String(p.rebuild));
  setOutput('customize', String(Boolean(app.customize?.name || app.customize?.packageName || app.customize?.icon)));
  setOutput('patch', String(app.tool !== 'none'));
  await updateState(
    appId,
    (s) => {
      s.status = 'building';
      s.targetVersion = version || undefined;
      s.history.unshift({ runId: RUN_ID, version: version || undefined, status: 'running', at: p.startedAt, trigger: opts.trigger });
      s.history = s.history.filter((h, i, arr) => arr.findIndex((x) => x.runId === h.runId) === i);
    },
    `relevance: building ${app.name} ${version ?? ''}`.trim(),
  );
}

// ------------------------------------------------------------------ fetch

function isZipWith(file: string, name: RegExp): boolean {
  // light check: look for the entry name in the zip central directory
  const buf = readFileSync(file);
  const tail = buf.subarray(Math.max(0, buf.length - 4 * 1024 * 1024)).toString('latin1');
  return name.test(tail);
}

export async function fetchApk(appId: string) {
  const p = loadPlan();
  const cfg = loadConfig();
  const app = getApp(cfg, appId);
  if (!p.download) throw new Error('Nothing to download');
  const raw = `${WORK}/download.bin`;
  info(`Fetching ${app.name} ${p.version ?? ''} from ${new URL(p.download.url).host}`);
  const headers: Record<string, string> = {};
  if (app.source.type === 'upload' || p.download.url.includes(`github.com/${REPO}/`)) headers.Authorization = `Bearer ${env.GITHUB_TOKEN}`;
  const res = await download(p.download.url, raw, headers);
  const isBundle = /xapk|apkm|apks/i.test(res.finalUrl) || isZipWith(raw, /manifest\.json|\.apk[^\w]|split_config|base\.apk/);
  const looksApk = isZipWith(raw, /AndroidManifest\.xml/) && isZipWith(raw, /classes\.dex|resources\.arsc/);
  const input = `${WORK}/input.apk`;
  if (looksApk && !/base\.apk/.test(readFileSync(raw).subarray(-2 * 1024 * 1024).toString('latin1'))) {
    renameSync(raw, input);
  } else if (isBundle) {
    info('Split APK bundle detected — merging into a single APK with APKEditor');
    const ed = await fetchCli('apkeditor');
    const bundle = `${WORK}/bundle.zip`;
    renameSync(raw, bundle);
    await run('java', ['-jar', ed, 'm', '-i', bundle, '-o', input, '-f']);
  } else {
    throw new Error('The downloaded file is not an APK');
  }
  const meta = await apkInfo(input);
  ok(`${meta.packageName} ${meta.versionName} (${meta.versionCode}), ${(statSync(input).size / 1048576).toFixed(1)} MB`);
  if (meta.packageName !== app.packageName) warn(`Package name ${meta.packageName} differs from the configured ${app.packageName}`);
  writeJson(`${WORK}/input.json`, meta);
  copyFileSync(input, `${WORK}/current.apk`);
}

// ------------------------------------------------------------------ patch

function optionArg(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (Array.isArray(v)) return `[${v.map((x) => optionArg(x).replace(/,/g, '\\,')).join(',')}]`;
  if (typeof v === 'string') return v.replace(/(["'])/g, '\\$1');
  return String(v);
}

export async function patch(appId: string) {
  const cfg = loadConfig();
  const app = getApp(cfg, appId);
  const p = loadPlan();
  const input = `${WORK}/current.apk`;
  const out = `${WORK}/patched.apk`;
  if (app.tool === 'none') return log('No patching tool selected — skipping');
  const custom = app.customPatches.filter((c) => c.enabled);

  if (app.tool === 'lspatch') {
    const jar = await fetchCli('lspatch');
    const ps = patchSourceFor(cfg, app);
    const index = ps ? await loadIndex(ps) : null;
    const mods: string[] = [];
    let i = 0;
    for (const sel of app.patches) {
      const def = findPatch(index, sel.name, app.packageName);
      const repo = def?.module?.repo || sel.name;
      mods.push(await moduleApk(repo, `${WORK}/modules/m${i++}.apk`));
    }
    for (const c of custom) mods.push(await moduleApk(c.url, `${WORK}/modules/m${i++}.apk`));
    if (!mods.length) warn('No Xposed modules selected; LSPatch will only add the loader');
    const outDir = `${WORK}/lspatch-out`;
    rmSync(outDir, { recursive: true, force: true });
    await run('java', ['-jar', jar, input, '-l', '2', '-f', '-o', outDir, ...mods.flatMap((m) => ['-m', m])]);
    const f = readdirSync(outDir).find((n) => n.endsWith('.apk'));
    if (!f) throw new Error('LSPatch produced no output');
    renameSync(join(outDir, f), out);
  } else {
    const ps = patchSourceFor(cfg, app);
    if (!ps) throw new Error(`No ${app.tool} patch source configured`);
    const cli = await fetchCli(app.tool);
    const main = await fetchBundle(ps);
    const bundles = [main.file];
    for (const c of custom) {
      const b = await fetchBundle({ tool: app.tool, url: c.url, id: c.id });
      if (!bundles.includes(b.file)) bundles.push(b.file);
    }
    const args = ['-jar', cli, 'patch'];
    for (const b of bundles) args.push('-p', b, ...(app.tool === 'revanced' ? ['-b'] : []));
    args.push('--exclusive');
    for (const sel of app.patches) {
      args.push('-e', sel.name);
      for (const [k, v] of Object.entries(sel.options || {})) {
        if (v === undefined || v === '') continue;
        args.push(`-O${k}=${optionArg(v)}`);
      }
    }
    for (const c of custom) for (const n of c.patchNames?.length ? c.patchNames : [c.name]) args.push('-e', n);
    if (app.pin) args.push('-f');
    args.push('-o', out, '-t', `${WORK}/tmp`, input);
    log(`Applying ${app.patches.length + custom.length} patches with ${ps.name} ${main.version}`);
    await run('java', args);
  }
  if (!existsSync(out)) throw new Error('Patching produced no APK');
  ok(`Patched APK ready (${(statSync(out).size / 1048576).toFixed(1)} MB)`);
  copyFileSync(out, `${WORK}/current.apk`);
  writeJson(`${WORK}/patched.json`, { patchVersion: p.patchVersion });
}

// ------------------------------------------------------------------ customize (apktool)

const xmlEscape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, "\\'");

export function rewriteManifest(xml: string, opts: { oldPkg: string; newPkg?: string; label?: string; icon?: boolean }): string {
  let m = xml;
  if (opts.label) {
    const label = xmlEscape(opts.label);
    m = m.replace(/<application\b[^>]*>/, (tag) =>
      /android:label=/.test(tag) ? tag.replace(/android:label="[^"]*"/, `android:label="${label}"`) : tag.replace('<application', `<application android:label="${label}"`),
    );
    // launcher activities / aliases
    m = m.replace(/<(activity|activity-alias)\b([^>]*)>([\s\S]*?)<\/\1>/g, (whole, tag, attrs, body) => {
      if (!/android\.intent\.category\.LAUNCHER/.test(body)) return whole;
      const a = /android:label=/.test(attrs) ? attrs.replace(/android:label="[^"]*"/, `android:label="${label}"`) : `${attrs} android:label="${label}"`;
      return `<${tag}${a}>${body}</${tag}>`;
    });
  }
  if (opts.icon) {
    const setIcon = (tag: string) => {
      let t = tag;
      t = /android:icon=/.test(t) ? t.replace(/android:icon="[^"]*"/, 'android:icon="@mipmap/relevance_icon"') : t.replace(/^<(\S+)/, '<$1 android:icon="@mipmap/relevance_icon"');
      t = /android:roundIcon=/.test(t) ? t.replace(/android:roundIcon="[^"]*"/, 'android:roundIcon="@mipmap/relevance_icon"') : t;
      return t;
    };
    m = m.replace(/<application\b[^>]*>/, setIcon);
    m = m.replace(/<(activity|activity-alias)\b[^>]*android:icon="[^"]*"[^>]*>/g, setIcon);
  }
  if (opts.newPkg && opts.newPkg !== opts.oldPkg) {
    const oldP = opts.oldPkg;
    const newP = opts.newPkg;
    // components keep their code in the old package: make relative class names absolute first
    m = m.replace(/(<(?:activity|activity-alias|service|receiver|provider|application|instrumentation)\b[^>]*?android:(?:name|targetActivity|backupAgent)=")\.([^"]+)"/g, `$1${oldP}.$2"`);
    m = m.replace(/(<(?:activity|activity-alias|service|receiver|provider|application)\b[^>]*?android:(?:name|targetActivity)=")\.([^"]+)"/g, `$1${oldP}.$2"`);
    m = m.replace(/(<manifest\b[^>]*?\spackage=")[^"]+"/, `$1${newP}"`);
    // authorities must be unique per device
    m = m.replace(/android:authorities="([^"]*)"/g, (_, v: string) => {
      const parts = v.split(';').map((a) => (a.startsWith(oldP) ? newP + a.slice(oldP.length) : `${newP}.${a}`));
      return `android:authorities="${parts.join(';')}"`;
    });
    // custom permissions declared by the app
    const perms = [...m.matchAll(/<permission\b[^>]*android:name="([^"]+)"/g)].map((x) => x[1]);
    for (const perm of perms) {
      const np = perm.startsWith(oldP) ? newP + perm.slice(oldP.length) : `${newP}.${perm}`;
      m = m.split(`"${perm}"`).join(`"${np}"`);
    }
    // task affinities that reference the old package
    m = m.replace(/android:taskAffinity="([^"]*)"/g, (_, v: string) => `android:taskAffinity="${v.startsWith(oldP) ? newP + v.slice(oldP.length) : v}"`);
  }
  return m;
}

export async function customize(appId: string) {
  const cfg = loadConfig();
  const app = getApp(cfg, appId);
  const c = app.customize || {};
  if (!c.name && !c.packageName && !c.icon) return log('No basic modifications — skipping');
  const apktool = await fetchCli('apktool');
  const dec = `${WORK}/decoded`;
  rmSync(dec, { recursive: true, force: true });
  info('Decompiling resources (code stays untouched)');
  await run('java', ['-jar', apktool, 'd', '-f', '-s', '-o', dec, `${WORK}/current.apk`]);
  const meta = readJson<{ packageName: string }>(`${WORK}/input.json`, { packageName: app.packageName });
  const manifestPath = join(dec, 'AndroidManifest.xml');
  const xml = readFileSync(manifestPath, 'utf8');
  const curPkg = xml.match(/<manifest\b[^>]*package="([^"]+)"/)?.[1] || meta.packageName;
  if (c.icon) {
    const iconFile = c.icon.path;
    if (!existsSync(iconFile)) throw new Error(`Icon ${iconFile} not found in repository`);
    for (const d of ['mipmap-xxxhdpi', 'mipmap-anydpi-v26', 'values']) mkdirSync(join(dec, 'res', d), { recursive: true });
    copyFileSync(iconFile, join(dec, 'res/mipmap-xxxhdpi/relevance_icon_legacy.png'));
    const fg = iconFile.replace(/\.png$/, '-fg.png');
    if (existsSync(fg)) {
      copyFileSync(fg, join(dec, 'res/mipmap-xxxhdpi/relevance_icon_fg.png'));
      const bg = readJson<{ background?: string }>(iconFile.replace(/\.png$/, '.json'), {}).background || '#FFFFFF';
      writeFileSync(join(dec, 'res/values/relevance_icon.xml'), `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n  <color name="relevance_icon_bg">${bg}</color>\n</resources>\n`);
      writeFileSync(
        join(dec, 'res/mipmap-anydpi-v26/relevance_icon.xml'),
        `<?xml version="1.0" encoding="utf-8"?>\n<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n  <background android:drawable="@color/relevance_icon_bg"/>\n  <foreground android:drawable="@mipmap/relevance_icon_fg"/>\n</adaptive-icon>\n`,
      );
      copyFileSync(iconFile, join(dec, 'res/mipmap-xxxhdpi/relevance_icon.png'));
      rmSync(join(dec, 'res/mipmap-xxxhdpi/relevance_icon_legacy.png'));
    } else {
      renameSync(join(dec, 'res/mipmap-xxxhdpi/relevance_icon_legacy.png'), join(dec, 'res/mipmap-xxxhdpi/relevance_icon.png'));
    }
    ok('Installed the new launcher icon');
  }
  const next = rewriteManifest(xml, { oldPkg: curPkg, newPkg: c.packageName, label: c.name, icon: Boolean(c.icon) });
  writeFileSync(manifestPath, next);
  if (c.name) ok(`Renamed the app to "${c.name}"`);
  if (c.packageName && c.packageName !== curPkg) {
    ok(`Package name ${curPkg} → ${c.packageName}`);
  }
  info('Rebuilding APK');
  await run('java', ['-jar', apktool, 'b', '-o', `${WORK}/customized.apk`, dec]);
  copyFileSync(`${WORK}/customized.apk`, `${WORK}/current.apk`);
  ok('Customized APK ready');
}

// ------------------------------------------------------------------ sign

export async function sign(appId: string) {
  const bt = buildTools();
  const ks = `${WORK}/keystore.p12`;
  if (!env.RELEVANCE_KEYSTORE) throw new Error('Signing key secret RELEVANCE_KEYSTORE is missing — open Relevance settings to set it up');
  writeFileSync(ks, Buffer.from(env.RELEVANCE_KEYSTORE, 'base64'));
  const aligned = `${WORK}/aligned.apk`;
  const signed = `${WORK}/signed.apk`;
  info('Aligning');
  await run(join(bt, 'zipalign'), ['-p', '-f', '4', `${WORK}/current.apk`, aligned], { quiet: true });
  info('Signing with your repository key (v1 + v2 + v3)');
  await run(join(bt, 'apksigner'), [
    'sign',
    '--ks', ks,
    '--ks-type', 'PKCS12',
    '--ks-pass', 'env:RELEVANCE_KEYSTORE_PASSWORD',
    '--key-pass', 'env:RELEVANCE_KEYSTORE_PASSWORD',
    '--ks-key-alias', env.RELEVANCE_KEY_ALIAS || 'relevance',
    '--v1-signing-enabled', 'true',
    '--v2-signing-enabled', 'true',
    '--v3-signing-enabled', 'true',
    '--out', signed,
    aligned,
  ]);
  const v = await run(join(bt, 'apksigner'), ['verify', '--print-certs', signed], { quiet: true });
  const fp = v.match(/SHA-256 digest: ([0-9a-f]+)/)?.[1];
  ok(`Signed${fp ? ` — certificate ${fp.slice(0, 16)}…` : ''}`);
  copyFileSync(signed, `${WORK}/current.apk`);
  rmSync(ks);
  void appId;
}

// ------------------------------------------------------------------ publish

async function uploadAsset(uploadUrl: string, file: string, name: string) {
  const url = uploadUrl.replace(/\{.*\}$/, '') + `?name=${encodeURIComponent(name)}`;
  const body = readFileSync(file);
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      'Content-Type': 'application/vnd.android.package-archive',
      'Content-Length': String(body.length),
      Accept: 'application/vnd.github+json',
    },
    body,
  });
  if (!r.ok) throw new Error(`Asset upload failed: ${r.status} ${await r.text()}`);
  return (await r.json()) as any;
}

export async function publish(appId: string) {
  const cfg = loadConfig();
  const app = getApp(cfg, appId);
  const p = loadPlan();
  const file = `${WORK}/current.apk`;
  const meta = await apkInfo(file);
  const size = statSync(file).size;
  const sha256 = createHash('sha256').update(readFileSync(file)).digest('hex');
  const tag = `${app.id}-${meta.versionName.replace(/[^\w.-]/g, '_')}-${p.configHash.slice(0, 6)}`;
  const apkName = `${meta.packageName}_${meta.versionCode}_${p.configHash.slice(0, 6)}.apk`;
  info(`Publishing ${apkName} as release ${tag}`);
  let rel: any;
  try {
    rel = await ghApi(`/repos/${REPO}/releases/tags/${encodeURIComponent(tag)}`);
    for (const a of rel.assets) await ghApi(`/repos/${REPO}/releases/assets/${a.id}`, { method: 'DELETE' });
  } catch {
    const patchList = app.tool === 'none' ? [] : app.patches.map((x) => `- ${x.name}`);
    rel = await ghApi(`/repos/${REPO}/releases`, {
      method: 'POST',
      body: JSON.stringify({
        tag_name: tag,
        name: `${app.customize?.name || app.name} ${meta.versionName}`,
        body: [
          `Built by Relevance from ${app.source.type} — ${app.tool === 'none' ? 'unmodified' : `patched with ${app.tool}`}.`,
          '',
          ...(patchList.length ? ['**Patches**', ...patchList, ''] : []),
          `SHA-256: \`${sha256}\``,
        ].join('\n'),
        make_latest: 'false',
      }),
    });
  }
  const asset = await uploadAsset(rel.upload_url, file, apkName);
  ok(`Uploaded ${(size / 1048576).toFixed(1)} MB`);
  const entry: ReleaseEntry = {
    version: meta.versionName,
    versionCode: meta.versionCode,
    tag,
    date: new Date().toISOString(),
    size,
    sha256,
    apk: apkName,
    url: asset.browser_download_url,
    patches: app.tool === 'none' ? [] : [...app.patches.map((x) => x.name), ...app.customPatches.filter((c) => c.enabled).map((c) => c.name)],
    tool: app.tool,
    patchVersion: p.patchVersion,
  };
  const started = new Date(p.startedAt).getTime();
  await updateState(
    appId,
    (s: AppState) => {
      s.status = 'ok';
      s.current = entry;
      s.configHash = p.configHash;
      s.patchVersion = p.patchVersion;
      s.attention = null;
      s.releases = [entry, ...(s.releases || []).filter((r) => r.tag !== tag)];
      const h = s.history.find((x) => x.runId === RUN_ID);
      if (h) Object.assign(h, { status: 'success', version: meta.versionName, durationMs: Date.now() - started });
    },
    `relevance: published ${app.name} ${meta.versionName}`,
  );
  ok(`${app.customize?.name || app.name} ${meta.versionName} is live`);
}

export async function finishSkipped(appId: string) {
  await updateState(
    appId,
    (s) => {
      s.status = s.current ? 'ok' : 'never';
      const h = s.history.find((x) => x.runId === RUN_ID);
      if (h) h.status = 'skipped';
    },
    'relevance: nothing to build',
  );
}

// ------------------------------------------------------------------ failure

export async function fail(appId: string, opts: { cancelled: boolean; error?: string }) {
  const cfg = loadConfig();
  const app = cfg.apps.find((a) => a.id === appId);
  const p = loadPlan();
  const errFile = `${WORK}/error.json`;
  const err = readJson<{ message?: string; attention?: string; step?: string }>(errFile, {});
  const message = opts.error || err.message || 'The build failed — open the build log for details';
  if (opts.cancelled) {
    await updateState(
      appId,
      (s) => {
        s.status = s.current ? 'ok' : 'never';
        const h = s.history.find((x) => x.runId === RUN_ID);
        if (h) h.status = 'cancelled';
      },
      'relevance: build cancelled',
    );
    return;
  }
  const kind = (err.attention as any) || 'build-failed';
  const version = p?.version || undefined;
  const st = await updateState(
    appId,
    (s) => {
      s.status = kind === 'build-failed' ? 'failed' : 'needs-review';
      s.attention = {
        kind,
        message:
          kind === 'build-failed'
            ? `Building ${version ? 'version ' + version : 'the update'} failed${err.step ? ` during "${err.step}"` : ''}. The last good build stays published.`
            : message,
        at: new Date().toISOString(),
        version,
        details: [message],
      };
      const h = s.history.find((x) => x.runId === RUN_ID);
      if (h) Object.assign(h, { status: 'failure', error: message });
      else s.history.unshift({ runId: RUN_ID, status: 'failure', at: new Date().toISOString(), trigger: 'manual', error: message, version });
    },
    `relevance: ${app?.name || appId} needs attention`,
  );
  if (app) await notify(cfg, app, st);
}

export function recordError(step: string, e: unknown) {
  const attention = (e as any)?.attention;
  writeJson(`${WORK}/error.json`, { step, message: shortErr(e), attention });
}

export { sortVersionsDesc };
