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

export function defaultAssetPattern(names: string[]): string {
  const apks = names.filter((n) => /\.apk$/i.test(n));
  const prefer =
    apks.find((n) => /universal/i.test(n)) ||
    apks.find((n) => /arm64/i.test(n)) ||
    apks.find((n) => !/(x86|armeabi|debug)/i.test(n)) ||
    apks[0];
  if (!prefer) return '\\.apk$';
  // turn the concrete file name into a pattern by replacing version-ish parts
  return (
    '^' +
    prefer
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      .replace(/v?\d+(\\\.\d+)+([-_.]?[a-z]*\d*)?/gi, '.+') +
    '$'
  );
}

async function githubReleases(ctx: Ctx, src: AppSource) {
  const r = parseGithubRepo(src.url);
  if (!r) throw new Error('Not a GitHub repository URL');
  const rels: any[] = await gh(ctx, `/repos/${r.owner}/${r.repo}/releases?per_page=30`);
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
      if (!res.ok) throw new Error(`APKPure responded ${res.status}`);
      const html = await res.text();
      let ld: any = null;
      for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
        try {
          const j = JSON.parse(m[1]);
          const arr = Array.isArray(j) ? j : [j];
          ld = arr.find((x: any) => x['@type'] === 'MobileApplication') || ld;
        } catch {}
      }
      const latest = html.match(/data-dt-version="([^"]+)"/)?.[1];
      const icon =
        html.match(/alt="[^"]*icon"\s+src="(https:\/\/image[^"]+)"/)?.[1] ||
        (typeof ld?.image === 'string' ? ld.image : undefined);
      const shots = [...new Set([...html.matchAll(/(https:\/\/image[^"\s]*?winudf\.com\/v2\/image1\/[^"\s]*?screen[^"\s]*)/g)].map((m) => decodeHtml(m[1]).replace(/\?.*$/, '')))].slice(0, 8);
      let versions: string[] | null = null;
      try {
        versions = await apkpureVersions(ctx, page);
      } catch {}
      return {
        packageName: pkg,
        name: ld?.name || decodeHtml(html.match(/<h1[^>]*>([^<]+)/)?.[1] || pkg),
        summary: ld?.description ? String(ld.description).split(/(?<=\.)\s/)[0].slice(0, 80) : undefined,
        description: ld?.description,
        iconUrl: icon ? decodeHtml(icon) : undefined,
        screenshots: shots,
        website: page,
        latest,
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
  return { pkg, page: `https://apkpure.com/${slug}/${pkg}` };
}

async function apkpureVersions(ctx: Ctx, page: string): Promise<string[]> {
  const r = await ctx.fetch(`${page}/versions`, { headers: ua(ctx), redirect: 'follow' });
  if (!r.ok) throw new Error(`versions ${r.status}`);
  const html = await r.text();
  const v = [...html.matchAll(/data-dt-version="([^"]+)"/g)].map((m) => m[1]).filter((x) => !/SECONDARY/i.test(x));
  return sortVersionsDesc(v);
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
      const q = version ? `version=${encodeURIComponent(version)}` : 'version=latest';
      return { url: `https://d.apkpure.com/b/APK/${pkg}?${q}`, version: version || undefined, fileName: `${pkg}.apk` };
    }
    case 'url':
    case 'upload':
      return { url: src.url, version: src.uploadedVersion, fileName: 'source.apk' };
  }
}
