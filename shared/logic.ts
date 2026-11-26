import type { AppConfig, PatchDef, PatchIndex, Recipe, SelectedPatch, StepDef, ToolId } from './types';

/** Compare two version strings naturally. Returns >0 if a>b. */
export function compareVersions(a: string, b: string): number {
  const pa = String(a).replace(/^v/i, '').split(/[^0-9a-z]+/i).filter(Boolean);
  const pb = String(b).replace(/^v/i, '').split(/[^0-9a-z]+/i).filter(Boolean);
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const x = pa[i];
    const y = pb[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const nx = /^\d+$/.test(x);
    const ny = /^\d+$/.test(y);
    if (nx && ny) {
      const d = Number(x) - Number(y);
      if (d !== 0) return d;
    } else if (nx !== ny) {
      return nx ? 1 : -1; // numbers sort above pre-release words
    } else {
      const c = x.localeCompare(y);
      if (c !== 0) return c;
    }
  }
  return 0;
}

export const sortVersionsDesc = (v: string[]) => [...new Set(v)].sort((a, b) => compareVersions(b, a));

export interface TargetResult {
  /** newest version supported by all selected patches, or null when any version works */
  supported: string[] | null;
  /** the chosen version among available ones */
  target: string | null;
  reason: string;
  conflict?: boolean;
}

/** Patches that apply to a package (including universal ones). */
export function patchesForPackage(index: PatchIndex | null | undefined, pkg: string): PatchDef[] {
  if (!index) return [];
  return index.patches.filter(
    (p) => p.packages === null || p.packages.length === 0 || p.packages.some((c) => c.packageName === pkg),
  );
}

export function specificPatches(index: PatchIndex | null | undefined, pkg: string): PatchDef[] {
  if (!index) return [];
  return index.patches.filter((p) => p.packages?.some((c) => c.packageName === pkg));
}

/** Patch names are only unique per package, so always look them up with the package. */
export function findPatch(index: PatchIndex | null | undefined, name: string, pkg: string): PatchDef | undefined {
  if (!index) return undefined;
  const same = index.patches.filter((p) => p.name === name);
  return (
    same.find((p) => p.packages?.some((c) => c.packageName === pkg)) ||
    same.find((p) => !p.packages || p.packages.length === 0) ||
    same[0]
  );
}

export function versionsFor(p: PatchDef, pkg: string): string[] | null {
  if (!p.packages || p.packages.length === 0) return null;
  const c = p.packages.find((c) => c.packageName === pkg);
  if (!c) return [];
  return c.versions && c.versions.length ? c.versions : null;
}

/** Newest version that the tool supports for this package at all. */
export function newestSupported(index: PatchIndex | null | undefined, pkg: string): string | null {
  const all: string[] = [];
  for (const p of specificPatches(index, pkg)) {
    const v = versionsFor(p, pkg);
    if (v) all.push(...v);
  }
  return all.length ? sortVersionsDesc(all)[0] : null;
}

/**
 * Pick the newest app version that ALL selected patches support (not the absolute latest).
 * `available` is the list of versions the source can deliver (null = only "latest" is possible).
 */
export function pickTarget(
  index: PatchIndex | null | undefined,
  pkg: string,
  selected: SelectedPatch[],
  available: string[] | null,
  pin?: string | null,
): TargetResult {
  if (pin) return { supported: null, target: pin, reason: `Pinned to ${pin}` };
  let set: string[] | null = null;
  for (const s of selected) {
    const def = findPatch(index, s.name, pkg);
    if (!def) continue;
    const v = versionsFor(def, pkg);
    if (v === null) continue;
    set = set === null ? [...v] : set.filter((x) => v.includes(x));
  }
  if (set !== null && set.length === 0) {
    return { supported: [], target: null, reason: 'The selected patches have no app version in common', conflict: true };
  }
  if (set === null) {
    const latest = available?.length ? sortVersionsDesc(available)[0] : null;
    return { supported: null, target: latest, reason: 'Selected patches work with any version — using the latest' };
  }
  const supported = sortVersionsDesc(set);
  if (!available) {
    return { supported, target: supported[0], reason: `Newest version supported by all selected patches` };
  }
  const avail = available.map(String);
  const hit = supported.find((v) => avail.includes(v));
  if (!hit) {
    return {
      supported,
      target: supported[0],
      reason: `Version ${supported[0]} is supported but the source may not provide it`,
    };
  }
  return { supported, target: hit, reason: 'Newest version supported by all selected patches' };
}

