// Patch bundles: resolve builtin + custom sources and produce normalized indexes.
import { existsSync, readFileSync } from 'node:fs';
import type { PatchDef, PatchIndex, PatchSource, PatchToolId, PatchOptionDef } from '../shared/types';
import { fromPatchesList } from '../shared/patchlist';
export { fromPatchesList };
import { download, ghApi, info, latestReleaseAsset, log, run, WORK } from './util';

export const INDEX_BASE = 'https://raw.githubusercontent.com/oxcl/relevance/index';

export const BUILTIN_SOURCES: PatchSource[] = [
  { id: 'revanced', tool: 'revanced', name: 'ReVanced', url: 'https://gitlab.com/ReVanced/revanced-patches', builtin: true },
  { id: 'morphe', tool: 'morphe', name: 'Morphe', url: 'https://github.com/MorpheApp/morphe-patches', builtin: true },
  { id: 'lsposed', tool: 'lspatch', name: 'LSPosed module repository', url: 'https://modules.lsposed.org', builtin: true },
];

const BUNDLE_EXT: Record<string, RegExp> = {
  revanced: /\.(rvp|jar)$/i,
  morphe: /\.(mpp|rvp|jar)$/i,
};

/** Find a download URL + version for a patch bundle source. */
export async function resolveBundle(src: { tool: PatchToolId; url: string; id?: string }): Promise<{ url: string; version: string }> {
  if (src.id === 'revanced' || /api\.revanced\.app/.test(src.url)) {
    const j: any = await (await fetch('https://api.revanced.app/v5/patches')).json();
    return { url: j.download_url, version: j.version };
  }
  const ext = BUNDLE_EXT[src.tool] || /\.(rvp|mpp|jar)$/i;
  if (ext.test(new URL(src.url).pathname)) return { url: src.url, version: new URL(src.url).pathname.split('/').pop()! };
  const gh = src.url.match(/github\.com\/([^/]+)\/([^/#?]+)/);
  if (gh) {
    const a = await latestReleaseAsset(`${gh[1]}/${gh[2].replace(/\.git$/, '')}`, ext);
    return { url: a.url, version: a.tag };
  }
  const gl = src.url.match(/gitlab\.com\/(.+?)\/?$/);
  if (gl) {
    const proj = encodeURIComponent(gl[1].replace(/\.git$/, ''));
    const rels: any[] = await (await fetch(`https://gitlab.com/api/v4/projects/${proj}/releases?per_page=10`)).json();
    for (const r of rels) {
      const link = (r.assets?.links || []).find((l: any) => ext.test(l.name) || ext.test(l.url));
      if (link) return { url: link.direct_asset_url || link.url, version: r.tag_name };
    }
    throw new Error(`No patch bundle found in GitLab releases of ${gl[1]}`);
  }
  throw new Error(`Unsupported patch source URL: ${src.url}`);
}

const bundleCache = new Map<string, string>();
export async function fetchBundle(src: { tool: PatchToolId; url: string; id?: string }): Promise<{ file: string; version: string }> {
  const b = await resolveBundle(src);
  const cached = bundleCache.get(b.url);
  if (cached) return { file: cached, version: b.version };
  const ext = src.tool === 'morphe' ? '.mpp' : '.rvp';
  const file = `${WORK}/bundles/${(src.id || 'custom').replace(/\W/g, '_')}-${bundleCache.size}${ext}`;
  info(`Downloading ${src.tool} patches ${b.version}`);
  await download(b.url, file);
  bundleCache.set(b.url, file);
  return { file, version: b.version };
}

const cliCache = new Map<string, string>();
export async function fetchCli(tool: PatchToolId | 'apktool' | 'apkeditor'): Promise<string> {
  if (cliCache.has(tool)) return cliCache.get(tool)!;
  const map: Record<string, [string, RegExp]> = {
    revanced: ['ReVanced/revanced-cli', /-all\.jar$/],
    morphe: ['MorpheApp/morphe-cli', /-all\.jar$/],
    lspatch: ['JingMatrix/LSPatch', /^lspatch-.*-release\.jar$/],
    apktool: ['iBotPeaches/Apktool', /^apktool_.*\.jar$/],
    apkeditor: ['REAndroid/APKEditor', /^APKEditor.*\.jar$/],
  };
  const [repo, re] = map[tool];
  const a = await latestReleaseAsset(repo, re);
  const file = `${WORK}/tools/${a.name}`;
  if (!existsSync(file)) {
    info(`Downloading ${repo} ${a.tag}`);
    await download(a.url, file);
  }
  cliCache.set(tool, file);
  return file;
}

// ------------------------------------------------------------------ indexing

/** Parse the text output of `revanced-cli list-patches --index --descriptions --packages --versions --options --universal-patches`. */
export function parseListPatches(text: string): PatchDef[] {
  const lines = text.replace(/\r/g, '').split('\n').map((l) => l.replace(/^(INFO|WARNING|SEVERE):\s?/, ''));
  const out: PatchDef[] = [];
  let cur: (PatchDef & { _section?: string }) | null = null;
  let opt: PatchOptionDef | null = null;
  let compat: { packageName: string; versions: string[] | null } | null = null;
  let inValues = false;
  for (const raw of lines) {
    const depth = raw.match(/^\t*/)![0].length;
    const l = raw.trim();
    if (depth === 0 && /^Index: \d+/.test(l)) {
      cur = { name: '', packages: null, options: [], default: true };
      out.push(cur);
      opt = null;
      compat = null;
      continue;
    }
    if (depth === 0 && l.startsWith('Name: ') && (!cur || cur.name)) {
      cur = { name: '', packages: null, options: [], default: true };
      out.push(cur);
      opt = null;
      compat = null;
    }
    if (!cur) continue;
    if (depth === 0) {
      if (l.startsWith('Name: ')) cur.name = l.slice(6);
      else if (l.startsWith('Description: ')) cur.description = l.slice(13);
      else if (l.startsWith('Enabled: ')) cur.default = l.slice(9) === 'true';
      else if (l === 'Options:') cur._section = 'options';
      else if (l === 'Compatible packages:') {
        cur._section = 'packages';
        cur.packages = [];
      } else if (l && cur._section === undefined && cur.description) cur.description += '\n' + l;
      continue;
    }
    if (cur._section === 'options') {
      if (depth === 1 && l.startsWith('Name: ')) {
        opt = { key: l.slice(6), title: l.slice(6) };
        cur.options!.push(opt);
        inValues = false;
      } else if (opt && depth === 1) {
        if (l.startsWith('Description: ')) opt.description = l.slice(13);
        else if (l.startsWith('Required: ')) opt.required = l.slice(10) === 'true';
        else if (l.startsWith('Default: ')) opt.default = l.slice(9);
        else if (l.startsWith('Type: ')) {
          opt.type = l.slice(6);
          inValues = false;
        } else if (l === 'Possible values:') {
          inValues = true;
          opt.values = {};
        } else if (l && !inValues && opt.description) opt.description += '\n' + l;
      } else if (opt && depth >= 2 && inValues) {
        const m = l.match(/^(.*) \((.*)\)$/);
        if (m) opt.values![m[2]] = m[1];
      }
    } else if (cur._section === 'packages') {
      if (depth === 1 && l.startsWith('Package name: ')) {
        compat = { packageName: l.slice(14), versions: null };
        cur.packages!.push(compat);
      } else if (depth >= 2 && compat && l && l !== 'Compatible versions:') {
        (compat.versions ||= []).push(l);
      }
    }
  }
  for (const p of out) delete (p as any)._section;
  return out.filter((p) => p.name);
}

async function tryPatchesList(url: string): Promise<{ patches: PatchDef[]; version: string } | null> {
  const gh = url.match(/github\.com\/([^/]+)\/([^/#?]+)/);
  if (!gh) return null;
  try {
    const r = await fetch(`https://raw.githubusercontent.com/${gh[1]}/${gh[2]}/main/patches-list.json`);
    if (!r.ok) return null;
    const j: any = await r.json();
    return { patches: fromPatchesList(j), version: j.version || 'unknown' };
  } catch {
    return null;
  }
}

export async function indexSource(src: PatchSource): Promise<PatchIndex> {
  const base = { tool: src.tool, sourceId: src.id, name: src.name, fetchedAt: new Date().toISOString() };
  if (src.tool === 'lspatch') {
    return { ...base, version: new Date().toISOString().slice(0, 10), patches: await indexLsposed() };
  }
  const list = await tryPatchesList(src.url);
  if (list) {
    let bundleUrl: string | undefined;
    try {
      bundleUrl = (await resolveBundle(src)).url;
    } catch {}
    return { ...base, version: list.version, bundleUrl, patches: list.patches };
  }
  const { file, version } = await fetchBundle(src);
  const cli = await fetchCli(src.tool);
  const args =
    src.tool === 'revanced'
      ? ['-jar', cli, 'list-patches', '--index', '--descriptions', '--packages', '--versions', '--options', '--universal-patches', '-p', file, '-b']
      : ['-jar', cli, 'list-patches', '-i', '-d', '-p', '-v', '-o', '-u', '--patches', file];
  const out = await run('java', args, { quiet: false });
  const patches = parseListPatches(out);
  log(`Indexed ${patches.length} patches from ${src.name} ${version}`);
  return { ...base, version, bundleUrl: (await resolveBundle(src)).url, patches };
}

async function indexLsposed(): Promise<PatchDef[]> {
  const r = await fetch('https://modules.lsposed.org/modules.json', { headers: { 'User-Agent': 'Relevance-Indexer' } });
  if (!r.ok) throw new Error(`modules.lsposed.org responded ${r.status}`);
  const mods: any[] = await r.json();
  return mods
    .filter((m) => !m.hide && m.latestRelease)
    .map((m) => ({
      name: m.description || m.name,
      description: m.summary || null,
      default: false,
      packages: Array.isArray(m.scope) && m.scope.length ? m.scope.map((s: string) => ({ packageName: s, versions: null })) : null,
      module: { repo: `Xposed-Modules-Repo/${m.name}`, summary: m.summary || undefined },
    }));
}

/** Load the normalized index for a patch source: builtin ones from Relevance's index branch, custom ones from the user repo. */
export async function loadIndex(src: PatchSource): Promise<PatchIndex | null> {
  const local = `.relevance/index/${src.id}.json`;
  if (!src.builtin && existsSync(local)) return JSON.parse(readFileSync(local, 'utf8'));
  try {
    const r = await fetch(`${INDEX_BASE}/${src.id}.json`);
    if (r.ok) return (await r.json()) as PatchIndex;
  } catch {}
  return null;
}

export async function moduleApk(repoOrUrl: string, dest: string): Promise<string> {
  if (/\.apk(\?|$)/i.test(repoOrUrl)) {
    await download(repoOrUrl, dest);
    return dest;
  }
  const m = repoOrUrl.match(/(?:github\.com\/)?([\w.-]+\/[\w.-]+)\/?$/);
  if (!m) throw new Error(`Unsupported module source ${repoOrUrl}`);
  const a = await latestReleaseAsset(m[1], /\.apk$/i);
  info(`Module ${m[1]} ${a.tag}: ${a.name}`);
  await download(a.url, dest);
  return dest;
}

export async function ghReleaseExists(repo: string) {
  return ghApi(`/repos/${repo}`).then(() => true, () => false);
}
