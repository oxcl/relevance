import type { AppConfig, AppState, PatchIndex, PatchSource, RelevanceConfig } from '$shared/types';
import { ENGINE_VERSION } from '$shared/types';
import { BUILD_WORKFLOW, PUBLISH_WORKFLOW, updateWorkflow } from '$shared/templates';
import { fromPatchesList } from '$shared/patchlist';
import { GitHubProvider } from './github';
import type { FileChange, ProviderUser, RepoSummary, WorkflowRun } from './provider';

export const BUILTIN_SOURCES: PatchSource[] = [
  { id: 'revanced', tool: 'revanced', name: 'ReVanced', url: 'https://gitlab.com/ReVanced/revanced-patches', builtin: true },
  { id: 'morphe', tool: 'morphe', name: 'Morphe', url: 'https://github.com/MorpheApp/morphe-patches', builtin: true },
  { id: 'lsposed', tool: 'lspatch', name: 'LSPosed modules', url: 'https://modules.lsposed.org', builtin: true },
];
const INDEX_BASE = 'https://raw.githubusercontent.com/oxcl/relevance/index';

export const session = $state<{
  token: string | null;
  user: ProviderUser | null;
  repo: string | null;
  repoInfo: RepoSummary | null;
  status: 'idle' | 'loading' | 'ready' | 'signed-out' | 'needs-setup' | 'error';
  error: string | null;
  server: { oauth: boolean; email: boolean };
}>({
  token: null,
  user: null,
  repo: null,
  repoInfo: null,
  status: 'idle',
  error: null,
  server: { oauth: true, email: false },
});

export const data = $state<{
  loaded: boolean;
  config: RelevanceConfig | null;
  states: Record<string, AppState>;
  runs: WorkflowRun[];
  pagesUrl: string | null;
  engineVersion: string | null;
  secrets: string[];
  indexes: Record<string, PatchIndex | null>;
  refreshing: boolean;
}>({
  loaded: false,
  config: null,
  states: {},
  runs: [],
  pagesUrl: null,
  engineVersion: null,
  secrets: [],
  indexes: {},
  refreshing: false,
});

let provider: GitHubProvider | null = null;
export function gh(): GitHubProvider {
  if (!provider) throw new Error('Not signed in');
  return provider;
}

const LS = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string | null) => {
    try {
      v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v);
    } catch {}
  },
};

export async function loadServerConfig() {
  try {
    const r = await fetch('/api/config');
    if (r.ok) session.server = await r.json();
  } catch {}
}

export function signInUrl(ret = '/dashboard') {
  return `/api/auth/login?return=${encodeURIComponent(ret)}`;
}

export function setToken(token: string) {
  LS.set('rv-token', token);
  session.token = token;
  provider = new GitHubProvider(token);
}

export async function signOut(opts: { revoke?: boolean } = {}) {
  const t = session.token;
  if (opts.revoke && t) {
    await fetch('/api/auth/revoke', { method: 'POST', headers: { Authorization: `Bearer ${t}` } }).catch(() => {});
  }
  if (session.user) LS.set(`rv-repo:${session.user.login}`, null);
  LS.set('rv-token', null);
  provider = null;
  Object.assign(session, { token: null, user: null, repo: null, repoInfo: null, status: 'signed-out' });
  Object.assign(data, { loaded: false, config: null, states: {}, runs: [], pagesUrl: null, engineVersion: null, secrets: [] });
}

/** Restore the session and locate the user's Relevance repository. */
export async function initSession(): Promise<void> {
  const token = LS.get('rv-token');
  if (!token) {
    session.status = 'signed-out';
    return;
  }
  setToken(token);
  session.status = 'loading';
  try {
    session.user = await gh().me();
  } catch (e: any) {
    if (e.status === 401) {
      await signOut();
      return;
    }
    session.status = 'error';
    session.error = e.message;
    return;
  }
  const remembered = LS.get(`rv-repo:${session.user.login}`);
  let repo: string | null = null;
  if (remembered) {
    const cfg = await gh().readText(remembered, 'relevance.json').catch(() => null);
    if (cfg) repo = remembered;
  }
  if (!repo) {
    const repos = await gh().listRepos();
    for (const r of repos.filter((r) => r.isRelevance)) {
      if (await gh().readText(r.fullName, 'relevance.json')) {
        repo = r.fullName;
        break;
      }
    }
  }
  if (!repo) {
    session.status = 'needs-setup';
    return;
  }
  await useRepo(repo);
}

export async function useRepo(repo: string) {
  session.repo = repo;
  LS.set(`rv-repo:${session.user!.login}`, repo);
  session.repoInfo = await gh().getRepo(repo).catch(() => null);
  await loadAll();
  session.status = 'ready';
}

