// Build pipeline steps. Each step is invoked as a separate GitHub Actions step so that progress is
// visible both in GitHub and in Relevance (via the live log relay).
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { join, resolve } from 'node:path';
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
import { editManifest } from './axml';
import { apkeepDownload, apkeepVersions } from './apkeep';
import { apkpurePage } from '../shared/sources';

export function srcCtx() {
  let resolver = env.RELEVANCE_URL;
  try {
    resolver ||= loadConfig().settings.relevanceUrl;
  } catch {}
  return { fetch: (i: any, o?: any) => fetch(i, o), githubToken: env.GITHUB_TOKEN, resolver };
}

/** Versions the app's source can deliver. APKPure goes through apkeep (its website challenges CI runners). */
export async function sourceVersions(app: AppConfig): Promise<{ versions: string[] | null; latest?: string }> {
  if (app.source.type === 'apkpure') {
    const versions = await apkeepVersions(apkpurePage(app.source.url).pkg);
    return { versions, latest: versions[0] };
  }
  const si = await resolveSource(app.source, srcCtx());
  return { versions: si.versions, latest: si.latest || si.versions?.[0] };
}

/** A concrete download for exactly `version` (or the newest one when null). Never substitutes another version. */
export async function sourceDownload(app: AppConfig, version: string | null): Promise<{ url: string; fileName: string; version?: string }> {
  if (app.source.type === 'apkpure') {
    const pkg = apkpurePage(app.source.url).pkg;
    const versions = await apkeepVersions(pkg);
    const want = version || versions[0];
    if (!versions.includes(want))
      throw Object.assign(new Error(`APKPure doesn't offer ${pkg} ${want}, which your patches need (newest there: ${versions[0]})`), {
        attention: 'no-compatible-version',
      });
    return { url: `apkeep:${pkg}@${want}`, fileName: `${pkg}.apk`, version: want };
  }
  const dl = await getDownload(app.source, version, srcCtx());
  if (version && dl.version !== version && app.source.type === 'fdroid')
    throw Object.assign(new Error(`F-Droid doesn't offer version ${version}, which your patches need`), { attention: 'no-compatible-version' });
  return dl;
}

function expectedSignatures(index: PatchIndex | null, pkg: string): string[] | undefined {
  const sigs = new Set<string>();
  for (const p of index?.patches || []) for (const c of p.packages || []) if (c.packageName === pkg) for (const s of c.signatures || []) sigs.add(s);
  return sigs.size ? [...sigs] : undefined;
}

/** Verify an APK's signature and return its signer certificate SHA-256 digests. */
export async function apkCerts(file: string): Promise<string[]> {
  let out: string;
  try {
    out = await run(join(buildTools(), 'apksigner'), ['verify', '--print-certs', file], { quiet: true });
  } catch {
    throw new Error(`${file.split('/').pop()} has a missing or invalid signature — the download may be corrupt or modified`);
  }
  const certs = [...new Set([...out.matchAll(/certificate SHA-256 digest: ([0-9a-f]{64})/gi)].map((m) => m[1].toLowerCase()))];
  if (!certs.length) throw new Error(`Couldn't read the signing certificate of ${file.split('/').pop()}`);
  return certs;
}

const short = (c: string) => c.slice(0, 16).replace(/(.{4})/g, '$1 ').trim() + '…';

/**
 * Make sure the original app comes from its real developer: the signature must be valid, match the
 * certificates published by the patch maintainers (when they publish them), and match the certificate
 * pinned on the first build.
 */
async function checkOriginal(app: AppConfig, p: Plan, certs: string[]) {
  const st = loadState(app.id);
  info(`Original signature: ${certs.map(short).join(', ')}`);
  const overlap = (a: string[], b: string[]) => a.some((x) => b.includes(x));
  if (p.expectedSignatures?.length) {
    if (!overlap(certs, p.expectedSignatures))
      throw Object.assign(
        new Error(
          `The downloaded ${app.name} is not signed by its developer: its certificate (${short(certs[0])}) doesn't match the one ${p.expectedFrom} publishes for this app. The file may have been modified by the source.`,
        ),
        { attention: 'signature-changed' },
      );
    ok(`Signature matches the one published by ${p.expectedFrom}`);
  }
  const pinned = st.sourceCert?.sha256;
  if (pinned?.length) {
    if (!overlap(certs, pinned))
      throw Object.assign(
        new Error(
          `${app.name} ${p.version ?? ''} is signed by a different key (${short(certs[0])}) than the one pinned on ${st.sourceCert!.firstSeen.slice(0, 10)} (${short(pinned[0])}). The download may have been tampered with. If the developer really changed keys, choose "Trust new signature" in Relevance.`.replace('  ', ' '),
        ),
        { attention: 'signature-changed' },
      );
    ok('Signature matches the pinned original');
  } else {
    await updateState(
      app.id,
      (s) => (s.sourceCert = { sha256: certs, firstSeen: new Date().toISOString(), version: p.version || undefined }),
      `relevance: pin original signature of ${app.name}`,
    );
    ok('Pinned the original signature — future downloads must match it');
  }
}

