// Relevance thin server: only glue that makes the static app work. It keeps no state of its own
// (the relay holds recent log lines of running builds for a few hours, then deletes them).
import { DurableObject } from 'cloudflare:workers';
import { resolveSource, apkpureCodes } from '../shared/sources';
import type { AppSource } from '../shared/types';
import { ENGINE_VERSION } from '../shared/types';

export interface Env {
  ASSETS: Fetcher;
  RELAY: DurableObjectNamespace<Relay>;
  EMAIL?: any;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  SESSION_SECRET?: string;
  EMAIL_FROM?: string;
}

const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...headers } });
const err = (message: string, status = 400) => json({ error: message }, status);

const enc = new TextEncoder();
const b64url = (b: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(b as ArrayBuffer)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
const fromB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

async function hmac(secret: string, data: string) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
}

function cookie(req: Request, name: string) {
  return req.headers.get('Cookie')?.match(new RegExp(`(?:^|; )${name}=([^;]+)`))?.[1];
}

function bearer(req: Request) {
  return req.headers.get('Authorization')?.replace(/^(Bearer|token)\s+/i, '') || '';
}

async function github(path: string, token: string, init: RequestInit = {}) {
  return fetch(path.startsWith('http') ? path : `https://api.github.com${path}`, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'Relevance',
      Authorization: `Bearer ${token}`,
      ...(init.headers as any),
    },
  });
}

// ------------------------------------------------------------------ repo access cache

const accessCache = new Map<string, { ok: boolean; exp: number }>();
async function canAccess(token: string, repo: string): Promise<boolean> {
  if (!token || !/^[\w.-]+\/[\w.-]+$/.test(repo)) return false;
  const k = `${await hmac('cache', token)}:${repo}`;
  const c = accessCache.get(k);
  if (c && c.exp > Date.now()) return c.ok;
  const r = await github(`/repos/${repo}`, token);
  const ok = r.ok;
  accessCache.set(k, { ok, exp: Date.now() + 60_000 });
  return ok;
}

// ------------------------------------------------------------------ GitHub Actions OIDC

