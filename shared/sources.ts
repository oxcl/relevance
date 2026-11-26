// App source adapters. Used by the Relevance server (preview, CORS-free) and by the build engine
// running in the user's GitHub Actions (actual downloads).
import type { AppSource, SourceMeta, SourceType } from './types';
import { sortVersionsDesc } from './logic';

export interface SourceInfo extends SourceMeta {
  packageName?: string;
  /** versions the source can deliver; null = only the latest */
  versions: string[] | null;
  /** github: assets of the newest release */
  assets?: { name: string; size: number; url: string }[];
  size?: number;
  autoUpdates: boolean;
}

export interface Download {
  url: string;
  version?: string;
  versionCode?: number;
  fileName: string;
  headers?: Record<string, string>;
}

export interface Ctx {
  fetch: typeof fetch;
  githubToken?: string;
  userAgent?: string;
  /** Relevance server used when a store's web pages refuse datacenter clients (e.g. APKPure from GitHub runners) */
  resolver?: string;
}

const PKG_RE = /^[a-zA-Z][\w]*(\.[a-zA-Z][\w]*)+$/;

export function detectSource(raw: string): SourceType | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  const h = u.hostname.replace(/^www\./, '');
  if (/(^|\.)apkpure\.(com|net)$/.test(h)) return 'apkpure';
  if (h === 'f-droid.org') return 'fdroid';
  if (h === 'github.com') {
    if (/\.apk$/i.test(u.pathname)) return 'url';
    return 'github';
  }
  return 'url';
}

export function sourceLabel(t: SourceType): string {
  return { apkpure: 'APKPure', fdroid: 'F-Droid', github: 'GitHub Releases', url: 'Direct URL', upload: 'Upload' }[t];
}

export function sourceAutoUpdates(t: SourceType): boolean {
  return t === 'apkpure' || t === 'fdroid' || t === 'github';
}

function ua(ctx: Ctx) {
  return { 'User-Agent': ctx.userAgent || 'Relevance (+https://github.com/oxcl/relevance)' };
}

function decodeHtml(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');
}

// ------------------------------------------------------------------ GitHub releases

