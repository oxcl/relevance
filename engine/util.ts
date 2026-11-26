import { spawn } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { AppState, RelevanceConfig } from '../shared/types';

export const env = process.env;
export const REPO = env.GITHUB_REPOSITORY || '';
export const RUN_ID = Number(env.GITHUB_RUN_ID || 0);
export const WORK = env.RELEVANCE_WORK || 'work';
mkdirSync(WORK, { recursive: true });

// ------------------------------------------------------------------ live log relay

let relayUrl = '';
let currentStep = 'engine';
let queue: { step: string; t: number; line?: string; status?: string }[] = [];
let flushing: Promise<void> | null = null;
let timer: NodeJS.Timeout | null = null;
let oidc: { token: string; exp: number } | null = null;
let relayBroken = false;

export function setRelay(url: string | undefined) {
  relayUrl = url ? url.replace(/\/$/, '') : '';
}
export function setStep(step: string) {
  currentStep = step;
}

async function oidcToken(): Promise<string | null> {
  if (oidc && oidc.exp > Date.now() + 60_000) return oidc.token;
  const u = env.ACTIONS_ID_TOKEN_REQUEST_URL;
  const t = env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if (!u || !t) return null;
  try {
    const aud = relayUrl ? new URL(relayUrl).host : 'relevance';
    const r = await fetch(`${u}&audience=${encodeURIComponent(aud)}`, { headers: { Authorization: `bearer ${t}` } });
    const j: any = await r.json();
    oidc = { token: j.value, exp: Date.now() + 4 * 60_000 };
    return j.value;
  } catch {
    return null;
  }
}

export async function relayPost(path: string, body: unknown): Promise<Response | null> {
  if (!relayUrl) return null;
  const tok = await oidcToken();
  if (!tok) return null;
  return fetch(`${relayUrl}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).catch(() => null);
}

async function doFlush() {
  if (!queue.length || !relayUrl || relayBroken || !RUN_ID) {
    queue = [];
    return;
  }
  const events = queue;
  queue = [];
  const r = await relayPost('/api/relay/publish', { run: RUN_ID, repo: REPO, events });
  if (r && r.status === 401) relayBroken = true;
}

export function flush(): Promise<void> {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  flushing = (flushing || Promise.resolve()).then(doFlush, doFlush);
  return flushing;
}

function enqueue(e: { line?: string; status?: string }) {
  queue.push({ step: currentStep, t: Date.now(), ...e });
  if (queue.length > 200) void flush();
  else if (!timer) timer = setTimeout(() => void flush(), 350);
}

export function log(...parts: unknown[]) {
  const line = parts.map((p) => (typeof p === 'string' ? p : JSON.stringify(p))).join(' ');
  for (const l of line.split('\n')) {
    process.stdout.write(l + '\n');
    enqueue({ line: l });
  }
}
export const ok = (s: string) => log(`✓ ${s}`);
export const info = (s: string) => log(`> ${s}`);
export const warn = (s: string) => {
  process.stdout.write(`::warning::${s}\n`);
  enqueue({ line: `! ${s}` });
};
export function stepStatus(status: 'running' | 'success' | 'failure' | 'skipped', extra?: string) {
  enqueue({ status: extra ? `${status}:${extra}` : status });
}

// ------------------------------------------------------------------ processes

export function run(cmd: string, args: string[], opts: { cwd?: string; env?: Record<string, string>; quiet?: boolean } = {}) {
  return new Promise<string>((resolve, reject) => {
    if (!opts.quiet) info(`${cmd} ${args.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ')}`.slice(0, 600));
    const p = spawn(cmd, args, { cwd: opts.cwd, env: { ...process.env, ...opts.env } });
    let out = '';
    let partial = '';
    const onData = (d: Buffer) => {
      const s = partial + d.toString();
      const lines = s.split(/\r?\n/);
      partial = lines.pop() || '';
      for (const l of lines) {
        out += l + '\n';
        if (out.length > 2_000_000) out = out.slice(-1_000_000);
        log(l);
      }
    };
    p.stdout.on('data', onData);
    p.stderr.on('data', onData);
    p.on('error', reject);
    p.on('close', (code) => {
      if (partial) {
        out += partial;
        log(partial);
      }
      code === 0 ? resolve(out) : reject(new Error(`${cmd} exited with code ${code}`));
    });
  });
}

// ------------------------------------------------------------------ files

export function readJson<T>(p: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return fallback;
  }
}
export function writeJson(p: string, v: unknown) {
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(v, null, 2) + '\n');
}

