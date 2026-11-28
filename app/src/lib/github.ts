import type {
  FileChange,
  HostingProvider,
  Job,
  ProviderUser,
  Release,
  RepoSummary,
  WorkflowRun,
} from './provider';
import { fromB64, sealedBox, toB64 } from './sealed';

const API = 'https://api.github.com';
export const RELEVANCE_TOPIC = 'relevance-apps';

export class GitHubError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

const etags = new Map<string, { etag: string; body: any }>();

export class GitHubProvider implements HostingProvider {
  readonly id = 'github' as const;
  readonly label = 'GitHub';
  private _scopes: string[] = [];

  constructor(private token: string) {}

  scopes() {
    return this._scopes;
  }

  async req<T = any>(path: string, init: RequestInit & { etag?: boolean; raw?: boolean } = {}): Promise<T> {
    const url = path.startsWith('http') ? path : `${API}${path}`;
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${this.token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init.body && typeof init.body === 'string' ? { 'Content-Type': 'application/json' } : {}),
      ...((init.headers as any) || {}),
    };
    const useCache = (init.method || 'GET') === 'GET' && init.etag !== false;
    const cached = useCache ? etags.get(url) : undefined;
    if (cached) headers['If-None-Match'] = cached.etag;
    const r = await fetch(url, { ...init, headers, cache: 'no-store' });
    const sc = r.headers.get('x-oauth-scopes');
    if (sc !== null) this._scopes = sc.split(',').map((s) => s.trim()).filter(Boolean);
    if (r.status === 304 && cached) return cached.body;
    if (!r.ok) {
      let msg = `${r.status}`;
      try {
        const j = await r.json();
        msg = j.message || msg;
        if (j.errors?.length) msg += `: ${j.errors.map((e: any) => e.message || e.code).join(', ')}`;
      } catch {}
      throw new GitHubError(msg, r.status);
    }
    if (r.status === 204 || r.status === 205) return undefined as T;
    if (init.raw) return (await r.text()) as T;
    const body = await r.json();
    const et = r.headers.get('etag');
    if (useCache && et) etags.set(url, { etag: et, body });
    return body;
  }

  async me(): Promise<ProviderUser> {
    const u = await this.req('/user', { etag: false });
    return { login: u.login, name: u.name, avatarUrl: u.avatar_url, id: u.id };
  }

  private toRepo(r: any): RepoSummary {
    return {
      fullName: r.full_name,
      name: r.name,
      owner: r.owner.login,
      private: r.private,
      description: r.description,
      updatedAt: r.pushed_at || r.updated_at,
      isRelevance: (r.topics || []).includes(RELEVANCE_TOPIC),
      defaultBranch: r.default_branch || 'main',
      htmlUrl: r.html_url,
    };
  }

  async listRepos(): Promise<RepoSummary[]> {
    const out: RepoSummary[] = [];
    for (let page = 1; page <= 5; page++) {
      const list: any[] = await this.req(`/user/repos?per_page=100&sort=pushed&affiliation=owner&page=${page}`);
      out.push(...list.map((r) => this.toRepo(r)));
      if (list.length < 100) break;
    }
    return out;
  }

  async createRepo(name: string, isPrivate: boolean): Promise<RepoSummary> {
    const r = await this.req('/user/repos', {
      method: 'POST',
      body: JSON.stringify({
        name,
        private: isPrivate,
        auto_init: true,
        description: 'My apps — built and published with Relevance',
        has_wiki: false,
        has_projects: false,
      }),
    });
    return this.toRepo(r);
  }

  async getRepo(fullName: string) {
    return this.toRepo(await this.req(`/repos/${fullName}`, { etag: false }));
  }

  async markRelevance(fullName: string) {
    const cur = await this.req(`/repos/${fullName}/topics`, { etag: false });
    const names = [...new Set([...(cur.names || []), RELEVANCE_TOPIC, 'f-droid', 'android'])];
    await this.req(`/repos/${fullName}/topics`, { method: 'PUT', body: JSON.stringify({ names }) });
  }

  async setVisibility(fullName: string, isPrivate: boolean) {
    await this.req(`/repos/${fullName}`, { method: 'PATCH', body: JSON.stringify({ private: isPrivate }) });
  }

  async readText(repo: string, path: string) {
    try {
      const j = await this.req(`/repos/${repo}/contents/${encodePath(path)}`);
      if (Array.isArray(j)) return null;
      if (j.content === '' && j.size > 0) {
        const blob = await this.req(j.git_url);
        return { text: decodeUtf8(fromB64(blob.content.replace(/\n/g, ''))), sha: j.sha };
      }
      return { text: decodeUtf8(fromB64((j.content || '').replace(/\n/g, ''))), sha: j.sha };
    } catch (e: any) {
      if (e.status === 404) return null;
      throw e;
    }
  }

  async listDir(repo: string, path: string) {
    try {
      const j = await this.req(`/repos/${repo}/contents/${encodePath(path)}`);
      return Array.isArray(j) ? j.map((x: any) => ({ name: x.name, path: x.path, sha: x.sha, type: x.type })) : [];
    } catch (e: any) {
      if (e.status === 404) return [];
      throw e;
    }
  }

  rawUrl(repo: string, path: string) {
    return `https://raw.githubusercontent.com/${repo}/HEAD/${encodePath(path)}`;
  }

  async readBlobUrl(repo: string, path: string): Promise<string | null> {
    try {
      const j = await this.req(`/repos/${repo}/contents/${encodePath(path)}`);
      let b64 = j.content;
      if (!b64) b64 = (await this.req(j.git_url)).content;
      const bytes = fromB64(b64.replace(/\n/g, ''));
      const type = path.endsWith('.png') ? 'image/png' : path.endsWith('.webp') ? 'image/webp' : path.match(/\.jpe?g$/) ? 'image/jpeg' : 'application/octet-stream';
      return URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
    } catch {
      return null;
    }
  }

  /** Commit several files atomically through the Git data API (retries on races). */
  async commit(repo: string, files: FileChange[], message: string): Promise<string> {
    const info = await this.req(`/repos/${repo}`, { etag: false });
    const branch = info.default_branch || 'main';
    const tree: any[] = [];
    const copies: { path: string; from: string }[] = [];
    for (const f of files) {
      if (f.copyFrom) copies.push({ path: f.path, from: f.copyFrom });
      else if (f.content === null) tree.push({ path: f.path, mode: '100644', type: 'blob', sha: null });
      else if (typeof f.content === 'string') tree.push({ path: f.path, mode: '100644', type: 'blob', content: f.content });
      else {
        const blob = await this.req(`/repos/${repo}/git/blobs`, {
          method: 'POST',
          body: JSON.stringify({ content: toB64(f.content), encoding: 'base64' }),
        });
        tree.push({ path: f.path, mode: '100644', type: 'blob', sha: blob.sha });
      }
    }
    for (let attempt = 0; attempt < 5; attempt++) {
      const ref = await this.req(`/repos/${repo}/git/ref/heads/${branch}`, { etag: false });
      const parent = ref.object.sha;
      const pc = await this.req(`/repos/${repo}/git/commits/${parent}`);
      // drop deletions of files that don't exist (GitHub rejects them)
      const t = await this.req(`/repos/${repo}/git/trees/${pc.tree.sha}?recursive=1`);
      const existing = new Set((t.tree || []).map((x: any) => x.path));
      const shaOf = new Map<string, string>((t.tree || []).filter((x: any) => x.type === 'blob').map((x: any) => [x.path, x.sha]));
      const copied = copies.flatMap((c) => (shaOf.has(c.from) ? [{ path: c.path, mode: '100644', type: 'blob', sha: shaOf.get(c.from) }] : []));
      const entries = [...copied, ...tree.filter((e) => e.sha !== null || existing.has(e.path))];
      if (!entries.length) return parent;
      const nt = await this.req(`/repos/${repo}/git/trees`, {
        method: 'POST',
        body: JSON.stringify({ base_tree: pc.tree.sha, tree: entries }),
      });
      const c = await this.req(`/repos/${repo}/git/commits`, {
        method: 'POST',
        body: JSON.stringify({ message, tree: nt.sha, parents: [parent] }),
      });
      try {
        await this.req(`/repos/${repo}/git/refs/heads/${branch}`, {
          method: 'PATCH',
          body: JSON.stringify({ sha: c.sha, force: false }),
        });
        return c.sha;
      } catch (e: any) {
        if (e.status !== 422 && e.status !== 409) throw e;
        await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
      }
    }
    throw new Error('Could not commit: the repository kept changing. Try again.');
  }

  async setSecret(repo: string, name: string, value: string) {
    const pk = await this.req(`/repos/${repo}/actions/secrets/public-key`, { etag: false });
    const sealed = sealedBox(new TextEncoder().encode(value), fromB64(pk.key));
    await this.req(`/repos/${repo}/actions/secrets/${name}`, {
      method: 'PUT',
      body: JSON.stringify({ encrypted_value: toB64(sealed), key_id: pk.key_id }),
    });
  }

  async listSecrets(repo: string) {
    const j = await this.req(`/repos/${repo}/actions/secrets?per_page=100`, { etag: false });
    return (j.secrets || []).map((s: any) => s.name as string);
  }

  async enablePages(repo: string) {
    try {
      const j = await this.req(`/repos/${repo}/pages`, { method: 'POST', body: JSON.stringify({ build_type: 'workflow' }) });
      return j.html_url || null;
    } catch (e: any) {
      if (e.status === 409) {
        try {
          await this.req(`/repos/${repo}/pages`, { method: 'PUT', body: JSON.stringify({ build_type: 'workflow' }) });
        } catch {}
        return this.pagesUrl(repo);
      }
      throw e;
    }
  }

  async pagesUrl(repo: string) {
    try {
      const j = await this.req(`/repos/${repo}/pages`);
      return (j.html_url as string)?.replace(/\/$/, '') || null;
    } catch {
      return null;
    }
  }

  async dispatch(repo: string, workflow: string, inputs: Record<string, string>) {
    const info = await this.req(`/repos/${repo}`);
    await this.req(`/repos/${repo}/actions/workflows/${workflow}/dispatches`, {
      method: 'POST',
      body: JSON.stringify({ ref: info.default_branch || 'main', inputs }),
    });
  }

  private toRun(r: any): WorkflowRun {
    const path = r.path || '';
    const kind = path.includes('relevance-build')
      ? 'build'
      : path.includes('relevance-publish')
        ? 'publish'
        : path.includes('relevance-update')
          ? 'updates'
          : 'other';
    const appId = kind === 'build' ? r.display_title?.match(/^Build (\S+)/)?.[1] : undefined;
    return {
      id: r.id,
      name: r.name,
      displayTitle: r.display_title,
      status: r.status,
      conclusion: r.conclusion,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      runStartedAt: r.run_started_at,
      htmlUrl: r.html_url,
      workflowPath: path,
      event: r.event,
      appId,
      kind,
    };
  }

  async listRuns(repo: string, opts: { perPage?: number; workflow?: string; status?: string } = {}) {
    const q = new URLSearchParams({ per_page: String(opts.perPage || 40) });
    if (opts.status) q.set('status', opts.status);
    const base = opts.workflow ? `/repos/${repo}/actions/workflows/${opts.workflow}/runs` : `/repos/${repo}/actions/runs`;
    try {
      const j = await this.req(`${base}?${q}`);
      return (j.workflow_runs || []).map((r: any) => this.toRun(r));
    } catch (e: any) {
      if (e.status === 404) return [];
      throw e;
    }
  }

  async getRun(repo: string, id: number) {
    return this.toRun(await this.req(`/repos/${repo}/actions/runs/${id}`));
  }

  async getJobs(repo: string, runId: number): Promise<Job[]> {
    const j = await this.req(`/repos/${repo}/actions/runs/${runId}/jobs?per_page=50`);
    return (j.jobs || []).map((x: any) => ({
      id: x.id,
      name: x.name,
      status: x.status,
      conclusion: x.conclusion,
      startedAt: x.started_at,
      completedAt: x.completed_at,
      htmlUrl: x.html_url,
      steps: (x.steps || []).map((s: any) => ({
        name: s.name,
        id: s.name.match(/\[(\w+)\]\s*$/)?.[1],
        status: s.status,
        conclusion: s.conclusion,
        number: s.number,
        startedAt: s.started_at,
        completedAt: s.completed_at,
      })),
    }));
  }

  async cancelRun(repo: string, id: number) {
    await this.req(`/repos/${repo}/actions/runs/${id}/cancel`, { method: 'POST' });
  }

  async jobLog(repo: string, jobId: number) {
    const r = await fetch(`/api/gh/logs?repo=${encodeURIComponent(repo)}&job=${jobId}`, {
      headers: { Authorization: `Bearer ${this.token}` },
    });
    if (!r.ok) throw new GitHubError(`Logs unavailable (${r.status})`, r.status);
    return r.text();
  }

  async latestPagesArtifact(repo: string) {
    const j = await this.req(`/repos/${repo}/actions/artifacts?per_page=20&name=github-pages`, { etag: false });
    const a = (j.artifacts || []).find((x: any) => !x.expired);
    return a ? { id: a.id, size: a.size_in_bytes, createdAt: a.created_at } : null;
  }

  async createRelease(repo: string, tag: string, name: string, body: string): Promise<Release> {
    let r: any;
    try {
      r = await this.req(`/repos/${repo}/releases/tags/${encodeURIComponent(tag)}`, { etag: false });
    } catch {
      r = await this.req(`/repos/${repo}/releases`, {
        method: 'POST',
        body: JSON.stringify({ tag_name: tag, name, body, prerelease: true, make_latest: 'false' }),
      });
    }
    return {
      id: r.id,
      tag: r.tag_name,
      uploadUrl: r.upload_url,
      assets: (r.assets || []).map((a: any) => ({ id: a.id, name: a.name, size: a.size, url: a.browser_download_url })),
    };
  }

  uploadAsset(repo: string, releaseId: number, name: string, data: Blob, onProgress?: (p: number) => void) {
    return new Promise<{ url: string; size: number }>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `/api/gh/upload?repo=${encodeURIComponent(repo)}&release=${releaseId}&name=${encodeURIComponent(name)}`);
      xhr.setRequestHeader('Authorization', `Bearer ${this.token}`);
      xhr.setRequestHeader('Content-Type', 'application/vnd.android.package-archive');
      xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          const j = JSON.parse(xhr.responseText);
          resolve({ url: j.browser_download_url, size: j.size });
        } else reject(new Error(`Upload failed (${xhr.status}): ${xhr.responseText.slice(0, 200)}`));
      };
      xhr.onerror = () => reject(new Error('Upload failed (network)'));
      xhr.send(data);
    });
  }
}

function encodePath(p: string) {
  return p.split('/').map(encodeURIComponent).join('/');
}
function decodeUtf8(b: Uint8Array) {
  return new TextDecoder().decode(b);
}