export function parseGithubRepo(url: string): { owner: string; repo: string } | null {
  const m = url.match(/github\.com\/([^/\s]+)\/([^/\s#?]+)/i);
  if (!m) return null;
  return { owner: m[1], repo: m[2].replace(/\.git$/, '') };
}

async function gh(ctx: Ctx, path: string) {
  const headers: Record<string, string> = { Accept: 'application/vnd.github+json', ...ua(ctx) };
  if (ctx.githubToken) headers.Authorization = `Bearer ${ctx.githubToken}`;
  const r = await ctx.fetch(`https://api.github.com${path}`, { headers });
  if (!r.ok) throw new Error(`GitHub API ${r.status} for ${path}`);
  return r.json();
}

export function rankAssets(names: string[], repo = ''): string[] {
  const tokens = repo.toLowerCase().split(/[^a-z0-9]+|(?<=[a-z])(?=[A-Z])/).filter((t) => t.length >= 3);
  const rtoks = repo.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 3);
  const all = [...new Set([...tokens, ...rtoks])];
  const score = (n: string) => {
    const l = n.toLowerCase();
    let s = 0;
    for (const t of all) if (l.includes(t)) s += 2;
    if (/universal/.test(l)) s += 1;
    if (/arm64/.test(l)) s += 0.5;
    if (/(x86|armeabi|debug|unsigned)/.test(l)) s -= 2;
    if (/(-hw\b|huawei)/.test(l)) s -= 1;
    return s;
  };
  return names.filter((n) => /\.apk$/i.test(n)).map((n, i) => [n, score(n) - i * 0.001] as const).sort((a, b) => b[1] - a[1]).map((x) => x[0]);
}

export function defaultAssetPattern(names: string[], repo = ''): string {
  const prefer = rankAssets(names, repo)[0];
  if (!prefer) return '\\.apk$';
  // turn the concrete file name into a pattern by replacing version-ish parts
  return (
    '^' +
    prefer
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      .replace(/v?\d{3,}|v?\d+(\\\.\d+)+/g, '[\\w.]+') +
    '$'
  );
}

async function githubReleases(ctx: Ctx, src: AppSource) {
  const r = parseGithubRepo(src.url);
  if (!r) throw new Error('Not a GitHub repository URL');
  const rels: any[] = (await gh(ctx, `/repos/${r.owner}/${r.repo}/releases?per_page=30`)) as any[];
  return { repo: r, releases: rels.filter((x) => !x.draft && (src.prerelease || !x.prerelease)) };
}

function pickAsset(rel: any, pattern?: string) {
  const re = new RegExp(pattern || '\\.apk$', 'i');
  return (rel.assets || []).find((a: any) => re.test(a.name)) || (rel.assets || []).find((a: any) => /\.apk$/i.test(a.name));
}

const tagVersion = (t: string) => t.replace(/^[^0-9]*/, '') || t;

// ------------------------------------------------------------------ resolve

export async function resolveSource(src: AppSource, ctx: Ctx): Promise<SourceInfo> {
  switch (src.type) {
    case 'github': {
      const { repo, releases } = await githubReleases(ctx, src);
      const meta: any = await gh(ctx, `/repos/${repo.owner}/${repo.repo}`).catch(() => ({}));
      const withApk = releases.filter((r) => pickAsset(r, src.assetPattern));
      const latest = withApk[0] || releases[0];
      return {
        name: meta.name || repo.repo,
        summary: meta.description || undefined,
        website: meta.homepage || meta.html_url,
        iconUrl: meta.owner?.avatar_url,
        versions: withApk.map((r) => tagVersion(r.tag_name)),
        latest: latest ? tagVersion(latest.tag_name) : undefined,
        assets: (latest?.assets || []).map((a: any) => ({ name: a.name, size: a.size, url: a.browser_download_url })),
        size: latest ? pickAsset(latest, src.assetPattern)?.size : undefined,
        autoUpdates: true,
      };
    }
    case 'fdroid': {
      const pkg = fdroidPackage(src.url);
      if (!pkg) throw new Error('Could not find a package name in the F-Droid URL');
      const api: any = await (await ctx.fetch(`https://f-droid.org/api/v1/packages/${pkg}`, { headers: ua(ctx) })).json();
      const html = await (await ctx.fetch(`https://f-droid.org/en/packages/${pkg}/`, { headers: ua(ctx) })).text().catch(() => '');
      const name = decodeHtml(html.match(/<h3 class="package-name">\s*([^<]+?)\s*<\/h3>/)?.[1] || '') || pkg;
      const summary = decodeHtml(html.match(/<div class="package-summary">\s*([^<]+?)\s*<\/div>/)?.[1] || '');
      const desc = html.match(/<div class="package-description">([\s\S]*?)<\/div>/)?.[1]?.trim();
      const icon = html.match(/<img class="package-icon" src="([^"]+)"/)?.[1];
      const shots = [...html.matchAll(/<img class="screenshot"[^>]*src="([^"]+)"/g)].map((m) => new URL(m[1], 'https://f-droid.org').href);
      const versions = (api.packages || []).map((p: any) => p.versionName as string);
      return {
        packageName: pkg,
        name,
        summary: summary || undefined,
        description: desc,
        iconUrl: icon ? new URL(icon, 'https://f-droid.org').href : undefined,
        screenshots: shots,
        website: `https://f-droid.org/packages/${pkg}/`,
        versions,
        latest: (api.packages || []).find((p: any) => p.versionCode === api.suggestedVersionCode)?.versionName || versions[0],
        autoUpdates: true,
      };
    }
    case 'apkpure': {
      const { pkg, page } = apkpurePage(src.url);
      const res = await ctx.fetch(page, { headers: ua(ctx), redirect: 'follow' });
      if (!res.ok && !(res.status === 403 && ctx.resolver)) throw new Error(`APKPure responded ${res.status}`);
      const html = res.ok ? await res.text() : '';
      let ld: any = null;
      for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
        try {
          const j = JSON.parse(m[1]);
          const flat = (x: any): any[] => (Array.isArray(x) ? x.flatMap(flat) : x && typeof x === 'object' ? [x, ...flat(x['@graph'] || [])] : []);
          ld = flat(j).find((x: any) => [].concat(x['@type'] || []).some((t: string) => /Application$/.test(t))) || ld;
        } catch {}
      }
      const name = (ld?.name || decodeHtml(html.match(/<h1[^>]*>\s*([^<]+?)\s*</)?.[1] || '') || pkg).trim();
      const latest = [...html.matchAll(/data-dt-version="([^"]+)"/g)].map((m) => m[1]).find((v) => !/SECONDARY/i.test(v));
      const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      let icon =
        html.match(/class="app-icon-img"[^>]*?\ssrc="(https:\/\/image[^"]+)"/)?.[1] ||
        html.match(new RegExp(`alt="${esc} icon"[^>]*?\\ssrc="(https://image[^"]+)"`))?.[1] ||
        html.match(new RegExp(`src="(https://image[^"]+)"[^>]*alt="${esc} icon"`))?.[1] ||
        (typeof ld?.image === 'string' && /icon/.test(ld.image) ? ld.image : undefined);
      if (icon) icon = decodeHtml(icon).replace(/([?&])w=\d+/, '$1w=512');
      const ldShots = [].concat(ld?.screenshot || []).map((x: any) => (typeof x === 'string' ? x : x?.url)).filter(Boolean);
      const rawShots = ldShots.length ? ldShots : [...html.matchAll(/(https:\/\/image[^"\s]*?winudf\.com\/v2\/image1\/[^"\s]*?screen[^"\s]*)/g)].map((m) => m[1]);
      const shots = [...new Map(rawShots.map((u: string) => {
        const url = decodeHtml(u).replace(/([?&])h=\d+/, '$1h=1280');
        return [url.replace(/\?.*$/, ''), url.includes('?') ? url : `${url}?fakeurl=1&type=.jpg`] as [string, string];
      })).values()].slice(0, 8);
      const descHtml = html.match(/<div class="description-content"[^>]*>([\s\S]*?)<\/div>/)?.[1];
      const description = ld?.description || (descHtml ? decodeHtml(descHtml.replace(/<br\s*\/?>/g, '\n').replace(/<[^>]+>/g, '')).trim() : undefined);
      let versions: string[] | null = null;
      try {
        versions = sortVersionsDesc(Object.keys(await apkpureCodes(ctx, src.url)));
      } catch {}
      return {
        packageName: pkg,
        name,
        summary: description ? summarize(String(description)) : undefined,
        description,
        iconUrl: icon,
        screenshots: shots,
        website: page,
        latest: versions?.[0] || latest,
        versions: versions && versions.length ? versions : latest ? [latest] : null,
        autoUpdates: true,
      };
    }
    case 'url':
    case 'upload': {
      const r = await ctx.fetch(src.url, { method: 'HEAD', headers: ua(ctx), redirect: 'follow' }).catch(() => null);
      const size = Number(r?.headers.get('content-length') || 0) || undefined;
      const name = decodeURIComponent(new URL(r?.url || src.url).pathname.split('/').pop() || 'app.apk');
      return {
        name: name.replace(/\.apk$/i, ''),
        versions: src.uploadedVersion ? [src.uploadedVersion] : null,
        latest: src.uploadedVersion,
        size,
        autoUpdates: false,
      };
    }
  }
}

/** First sentence, trimmed to fit an 80 character store summary. */
export function summarize(text: string): string {
  const first = text.replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s/)[0];
  if (first.length <= 80) return first;
  const cut = first.slice(0, 79);
  return cut.slice(0, cut.lastIndexOf(' ') > 40 ? cut.lastIndexOf(' ') : 79).replace(/[,;:]$/, '') + '…';
}

export function fdroidPackage(url: string): string | null {
  const m = url.match(/packages\/([^/?#]+)/);
  return m && PKG_RE.test(m[1]) ? m[1] : null;
}

export function apkpurePage(url: string): { pkg: string; page: string } {
  const u = new URL(url);
  const parts = u.pathname.split('/').filter(Boolean).filter((p) => !/^[a-z]{2}(-[a-z]{2})?$/i.test(p) || PKG_RE.test(p));
  const pkg = parts.find((p) => PKG_RE.test(p));
  if (!pkg) throw new Error('Could not find a package name in the APKPure URL');
  const idx = parts.indexOf(pkg);
  const slug = parts[idx - 1] || 'app';
  return { pkg, page: `https://apkpure.net/${slug}/${pkg}` };
}

/** version name → APKPure version code, parsed from the app's version links. */
export function parseApkpureCodes(html: string, pkg: string): Record<string, number> {
  const out: Record<string, number> = {};
  const esc = pkg.replace(/\./g, '\\.');
  const re = new RegExp(`<a\\b[^>]*href="[^"]*/${esc}/download/([^"/?#]+)"[^>]*data-dt-version-code="(\\d+)"`, 'g');
  for (const m of html.matchAll(re)) out[decodeURIComponent(m[1])] = Number(m[2]);
  // the current release is shown in a header block with version + versioncode attributes
  for (const tag of html.match(/<[^>]*data-dt-versioncode="\d+"[^>]*>/g) || []) {
    const v = tag.match(/data-dt-version="([^"]+)"/)?.[1];
    const c = tag.match(/data-dt-versioncode="(\d+)"/)?.[1];
    const p = tag.match(/data-dt-package(?:-?name)?="([^"]+)"/)?.[1];
    if (v && c && !/SECONDARY/i.test(v) && (!p || p === pkg)) out[v] ??= Number(c);
  }
  return out;
}

/**
 * Version codes for an APKPure app (needed to download a specific version). Reads APKPure's pages
 * directly; when they answer with a bot challenge (they do for GitHub's runners) it asks the
 * Relevance server, which can read them, for the mapping. The file itself is always downloaded
 * directly from d.apkpure.net, which serves every version to any client.
 */
export async function apkpureCodes(ctx: Ctx, url: string, version?: string | null): Promise<Record<string, number>> {
  const { pkg, page } = apkpurePage(url);
  let blocked = false;
  const get = async (u: string) => {
    for (let i = 0; ; i++) {
      const r = await ctx.fetch(u, { headers: ua(ctx), redirect: 'follow' });
      if (r.status !== 429 || i >= 2) return r;
      await new Promise((res) => setTimeout(res, 2000 * (i + 1)));
    }
  };
  const direct = async () => {
    const r = await get(`${page}/versions`);
    if (!r.ok) {
      blocked = true;
      throw new Error(`APKPure versions page responded ${r.status}`);
    }
    const codes = parseApkpureCodes(await r.text(), pkg);
    if (version && !codes[version]) {
      const d = await get(`${page}/download/${encodeURIComponent(version)}`);
      if (d.ok) {
        const html = await d.text();
        const code = html.match(/d\.apkpure\.(?:net|com)\/b\/(?:APK|XAPK)\/[^"'\s]+?versionCode=(\d+)/)?.[1];
        const shown = html.match(/data-dt-version="([^"]+)"/)?.[1];
        if (code && (!shown || shown === version)) codes[version] = Number(code);
      } else if (d.status !== 404) blocked = true;
    }
    return codes;
  };
  try {
    const codes = await direct();
    if (!version || codes[version] || !blocked || !ctx.resolver) return codes;
  } catch (e) {
    if (!blocked || !ctx.resolver) throw e;
  }
  const q = new URLSearchParams({ url: page, ...(version ? { version } : {}) });
  const r = await ctx.fetch(`${ctx.resolver.replace(/\/$/, '')}/api/apkpure/codes?${q}`);
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Couldn't read APKPure versions (${j.error || r.status})`);
  return j.codes || {};
}

/** Map a version to a concrete download. */
export async function getDownload(src: AppSource, version: string | null, ctx: Ctx): Promise<Download> {
  switch (src.type) {
    case 'github': {
      const { releases } = await githubReleases(ctx, src);
      const rel =
        (version && releases.find((r) => tagVersion(r.tag_name) === version || r.tag_name === version)) ||
        releases.find((r) => pickAsset(r, src.assetPattern));
      if (!rel) throw new Error('No release with an APK found');
      const a = pickAsset(rel, src.assetPattern);
      if (!a) throw new Error(`Release ${rel.tag_name} has no asset matching ${src.assetPattern || '.apk'}`);
      return { url: a.browser_download_url, version: tagVersion(rel.tag_name), fileName: a.name };
    }
    case 'fdroid': {
      const pkg = fdroidPackage(src.url)!;
      const api: any = await (await ctx.fetch(`https://f-droid.org/api/v1/packages/${pkg}`, { headers: ua(ctx) })).json();
      const list: any[] = api.packages || [];
      const p =
        (version && list.find((x) => x.versionName === version)) ||
        list.find((x) => x.versionCode === api.suggestedVersionCode) ||
        list[0];
      if (!p) throw new Error('F-Droid has no builds for this package');
      return {
        url: `https://f-droid.org/repo/${pkg}_${p.versionCode}.apk`,
        version: p.versionName,
        versionCode: p.versionCode,
        fileName: `${pkg}_${p.versionCode}.apk`,
      };
    }
    case 'apkpure': {
      const { pkg } = apkpurePage(src.url);
      const codes = await apkpureCodes(ctx, src.url, version);
      const want = version || sortVersionsDesc(Object.keys(codes))[0];
      if (!want || !codes[want]) throw new Error(`APKPure has no download for ${pkg} ${version ?? '(no versions listed)'}`);
      // the APK endpoint returns a plain APK when one exists and the split bundle (XAPK) otherwise
      return { url: `https://d.apkpure.net/b/APK/${pkg}?versionCode=${codes[want]}`, version: want, versionCode: codes[want], fileName: `${pkg}.apk` };
    }
    case 'url':
    case 'upload':
      return { url: src.url, version: src.uploadedVersion, fileName: 'source.apk' };
  }
}