export async function loadAll() {
  const repo = session.repo!;
  const [cfg, stateFiles, runs, pages, ev, secrets] = await Promise.all([
    gh().readText(repo, 'relevance.json'),
    gh().listDir(repo, '.relevance/state'),
    gh().listRuns(repo, { perPage: 40 }),
    gh().pagesUrl(repo),
    gh().readText(repo, '.relevance/engine.version'),
    gh().listSecrets(repo).catch(() => [] as string[]),
  ]);
  if (!cfg) throw new Error('relevance.json is missing from the repository');
  data.config = JSON.parse(cfg.text);
  const states: Record<string, AppState> = {};
  await Promise.all(
    stateFiles
      .filter((f) => f.name.endsWith('.json'))
      .map(async (f) => {
        const t = await gh().readText(repo, f.path);
        if (t) states[f.name.replace(/\.json$/, '')] = JSON.parse(t.text);
      }),
  );
  data.states = states;
  data.runs = runs;
  data.pagesUrl = pages;
  data.engineVersion = ev?.text.trim() || null;
  data.secrets = secrets;
  data.loaded = true;
}

export async function refresh(opts: { states?: boolean } = { states: true }) {
  if (!session.repo || data.refreshing) return;
  data.refreshing = true;
  try {
    const repo = session.repo;
    data.runs = await gh().listRuns(repo, { perPage: 40 });
    if (opts.states) {
      const files = await gh().listDir(repo, '.relevance/state');
      await Promise.all(
        files.map(async (f) => {
          const t = await gh().readText(repo, f.path);
          if (t) data.states[f.name.replace(/\.json$/, '')] = JSON.parse(t.text);
        }),
      );
    }
  } catch {
  } finally {
    data.refreshing = false;
  }
}

/** Mutate relevance.json against the latest version in the repository and commit it (plus extra files). */
export async function saveConfig(mutate: (cfg: RelevanceConfig) => void, message: string, extra: FileChange[] = []) {
  const repo = session.repo!;
  const latest = await gh().readText(repo, 'relevance.json');
  const cfg: RelevanceConfig = latest ? JSON.parse(latest.text) : structuredClone($state.snapshot(data.config));
  mutate(cfg);
  const files: FileChange[] = [{ path: 'relevance.json', content: JSON.stringify(cfg, null, 2) + '\n' }, ...extra];
  if (data.engineVersion !== ENGINE_VERSION) files.push(...(await engineFiles(repo)));
  await gh().commit(repo, files, message);
  data.config = cfg;
  if (data.engineVersion !== ENGINE_VERSION) data.engineVersion = ENGINE_VERSION;
  return cfg;
}

export async function engineFiles(repo: string): Promise<FileChange[]> {
  const engineSource = (await import('../generated/engine.mjs?raw')).default;
  return [
    { path: '.relevance/engine.mjs', content: engineSource },
    { path: '.relevance/engine.version', content: ENGINE_VERSION + '\n' },
    { path: '.github/workflows/relevance-build.yml', content: BUILD_WORKFLOW },
    { path: '.github/workflows/relevance-publish.yml', content: PUBLISH_WORKFLOW },
    { path: '.github/workflows/relevance-update.yml', content: updateWorkflow(repo) },
  ];
}

export async function ensureEngine() {
  if (!session.repo || !data.loaded || data.engineVersion === ENGINE_VERSION) return false;
  await gh().commit(session.repo, await engineFiles(session.repo), `relevance: update build engine to ${ENGINE_VERSION}`);
  data.engineVersion = ENGINE_VERSION;
  return true;
}

// ---------------------------------------------------------------- builds

export async function startBuild(appId: string, force = true) {
  await gh().dispatch(session.repo!, 'relevance-build.yml', { app: appId, force: String(force), trigger: 'manual' });
  // GitHub needs a moment before the run shows up
  for (let i = 0; i < 12; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    const runs = await gh().listRuns(session.repo!, { perPage: 10, workflow: 'relevance-build.yml' });
    const run = runs.find((r) => r.appId === appId && Date.now() - new Date(r.createdAt).getTime() < 90_000);
    if (run) {
      data.runs = [run, ...data.runs.filter((r) => r.id !== run.id)];
      return run;
    }
  }
  return null;
}

export async function checkUpdates(appId?: string) {
  await gh().dispatch(session.repo!, 'relevance-update.yml', { app: appId || '' });
}

export async function publishSite() {
  await gh().dispatch(session.repo!, 'relevance-publish.yml', {});
}

export function runningBuilds() {
  return data.runs.filter((r) => r.kind === 'build' && r.status !== 'completed');
}