export interface Plan {
  appId: string;
  version: string | null;
  reason: string;
  download?: { url: string; fileName: string; version?: string };
  configHash: string;
  patchVersion?: string;
  /** original signing certificates published by the patch maintainers for this app */
  expectedSignatures?: string[];
  expectedFrom?: string;
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
    const sv = await sourceVersions(app);
    available = sv.versions;
    ok(`Source offers ${available ? available.length + ' versions, latest ' + (sv.latest || available[0]) : 'the latest version only'}`);
  } catch (e) {
    if (app.source.type === 'apkpure') throw e;
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

  const dl = await sourceDownload(app, t.target);
  const version = dl.version || t.target;
  const same =
    state.current &&
    version &&
    (state.current.sourceVersion ?? state.current.version) === version &&
    state.configHash === hash &&
    (!index || state.patchVersion === index.version);
  const p: Plan = {
    appId,
    version: version || null,
    reason: t.reason,
    download: { url: dl.url, fileName: dl.fileName, version: dl.version },
    configHash: hash,
    patchVersion: index?.version,
    expectedSignatures: expectedSignatures(index, app.packageName),
    expectedFrom: index ? `${index.name} ${index.version}` : undefined,
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

/** Names of the entries in a zip's central directory (outer level only). */
export function zipEntries(file: string): string[] {
  const buf = readFileSync(file);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66000); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return [];
  let cdSize = buf.readUInt32LE(eocd + 12);
  let cdOff = buf.readUInt32LE(eocd + 16);
  if (cdOff === 0xffffffff) {
    // zip64
    const loc = eocd - 20;
    if (buf.readUInt32LE(loc) === 0x07064b50) {
      const z64 = Number(buf.readBigUInt64LE(loc + 8));
      cdSize = Number(buf.readBigUInt64LE(z64 + 40));
      cdOff = Number(buf.readBigUInt64LE(z64 + 48));
    }
  }
  const names: string[] = [];
  let p = cdOff;
  while (p < cdOff + cdSize && buf.readUInt32LE(p) === 0x02014b50) {
    const n = buf.readUInt16LE(p + 28);
    const e = buf.readUInt16LE(p + 30);
    const c = buf.readUInt16LE(p + 32);
    names.push(buf.toString('utf8', p + 46, p + 46 + n));
    p += 46 + n + e + c;
  }
  return names;
}

export async function fetchApk(appId: string) {
  const p = loadPlan();
  const cfg = loadConfig();
  const app = getApp(cfg, appId);
  if (!p.download) throw new Error('Nothing to download');
  const raw = `${WORK}/download.bin`;
  if (p.download.url.startsWith('apkeep:')) {
    const [pkg, ver] = p.download.url.slice(7).split('@');
    renameSync(await apkeepDownload(pkg, ver), raw);
  } else {
    info(`Fetching ${app.name} ${p.version ?? ''} from ${new URL(p.download.url).host}`);
    const headers: Record<string, string> = {};
    if (app.source.type === 'upload' || p.download.url.includes(`github.com/${REPO}/`)) headers.Authorization = `Bearer ${env.GITHUB_TOKEN}`;
    await download(p.download.url, raw, headers);
  }
  const names = zipEntries(raw);
  const looksApk = names.includes('AndroidManifest.xml');
  const isBundle = !looksApk && names.some((n) => /\.apk$/i.test(n));
  const input = `${WORK}/input.apk`;
  let certs: string[];
  if (looksApk) {
    renameSync(raw, input);
    certs = await apkCerts(input);
  } else if (isBundle) {
    const bundle = `${WORK}/bundle.xapk`;
    renameSync(raw, bundle);
    // verify every split before merging (the merged APK is unsigned)
    const splits = `${WORK}/splits`;
    rmSync(splits, { recursive: true, force: true });
    mkdirSync(splits, { recursive: true });
    await run(
      'python3',
      ['-c', 'import zipfile,sys\nz=zipfile.ZipFile(sys.argv[1])\nfor n in z.namelist():\n  if n.endswith(".apk"): z.extract(n, sys.argv[2])', bundle, splits],
      { quiet: true },
    );
    const files = readdirSync(splits, { recursive: true }).map(String).filter((f) => f.endsWith('.apk'));
    if (!files.length) throw new Error('The bundle contains no APKs');
    const sets = await Promise.all(files.map((f) => apkCerts(join(splits, f))));
    certs = sets[0];
    if (sets.some((c) => !c.some((x) => certs.includes(x)))) throw new Error('The split APKs in this bundle are signed by different keys — refusing to use it');
    ok(`All ${files.length} split APKs carry valid signatures from the same key`);
    info('Split APK bundle detected — merging into a single APK with APKEditor');
    const ed = await fetchCli('apkeditor');
    await run('java', ['-jar', ed, 'm', '-i', bundle, '-o', input, '-f']);
  } else {
    throw new Error('The downloaded file is not an APK');
  }
  const meta = await apkInfo(input);
  ok(`${meta.packageName} ${meta.versionName} (${meta.versionCode}), ${(statSync(input).size / 1048576).toFixed(1)} MB`);
  if (p.version && meta.versionName !== p.version) {
    if (app.source.type === 'apkpure' || app.source.type === 'fdroid')
      throw new Error(`The source delivered version ${meta.versionName}, but ${p.version} was requested`);
    if (app.source.type !== 'upload') log(`Note: release ${p.version} contains app version ${meta.versionName}`);
  }
  if (meta.packageName !== app.packageName) warn(`Package name ${meta.packageName} differs from the configured ${app.packageName}`);
  await checkOriginal(app, p, certs);
  writeJson(`${WORK}/input.json`, meta);
  copyFileSync(input, `${WORK}/current.apk`);
  if (isBundle && !p.rebuild) {
    info('A merged bundle has no valid signature — signing it with your key');
    await sign(appId);
  }
}

// ------------------------------------------------------------------ patch

function optionArg(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (Array.isArray(v)) return `[${v.map((x) => optionArg(x).replace(/,/g, '\\,')).join(',')}]`;
  if (typeof v === 'string') return v.replace(/(["'])/g, '\\$1');
  return String(v);
}

// ------------------------------------------------------------------ branding through the patch bundle
// Apps like YouTube can't survive an apktool round trip once patched, but their bundles ship
// "Custom branding" (name + icon) and ReVanced ships "Change package name". When available,
// customizations go through those patches and the apktool step only does what is left.

export type Branding = { name?: boolean; icon?: boolean; packageName?: boolean; via?: string[] };

/** Solid-colour RGB PNG (adaptive icon background). */
export function solidPng(size: number, hex: string): Buffer {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim()) || [, 'ffffff'];
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1]!.slice(i, i + 2), 16));
  const row = Buffer.alloc(1 + size * 3);
  for (let x = 0; x < size; x++) row.set([r, g, b], 1 + x * 3);
  const raw = Buffer.concat(Array.from({ length: size }, () => row));
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const DENSITIES: [string, number][] = [['mdpi', 108], ['hdpi', 162], ['xhdpi', 216], ['xxhdpi', 324], ['xxxhdpi', 432]];

/** High-quality downscale with the JDK (no image tools on the runner otherwise). */
async function resizePng(src: string, outs: string[]) {
  const file = `${WORK}/tools/Resize.java`;
  mkdirSync(`${WORK}/tools`, { recursive: true });
  writeFileSync(
    file,
    `import java.awt.*; import java.awt.image.*; import javax.imageio.ImageIO; import java.io.File;
public class Resize { public static void main(String[] a) throws Exception {
  BufferedImage in = ImageIO.read(new File(a[0]));
  for (int i = 1; i + 1 < a.length; i += 2) {
    int s = Integer.parseInt(a[i + 1]);
    Image sc = in.getScaledInstance(s, s, Image.SCALE_AREA_AVERAGING);
    BufferedImage out = new BufferedImage(s, s, BufferedImage.TYPE_INT_ARGB);
    Graphics2D g = out.createGraphics(); g.drawImage(sc, 0, 0, null); g.dispose();
    ImageIO.write(out, "png", new File(a[i]));
  } } }`,
  );
  await run('java', ['-Djava.awt.headless=true', file, src, ...outs], { quiet: true });
}

export async function brandWithPatches(app: AppConfig, index: PatchIndex | null, selected: { name: string; options: Record<string, unknown> }[]): Promise<Branding> {
  const c = app.customize || {};
  const done: Branding = { via: [] };
  if (!index || (app.tool !== 'morphe' && app.tool !== 'revanced')) return done;
  const prefix = app.tool;
  const select = (name: string) => {
    let s = selected.find((x) => x.name === name);
    if (!s) selected.push((s = { name, options: {} }));
    if (!done.via!.includes(name)) done.via!.push(name);
    return s;
  };
  const brand = findPatch(index, 'Custom branding', app.packageName);
  const opts = brand?.options || [];
  const nameKey = opts.find((o) => /name/i.test(o.key))?.key;
  const iconKey = opts.find((o) => /custom ?icon/i.test(o.key))?.key;
  const fg = c.icon?.path?.replace(/\.png$/, '-fg.png');
  const canIcon = Boolean(c.icon && iconKey && fg && existsSync(fg));
  // only pull the patch in when the user didn't pick it if it can carry the icon (otherwise it would swap in the patcher's icon)
  const chosen = selected.some((x) => x.name === 'Custom branding');
  const appIconKey = opts.find((o) => /^appIcon$/i.test(o.key))?.key;
  if (brand && (chosen || canIcon || (c.name && nameKey && appIconKey))) {
    // pulled in only for the name: keep the app's own icon
    if (!chosen && !canIcon && appIconKey) select('Custom branding').options[appIconKey] = 'original';
    if (c.name && nameKey) {
      select('Custom branding').options[nameKey] = c.name;
      done.name = true;
    }
    if (canIcon) {
      const dir = `${WORK}/branding`;
      rmSync(dir, { recursive: true, force: true });
      const bg = readJson<{ background?: string }>(c.icon!.path.replace(/\.png$/, '.json'), {}).background || '#FFFFFF';
      const jobs: string[] = [];
      for (const [d, px] of DENSITIES) {
        mkdirSync(`${dir}/mipmap-${d}`, { recursive: true });
        jobs.push(`${dir}/mipmap-${d}/${prefix}_adaptive_foreground_custom.png`, String(px));
        writeFileSync(`${dir}/mipmap-${d}/${prefix}_adaptive_background_custom.png`, solidPng(px, bg));
      }
      await resizePng(fg!, jobs);
      const s = select('Custom branding');
      s.options[iconKey!] = resolve(dir);
      if (appIconKey) s.options[appIconKey] = 'custom';
      done.icon = true;
    }
  }
  const pkgPatch = c.packageName && c.packageName !== app.packageName ? findPatch(index, 'Change package name', app.packageName) : null;
  const pkgKey = pkgPatch?.options?.find((o) => /package/i.test(o.key))?.key;
  if (pkgPatch && pkgKey) {
    const s = select('Change package name');
    s.options[pkgKey] = c.packageName;
    for (const o of pkgPatch.options || []) if (/providers|permissions/i.test(o.key) && s.options[o.key] === undefined) s.options[o.key] = true;
    done.packageName = true;
  }
  if (done.name || done.icon || done.packageName) {
    const what = [done.name && 'name', done.icon && 'icon', done.packageName && 'package name'].filter(Boolean).join(', ');
    info(`Applying your ${what} with ${done.via!.join(' + ')} (no apktool round trip needed)`);
  }
  return done;
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
    const selected = app.patches.map((x) => ({ name: x.name, options: { ...(x.options || {}) } as Record<string, unknown> }));
    const handled = await brandWithPatches(app, await loadIndex(ps), selected);
    for (const sel of selected) {
      args.push('-e', sel.name);
      for (const [k, v] of Object.entries(sel.options)) {
        if (v === undefined || v === '' || v === null) continue;
        args.push(`-O${k}=${optionArg(v)}`);
      }
    }
    writeJson(`${WORK}/branding.json`, handled);
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

// Resource folders whose qualifiers aapt2 rejects (e.g. values-mcc1001 in YouTube: country codes
// have three digits, so these never match a real device and Android ignores them).
export function invalidQualifierDirs(resDir: string): string[] {
  if (!existsSync(resDir)) return [];
  return readdirSync(resDir).filter((d) => d.split('-').slice(1).some((q) => /^(mcc|mnc)\d{4,}$/.test(q)));
}
function dropConfigs(resDir: string, dirs: string[]) {
  if (!dirs.length) return;
  for (const d of dirs) rmSync(join(resDir, d), { recursive: true, force: true });
  warn(`Dropped ${dirs.length} resource folder${dirs.length === 1 ? '' : 's'} for configurations no device can have (${dirs.slice(0, 4).join(', ')}${dirs.length > 4 ? ', …' : ''})`);
}

export async function customize(appId: string) {
  const cfg = loadConfig();
  const app = getApp(cfg, appId);
  const handled = readJson<Branding>(`${WORK}/branding.json`, {});
  const all = app.customize || {};
  const c = { name: handled.name ? undefined : all.name, packageName: handled.packageName ? undefined : all.packageName, icon: handled.icon ? undefined : all.icon };
  if (!c.name && !c.packageName && !c.icon) {
    if (handled.via?.length) return ok(`Name, icon and package were already applied by ${handled.via.join(' + ')} — nothing left to decompile`);
    return log('No basic modifications — skipping');
  }
  if (handled.via?.length) info(`${handled.via.join(' + ')} took care of part of it`);
  if (!c.icon) {
    // name and package only: edit the compiled manifest directly, nothing gets decompiled
    info('Editing the compiled manifest (no decompile needed)');
    const apk = resolve(`${WORK}/current.apk`);
    const tmp = `${WORK}/manifest-edit`;
    rmSync(tmp, { recursive: true, force: true });
    mkdirSync(tmp, { recursive: true });
    await run('python3', ['-I', '-c', 'import sys,zipfile;open(sys.argv[2],"wb").write(zipfile.ZipFile(sys.argv[1]).read("AndroidManifest.xml"))', apk, `${tmp}/AndroidManifest.xml`], { quiet: true });
    const r = editManifest(readFileSync(`${tmp}/AndroidManifest.xml`), { packageName: c.packageName, label: c.name });
    writeFileSync(`${tmp}/AndroidManifest.xml`, r.bytes);
    await run('zip', ['-q', apk, 'AndroidManifest.xml'], { cwd: tmp, quiet: true });
    for (const ch of r.changes) ok(ch.charAt(0).toUpperCase() + ch.slice(1));
    const after = await apkInfo(apk);
    if (c.packageName && after.packageName !== c.packageName) throw new Error(`Manifest edit failed: package is ${after.packageName}`);
    return ok('Customized APK ready');
  }
  const apktool = await fetchCli('apktool');
  const dec = `${WORK}/decoded`;
  rmSync(dec, { recursive: true, force: true });
  info('Decompiling resources (code stays untouched)');
  await run('java', ['-jar', apktool, 'd', '-f', '-s', '-o', dec, `${WORK}/current.apk`]);
  const meta = readJson<{ packageName: string }>(`${WORK}/input.json`, { packageName: app.packageName });
  const manifestPath = join(dec, 'AndroidManifest.xml');
  const xml = readFileSync(manifestPath, 'utf8');
  const curPkg = xml.match(/<manifest\b[^>]*package="([^"]+)"/)?.[1] || meta.packageName;
  // drop icon resources from an earlier Relevance build of this APK (re-customizing a clone)
  const resDir = join(dec, 'res');
  for (const d of existsSync(resDir) ? readdirSync(resDir) : []) {
    const dir = join(resDir, d);
    for (const f of readdirSync(dir)) {
      if (f.startsWith('relevance_icon')) rmSync(join(dir, f));
      else if (d.startsWith('values') && f.endsWith('.xml') && f !== 'public.xml') {
        const t = readFileSync(join(dir, f), 'utf8');
        const n = t.replace(/^\s*<(color|drawable|mipmap)\s+name="relevance_icon[^"]*"[^>]*(?:\/>|>[^<]*<\/\1>)\s*$/gm, '');
        if (n !== t) writeFileSync(join(dir, f), n);
      }
    }
  }
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
  dropConfigs(resDir, invalidQualifierDirs(resDir));
  try {
    await run('java', ['-jar', apktool, 'b', '-o', `${WORK}/customized.apk`, dec]);
  } catch (e: any) {
    // aapt2 names any other configuration it can't compile; those folders can never match a device
    const bad = [...new Set([...String(e.output || '').matchAll(/res\/([^/\s]+)\/[^:\s]+: error: invalid configuration/g)].map((m) => m[1]))];
    if (!bad.length) throw e;
    dropConfigs(resDir, bad);
    info('Rebuilding APK again');
    await run('java', ['-jar', apktool, 'b', '-o', `${WORK}/customized.apk`, dec]);
  }
  copyFileSync(`${WORK}/customized.apk`, `${WORK}/current.apk`);
  ok('Customized APK ready');
}

// ------------------------------------------------------------------ sign

export async function sign(appId: string) {
  const bt = buildTools();
  const alias = loadConfig().settings.signing?.alias || env.RELEVANCE_KEY_ALIAS || 'relevance';
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
    '--ks-key-alias', alias,
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
    sourceVersion: p.version || meta.versionName,
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