let jwks: { keys: any[]; exp: number } | null = null;
async function verifyOidc(token: string, audience: string): Promise<{ repository: string; run_id: string } | null> {
  try {
    const [h, p, s] = token.split('.');
    const header = JSON.parse(new TextDecoder().decode(fromB64url(h)));
    const payload = JSON.parse(new TextDecoder().decode(fromB64url(p)));
    if (payload.iss !== 'https://token.actions.githubusercontent.com') return null;
    if (payload.aud !== audience) return null;
    if (payload.exp * 1000 < Date.now()) return null;
    if (!jwks || jwks.exp < Date.now()) {
      const r = await fetch('https://token.actions.githubusercontent.com/.well-known/jwks');
      jwks = { keys: ((await r.json()) as any).keys, exp: Date.now() + 3600_000 };
    }
    const jwk = jwks.keys.find((k) => k.kid === header.kid);
    if (!jwk) return null;
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, fromB64url(s), enc.encode(`${h}.${p}`));
    return valid ? payload : null;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ router

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    const p = url.pathname;
    if (!p.startsWith('/api/')) return env.ASSETS.fetch(req);
    try {
      if (req.method === 'OPTIONS') return new Response(null, { status: 204 });
      // auth --------------------------------------------------------------
      if (p === '/api/config') {
        return json({ oauth: Boolean(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET), email: Boolean(env.EMAIL && env.SESSION_SECRET), engineVersion: ENGINE_VERSION }, 200, { 'cache-control': 'no-store' });
      }
      if (p === '/api/auth/login') {
        if (!env.GITHUB_CLIENT_ID) return err('GitHub sign-in is not configured on this server', 503);
        const state = b64url(crypto.getRandomValues(new Uint8Array(18)));
        const ret = url.searchParams.get('return') || '/';
        const auth = new URL('https://github.com/login/oauth/authorize');
        auth.searchParams.set('client_id', env.GITHUB_CLIENT_ID);
        auth.searchParams.set('redirect_uri', `${url.origin}/api/auth/callback`);
        auth.searchParams.set('scope', 'repo workflow user:email');
        auth.searchParams.set('state', state);
        auth.searchParams.set('allow_signup', 'true');
        return new Response(null, {
          status: 302,
          headers: {
            Location: auth.href,
            'Set-Cookie': `rv_oauth=${state}.${encodeURIComponent(ret)}; Path=/api/auth; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
          },
        });
      }
      if (p === '/api/auth/callback') {
        const c = cookie(req, 'rv_oauth') || '';
        const [state, ret] = c.split('.');
        if (!state || state !== url.searchParams.get('state')) return Response.redirect(`${url.origin}/?auth_error=state`, 302);
        const r = await fetch('https://github.com/login/oauth/access_token', {
          method: 'POST',
          headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify({
            client_id: env.GITHUB_CLIENT_ID,
            client_secret: env.GITHUB_CLIENT_SECRET,
            code: url.searchParams.get('code'),
            redirect_uri: `${url.origin}/api/auth/callback`,
          }),
        });
        const j: any = await r.json();
        if (!j.access_token) return Response.redirect(`${url.origin}/?auth_error=${encodeURIComponent(j.error || 'token')}`, 302);
        const frag = new URLSearchParams({ token: j.access_token, scope: j.scope || '', return: decodeURIComponent(ret || '/') });
        return new Response(null, {
          status: 302,
          headers: {
            Location: `${url.origin}/auth#${frag}`,
            'Set-Cookie': 'rv_oauth=; Path=/api/auth; HttpOnly; Secure; SameSite=Lax; Max-Age=0',
            'Cache-Control': 'no-store',
          },
        });
      }
      if (p === '/api/auth/revoke' && req.method === 'POST') {
        const token = bearer(req);
        if (env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET && token) {
          await fetch(`https://api.github.com/applications/${env.GITHUB_CLIENT_ID}/grant`, {
            method: 'DELETE',
            headers: {
              Authorization: `Basic ${btoa(`${env.GITHUB_CLIENT_ID}:${env.GITHUB_CLIENT_SECRET}`)}`,
              Accept: 'application/vnd.github+json',
              'User-Agent': 'Relevance',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ access_token: token }),
          });
        }
        return json({ ok: true });
      }

      // sources (CORS-free preview) ----------------------------------------
      if (p === '/api/source') {
        const src: AppSource = {
          type: url.searchParams.get('type') as any,
          url: url.searchParams.get('url') || '',
          assetPattern: url.searchParams.get('assetPattern') || undefined,
          prerelease: url.searchParams.get('prerelease') === '1',
        };
        if (!src.url) return err('Missing url');
        const cache = (caches as any).default as Cache;
        const key = new Request(`https://cache.relevance/source?${url.searchParams}`);
        const hit = !bearer(req) && (await cache.match(key));
        if (hit) return hit;
        const info = await resolveSource(src, { fetch: (i: any, o?: any) => fetch(i, o), githubToken: bearer(req) || undefined });
        const res = json(info, 200, { 'Cache-Control': 'public, max-age=600' });
        if (!bearer(req)) ctx.waitUntil(cache.put(key, res.clone()));
        return res;
      }

      // LSPosed module repository (its site challenges GitHub runners; the indexer reads it through here)
      if (p === '/api/lsposed/modules') {
        const cache = (caches as any).default as Cache;
        const key = new Request('https://cache.relevance/lsposed-modules');
        const hit = await cache.match(key);
        if (hit) return hit;
        const r = await fetch('https://modules.lsposed.org/modules.json', { headers: { Accept: 'application/json' } });
        if (!r.ok) return err(`modules.lsposed.org responded ${r.status}`, 502);
        const text = await r.text();
        try {
          JSON.parse(text);
        } catch {
          return err('modules.lsposed.org did not return JSON', 502);
        }
        const res = new Response(text, { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=21600' } });
        ctx.waitUntil(cache.put(key, res.clone()));
        return res;
      }

      // APKPure version codes (its pages challenge datacenter clients such as GitHub runners)
      if (p === '/api/apkpure/codes') {
        const page = url.searchParams.get('url') || '';
        const version = url.searchParams.get('version') || undefined;
        if (!/^https:\/\/(www\.)?apkpure\.(net|com)\//.test(page)) return err('Not an APKPure URL');
        const cache = (caches as any).default as Cache;
        const key = new Request(`https://cache.relevance/apkpure?${url.searchParams}`);
        const hit = await cache.match(key);
        if (hit) return hit;
        const codes = await apkpureCodes({ fetch: (i: any, o?: any) => fetch(i, o) }, page, version);
        const res = json({ codes }, 200, { 'Cache-Control': 'public, max-age=1800' });
        if (Object.keys(codes).length) ctx.waitUntil(cache.put(key, res.clone()));
        return res;
      }

      // generic fetch for images and partial APK reads ---------------------------
      if (p === '/api/fetch') {
        const target = url.searchParams.get('url') || '';
        if (!/^https:\/\//.test(target)) return err('Only https URLs');
        const range = req.headers.get('Range');
        const r = await fetch(target, {
          method: req.method === 'HEAD' ? 'HEAD' : 'GET',
          headers: { 'User-Agent': 'Relevance', ...(range ? { Range: range } : {}) },
          redirect: 'follow',
        });
        const type = r.headers.get('content-type') || '';
        const len = Number(r.headers.get('content-length') || 0);
        const allowed =
          req.method === 'HEAD' ||
          type.startsWith('image/') ||
          (range && r.status === 206 && len <= 16 * 1024 * 1024) ||
          (type.includes('json') && len < 30 * 1024 * 1024);
        if (!allowed) return err('This proxy only serves images, JSON and ranged reads', 415);
        const h = new Headers();
        for (const k of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'last-modified', 'etag'])
          if (r.headers.get(k)) h.set(k, r.headers.get(k)!);
        h.set('x-final-url', r.url);
        h.set('Access-Control-Expose-Headers', 'content-range, content-length, x-final-url, accept-ranges');
        h.set('Cache-Control', 'public, max-age=3600');
        return new Response(r.body, { status: r.status, headers: h });
      }

      // GitHub helpers needing CORS-free access ----------------------------------
      if (p === '/api/gh/logs') {
        const token = bearer(req);
        const repo = url.searchParams.get('repo') || '';
        const job = url.searchParams.get('job') || '';
        if (!(await canAccess(token, repo))) return err('No access', 403);
        const r = await github(`/repos/${repo}/actions/jobs/${encodeURIComponent(job)}/logs`, token, { redirect: 'follow' });
        return new Response(r.body, { status: r.status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'private, max-age=30' } });
      }
      if (p === '/api/gh/artifact') {
        const token = bearer(req) || url.searchParams.get('t') || '';
        const repo = url.searchParams.get('repo') || '';
        const id = url.searchParams.get('id') || '';
        if (!(await canAccess(token, repo))) return err('No access', 403);
        const r = await github(`/repos/${repo}/actions/artifacts/${encodeURIComponent(id)}/zip`, token, { redirect: 'follow' });
        return new Response(r.body, {
          status: r.status,
          headers: { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="${repo.split('/')[1]}-store.zip"` },
        });
      }
      if (p === '/api/gh/upload' && req.method === 'POST') {
        const token = bearer(req);
        const repo = url.searchParams.get('repo') || '';
        const release = url.searchParams.get('release') || '';
        const name = url.searchParams.get('name') || 'app.apk';
        if (!(await canAccess(token, repo))) return err('No access', 403);
        const r = await fetch(`https://uploads.github.com/repos/${repo}/releases/${encodeURIComponent(release)}/assets?name=${encodeURIComponent(name)}`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github+json',
            'User-Agent': 'Relevance',
            'Content-Type': req.headers.get('Content-Type') || 'application/octet-stream',
            'Content-Length': req.headers.get('Content-Length') || '',
          },
          body: req.body,
        });
        return new Response(r.body, { status: r.status, headers: { 'Content-Type': 'application/json' } });
      }

      // live build logs ------------------------------------------------------
      if (p === '/api/relay/publish' && req.method === 'POST') {
        const claims = await verifyOidc(bearer(req), url.host);
        if (!claims) return err('Invalid OIDC token', 401);
        const body: any = await req.json();
        const id = env.RELAY.idFromName(`${claims.repository}#${claims.run_id}`);
        await env.RELAY.get(id).publish(body.events || []);
        return json({ ok: true });
      }
      if (p === '/api/relay/subscribe') {
        if (req.headers.get('Upgrade') !== 'websocket') return err('Expected websocket', 426);
        const protos = (req.headers.get('Sec-WebSocket-Protocol') || '').split(',').map((s) => s.trim());
        const token = protos.find((x) => x !== 'relevance') || url.searchParams.get('token') || '';
        const repo = url.searchParams.get('repo') || '';
        const run = url.searchParams.get('run') || '';
        if (!(await canAccess(token, repo))) return err('No access', 403);
        const id = env.RELAY.idFromName(`${repo}#${run}`);
        return env.RELAY.get(id).fetch(req);
      }

      // email notifications ----------------------------------------------------
      if (p === '/api/email/token' && req.method === 'POST') {
        if (!env.SESSION_SECRET) return err('Email is not configured on this server', 503);
        const token = bearer(req);
        const { repo } = (await req.json()) as any;
        const rr = await github(`/repos/${repo}`, token);
        const rj: any = await rr.json();
        if (!rr.ok || !rj.permissions?.admin) return err('You need admin access to that repository', 403);
        const er = await github('/user/emails', token);
        const emails: any[] = er.ok ? await er.json() : [];
        const primary = emails.find((e) => e.primary && e.verified) || emails.find((e) => e.verified);
        if (!primary) return err('No verified email on your GitHub account', 404);
        const payload = b64url(enc.encode(JSON.stringify({ r: repo.toLowerCase(), e: primary.email, t: Date.now() })));
        const sig = await hmac(env.SESSION_SECRET, payload);
        const [u, d] = primary.email.split('@');
        return json({ token: `${payload}.${sig}`, hint: `${u.slice(0, 2)}${'•'.repeat(Math.max(1, u.length - 2))}@${d}` });
      }
      if (p === '/api/notify/email' && req.method === 'POST') {
        const claims = await verifyOidc(bearer(req), url.host);
        if (!claims) return err('Invalid OIDC token', 401);
        if (!env.EMAIL || !env.SESSION_SECRET) return err('Email is not configured on this server', 503);
        const body: any = await req.json();
        const [payload, sig] = String(body.token || '').split('.');
        if (!payload || (await hmac(env.SESSION_SECRET, payload)) !== sig) return err('Bad email token', 403);
        const t = JSON.parse(new TextDecoder().decode(fromB64url(payload)));
        if (t.r !== claims.repository.toLowerCase()) return err('Token belongs to another repository', 403);
        await sendEmail(env, t.e, String(body.subject || 'Relevance notification').slice(0, 200), body);
        return json({ ok: true });
      }
      return err('Not found', 404);
    } catch (e: any) {
      return err(e?.message || 'Server error', 500);
    }
  },
};