// ---------------------------------------------------------------- derived helpers

export function appState(id: string): AppState {
  return data.states[id] || { appId: id, status: 'never', releases: [], history: [] };
}

export function appStatus(app: AppConfig): 'building' | 'failed' | 'needs-review' | 'ok' | 'never' | 'disabled' | 'update' {
  if (!app.enabled) return 'disabled';
  if (data.runs.some((r) => r.kind === 'build' && r.appId === app.id && r.status !== 'completed')) return 'building';
  const s = appState(app.id);
  if (s.status === 'failed') return 'failed';
  if (s.status === 'needs-review') return 'needs-review';
  if (!s.current) return 'never';
  if (s.targetVersion && (s.current.sourceVersion ?? s.current.version) !== s.targetVersion) return 'update';
  return 'ok';
}

export interface Attention {
  appId: string;
  title: string;
  message: string;
  kind: string;
  at: string;
}
export function attentionItems(): Attention[] {
  const out: Attention[] = [];
  for (const app of data.config?.apps || []) {
    const s = data.states[app.id];
    if (s?.attention) {
      out.push({
        appId: app.id,
        title: app.customize?.name || app.name,
        message: s.attention.message,
        kind: s.attention.kind,
        at: s.attention.at,
      });
    }
  }
  return out.sort((a, b) => b.at.localeCompare(a.at));
}

export function patchSources(): PatchSource[] {
  return [...BUILTIN_SOURCES, ...(data.config?.patchSources || [])];
}

// ---------------------------------------------------------------- patch indexes

const inflight = new Map<string, Promise<PatchIndex | null>>();
export function loadIndex(src: PatchSource): Promise<PatchIndex | null> {
  if (src.id in data.indexes) return Promise.resolve(data.indexes[src.id]);
  if (inflight.has(src.id)) return inflight.get(src.id)!;
  const p = (async () => {
    let idx: PatchIndex | null = null;
    try {
      if (src.builtin) {
        const r = await fetch(`${INDEX_BASE}/${src.id}.json`, { cache: 'no-cache' });
        if (r.ok) idx = await r.json();
      } else if (session.repo) {
        const t = await gh().readText(session.repo, `.relevance/index/${src.id}.json`);
        if (t) idx = JSON.parse(t.text);
      }
    } catch {}
    if (!idx) {
      const m = src.url.match(/github\.com\/([^/]+)\/([^/#?]+)/);
      if (m) {
        try {
          const r = await fetch(`https://raw.githubusercontent.com/${m[1]}/${m[2]}/main/patches-list.json`);
          if (r.ok) {
            const j = await r.json();
            idx = {
              tool: src.tool,
              sourceId: src.id,
              name: src.name,
              version: j.version || 'latest',
              fetchedAt: new Date().toISOString(),
              patches: fromPatchesList(j),
            };
          }
        } catch {}
      }
    }
    data.indexes[src.id] = idx;
    inflight.delete(src.id);
    return idx;
  })();
  inflight.set(src.id, p);
  return p;
}

export function sourceFor(tool: string, id?: string): PatchSource | undefined {
  const all = patchSources();
  return all.find((s) => s.id === id && s.tool === tool) || all.find((s) => s.builtin && s.tool === tool);
}

export function displayName(app: AppConfig) {
  return app.customize?.name || app.name;
}
export function displayPackage(app: AppConfig) {
  return app.customize?.packageName || app.packageName;
}

/** Image url for an app icon (custom icon in repo, or source icon). */
const iconCache = new Map<string, string>();
export async function appIconUrl(app: AppConfig): Promise<string | null> {
  const p = app.customize?.icon?.path;
  if (p && session.repo) {
    const key = `${p}@${app.updatedAt}`;
    if (iconCache.has(key)) return iconCache.get(key)!;
    if (!session.repoInfo?.private) {
      const u = `${gh().rawUrl(session.repo, p)}?v=${encodeURIComponent(app.updatedAt)}`;
      iconCache.set(key, u);
      return u;
    }
    const u = await gh().readBlobUrl(session.repo, p);
    if (u) iconCache.set(key, u);
    return u;
  }
  if (app.iconUrl && !/^https?:/.test(app.iconUrl) && session.repo) {
    if (!session.repoInfo?.private) return gh().rawUrl(session.repo, app.iconUrl);
    return gh().readBlobUrl(session.repo, app.iconUrl);
  }
  return app.iconUrl ? proxied(app.iconUrl) : null;
}

export function proxied(url: string) {
  if (!url || url.startsWith('blob:') || url.startsWith('data:') || url.startsWith('/')) return url;
  return `/api/fetch?url=${encodeURIComponent(url)}`;
}