export async function download(url: string, dest: string, headers: Record<string, string> = {}) {
  mkdirSync(dirname(dest), { recursive: true });
  const started = Date.now();
  const r = await fetch(url, { headers: { 'User-Agent': 'Relevance-Engine', ...headers }, redirect: 'follow' });
  if (!r.ok || !r.body) throw new Error(`Download failed (${r.status}) for ${url}`);
  const total = Number(r.headers.get('content-length') || 0);
  let got = 0;
  let lastLog = 0;
  const reader = Readable.fromWeb(r.body as any);
  reader.on('data', (c: Buffer) => {
    got += c.length;
    if (Date.now() - lastLog > 1500) {
      lastLog = Date.now();
      log(`… ${(got / 1048576).toFixed(1)} MB${total ? ` / ${(total / 1048576).toFixed(1)} MB` : ''}`);
    }
  });
  await pipeline(reader, createWriteStream(dest));
  ok(`Downloaded ${(got / 1048576).toFixed(1)} MB in ${((Date.now() - started) / 1000).toFixed(1)} s`);
  return { size: got, finalUrl: r.url, contentType: r.headers.get('content-type') || '' };
}

// ------------------------------------------------------------------ GitHub

export async function ghApi<T = any>(path: string, init: RequestInit & { raw?: boolean } = {}): Promise<T> {
  const url = path.startsWith('http') ? path : `https://api.github.com${path}`;
  const r = await fetch(url, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'Relevance-Engine',
      ...(init.body && typeof init.body === 'string' ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers as any),
    },
  });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    const e: any = new Error(`GitHub ${init.method || 'GET'} ${path} → ${r.status} ${t.slice(0, 300)}`);
    e.status = r.status;
    throw e;
  }
  if (r.status === 204) return undefined as T;
  return (init.raw ? r : r.json()) as T;
}

export async function getFile(path: string): Promise<{ text: string; sha: string } | null> {
  try {
    const j: any = await ghApi(`/repos/${REPO}/contents/${path}?ref=${env.GITHUB_REF_NAME || 'main'}`);
    return { text: Buffer.from(j.content, 'base64').toString('utf8'), sha: j.sha };
  } catch (e: any) {
    if (e.status === 404) return null;
    throw e;
  }
}

/** Write a file to the repo through the API, retrying on concurrent updates. */
export async function putFile(path: string, mutate: (old: string | null) => string, message: string) {
  for (let i = 0; i < 6; i++) {
    const cur = await getFile(path);
    const next = mutate(cur?.text ?? null);
    if (cur && next === cur.text) return;
    try {
      await ghApi(`/repos/${REPO}/contents/${path}`, {
        method: 'PUT',
        body: JSON.stringify({
          message,
          content: Buffer.from(next).toString('base64'),
          sha: cur?.sha,
          branch: env.GITHUB_REF_NAME || 'main',
          committer: { name: 'Relevance', email: '41898282+github-actions[bot]@users.noreply.github.com' },
        }),
      });
      return;
    } catch (e: any) {
      if (e.status !== 409 && e.status !== 422) throw e;
      await new Promise((r) => setTimeout(r, 800 * (i + 1) + Math.random() * 500));
    }
  }
  throw new Error(`Could not update ${path} after several attempts`);
}

export function loadConfig(): RelevanceConfig {
  const p = 'relevance.json';
  if (!existsSync(p)) throw new Error('relevance.json not found in repository');
  return JSON.parse(readFileSync(p, 'utf8'));
}

export const statePath = (appId: string) => `.relevance/state/${appId}.json`;

export function emptyState(appId: string): AppState {
  return { appId, status: 'never', releases: [], history: [] };
}

export function loadState(appId: string): AppState {
  return readJson(statePath(appId), emptyState(appId));
}

export async function updateState(appId: string, fn: (s: AppState) => void, message: string) {
  let result: AppState = emptyState(appId);
  await putFile(
    statePath(appId),
    (old) => {
      const s: AppState = old ? JSON.parse(old) : emptyState(appId);
      fn(s);
      s.history = (s.history || []).slice(0, 60);
      result = s;
      return JSON.stringify(s, null, 2) + '\n';
    },
    message,
  );
  writeJson(statePath(appId), result);
  return result;
}

export function setOutput(k: string, v: string) {
  if (env.GITHUB_OUTPUT) writeFileSync(env.GITHUB_OUTPUT, `${k}=${v}\n`, { flag: 'a' });
}

export async function latestReleaseAsset(ownerRepo: string, re: RegExp): Promise<{ url: string; name: string; tag: string }> {
  const rels: any[] = await ghApi(`/repos/${ownerRepo}/releases?per_page=10`);
  for (const rel of rels) {
    if (rel.draft) continue;
    const a = rel.assets.find((x: any) => re.test(x.name));
    if (a) return { url: a.browser_download_url, name: a.name, tag: rel.tag_name };
  }
  throw new Error(`No release asset matching ${re} in ${ownerRepo}`);
}

export function shortErr(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  return m.split('\n')[0].slice(0, 300);
}