/** Does the app need to be decompiled / re-signed at all? */
export function needsRebuild(app: Pick<AppConfig, 'tool' | 'patches' | 'customPatches' | 'customize' | 'name'>): boolean {
  if (app.tool !== 'none') return true;
  const c = app.customize || {};
  return Boolean(c.name || c.packageName || c.icon);
}

export function buildSteps(app: Pick<AppConfig, 'tool' | 'patches' | 'customPatches' | 'customize' | 'name'>): StepDef[] {
  const toolName: Record<ToolId, string> = { revanced: 'ReVanced', morphe: 'Morphe', lspatch: 'LSPatch', none: '' };
  const steps: StepDef[] = [
    { id: 'plan', title: 'Plan', subtitle: 'Resolve version and patches' },
    { id: 'fetch', title: 'Fetch APK', subtitle: 'Download from the source' },
  ];
  if (!needsRebuild(app)) {
    steps.push({ id: 'publish', title: 'Publish', subtitle: 'Release with the original signature' });
    steps.push({ id: 'site', title: 'Publish to F-Droid repo', subtitle: 'Update index and store site' });
    return steps;
  }
  if (app.tool !== 'none') {
    steps.push({
      id: 'patch',
      title: `Patch with ${toolName[app.tool]}`,
      subtitle: app.tool === 'lspatch' ? 'Embed Xposed modules' : `Apply ${app.patches.length} patches`,
    });
  }
  const c = app.customize || {};
  if (c.name || c.packageName || c.icon) {
    steps.push({ id: 'customize', title: 'Decompile & customize', subtitle: 'Name, package and icon' });
  }
  steps.push({ id: 'sign', title: 'Sign', subtitle: 'Sign with your repository key' });
  steps.push({ id: 'publish', title: 'Publish', subtitle: 'Create the GitHub release' });
  steps.push({ id: 'site', title: 'Publish to F-Droid repo', subtitle: 'Update index and store site' });
  return steps;
}

/** Stable hash of everything that influences a build. */
export async function configHash(app: AppConfig): Promise<string> {
  const relevant = {
    source: app.source,
    tool: app.tool,
    patchSourceId: app.patchSourceId,
    patches: [...app.patches].sort((a, b) => a.name.localeCompare(b.name)),
    customPatches: app.customPatches.filter((c) => c.enabled),
    customize: app.customize,
    pin: app.pin ?? null,
  };
  const data = new TextEncoder().encode(stableStringify(relevant));
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`)
    .join(',')}}`;
}

export function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'app'
  );
}

export function isValidPackageName(p: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/.test(p);
}

// ---- recipes (shared via store sites) --------------------------------------------------------

function b64urlEncode(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(s: string): Uint8Array {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}

export function encodeRecipe(r: Recipe): string {
  return b64urlEncode(new TextEncoder().encode(JSON.stringify(r)));
}
export function decodeRecipe(s: string): Recipe | null {
  try {
    const r = JSON.parse(new TextDecoder().decode(b64urlDecode(s)));
    if (r && r.v === 1 && r.source && r.tool) return r as Recipe;
  } catch {}
  return null;
}

export function recipeFromApp(app: AppConfig, patchSource?: { tool: any; name: string; url: string }): Recipe {
  return {
    v: 1,
    name: app.name,
    packageName: app.packageName,
    source: app.source.type === 'upload' ? { ...app.source } : { ...app.source },
    tool: app.tool,
    patchSource,
    patches: app.patches,
    customPatches: app.customPatches,
    customize: {
      name: app.customize.name,
      packageName: app.customize.packageName,
      iconEdit: app.customize.icon?.mode === 'edit' ? app.customize.icon.edit : undefined,
    },
  };
}

export const CATEGORIES = [
  'Connectivity',
  'Development',
  'Games',
  'Graphics',
  'Internet',
  'Money',
  'Multimedia',
  'Navigation',
  'Phone & SMS',
  'Reading',
  'Science & Education',
  'Security',
  'Sports & Health',
  'System',
  'Theming',
  'Time',
  'Writing',
  'Video & Audio',
  'Social',
];

export function formatBytes(n: number | undefined): string {
  if (!n && n !== 0) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