async function sendEmail(env: Env, to: string, subject: string, b: any) {
  const from = env.EMAIL_FROM || 'notifications@relevance.app';
  const esc = (s: string) => String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
  const html = `<div style="font-family:Roboto,Arial,sans-serif;background:#f6eee3;padding:28px"><div style="max-width:520px;margin:auto;background:#fbf6ef;border-radius:20px;padding:24px;color:#3a2a1f">
<h2 style="margin:0 0 8px">${esc(b.appName)}</h2><p>${esc(b.message)}</p>
<p><a href="${esc(b.appUrl)}" style="display:inline-block;background:#5f6b2e;color:#fff;padding:10px 18px;border-radius:999px;text-decoration:none">Open in Relevance</a>
&nbsp; <a href="${esc(b.runUrl)}" style="color:#c0664a">Build log</a></p>
<p style="color:#7a6858;font-size:13px">The last good build stays published until you act. You can turn email off in Relevance settings.</p></div></div>`;
  try {
    await env.EMAIL.send({ to, from: { email: from, name: 'Relevance' }, subject, html, text: b.text });
  } catch {
    const { EmailMessage } = await import('cloudflare:email');
    const boundary = 'rv' + crypto.randomUUID();
    const raw = [
      `From: Relevance <${from}>`,
      `To: ${to}`,
      `Subject: ${subject}`,
      'MIME-Version: 1.0',
      `Message-ID: <${crypto.randomUUID()}@${from.split('@')[1]}>`,
      `Date: ${new Date().toUTCString()}`,
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      '',
      `--${boundary}`,
      'Content-Type: text/plain; charset=utf-8',
      '',
      b.text,
      `--${boundary}`,
      'Content-Type: text/html; charset=utf-8',
      '',
      html,
      `--${boundary}--`,
    ].join('\r\n');
    await env.EMAIL.send(new EmailMessage(from, to, raw));
  }
}

// ------------------------------------------------------------------ relay durable object

export class Relay extends DurableObject<Env> {
  sockets = new Set<WebSocket>();

  async publish(events: unknown[]) {
    if (!Array.isArray(events) || !events.length) return;
    const n = ((await this.ctx.storage.get<number>('n')) || 0) + 1;
    await this.ctx.storage.put({ n, [`e:${String(n).padStart(8, '0')}`]: events.slice(0, 500) });
    await this.ctx.storage.setAlarm(Date.now() + 6 * 3600_000);
    const msg = JSON.stringify({ type: 'events', events });
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(msg);
      } catch {}
    }
  }

  async fetch(req: Request): Promise<Response> {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    const backlog = await this.ctx.storage.list<unknown[]>({ prefix: 'e:' });
    const events = [...backlog.values()].flat();
    server.send(JSON.stringify({ type: 'backlog', events }));
    const protos = req.headers.get('Sec-WebSocket-Protocol');
    return new Response(null, { status: 101, webSocket: client, headers: protos ? { 'Sec-WebSocket-Protocol': 'relevance' } : {} });
  }

  async webSocketMessage(ws: WebSocket, msg: string | ArrayBuffer) {
    if (msg === 'ping') ws.send('pong');
  }

  async webSocketClose(ws: WebSocket, code: number) {
    try {
      ws.close(code, 'bye');
    } catch {}
  }

  async alarm() {
    await this.ctx.storage.deleteAll();
  }
}
