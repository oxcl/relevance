// Generates the user's F-Droid repository and static store site into _site/
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import qrcode from 'qrcode-generator';
import type { AppConfig, AppState, RelevanceConfig, ReleaseEntry } from '../shared/types';
import { encodeRecipe, formatBytes, recipeFromApp } from '../shared/logic';
import { BUILTIN_SOURCES } from './patches';
import { download, env, info, loadConfig, loadState, log, ok, REPO, run, warn } from './util';

const OUT = '_site';
const KEEP_IN_FDROID = Number(env.RELEVANCE_FDROID_KEEP || 3);

export function pagesUrl(cfg: RelevanceConfig): string {
  if (cfg.settings.store?.domain) return `https://${cfg.settings.store.domain.replace(/^https?:\/\//, '').replace(/\/$/, '')}`;
  const [owner, repo] = REPO.split('/');
  if (repo.toLowerCase() === `${owner.toLowerCase()}.github.io`) return `https://${repo.toLowerCase()}`;
  return `https://${owner.toLowerCase()}.github.io/${repo}`;
}

const esc = (s: unknown) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

function qrSvg(text: string): string {
  const q = qrcode(0, 'M');
  q.addData(text);
  q.make();
  return q.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
}

function sanitizeHtml(html: string): string {
  // allow a tiny safe subset (the editor in Relevance only produces these)
  return html
    .replace(/<\s*(script|style|iframe|object|embed)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/\son\w+="[^"]*"/gi, '')
    .replace(/javascript:/gi, '')
    .replace(/<(?!\/?(p|br|b|strong|i|em|s|code|a|ul|ol|li|blockquote|h3|h4)\b)[^>]+>/gi, '');
}

function htmlToFdroid(html: string): string {
  return sanitizeHtml(html)
    .replace(/<\/?(h3|h4)>/g, (t) => (t.startsWith('</') ? '</b></p>' : '<p><b>'))
    .replace(/<s>|<\/s>|<\/?code>/g, '');
}

function displayName(app: AppConfig) {
  return app.customize?.name || app.name;
}
function finalPackage(app: AppConfig, st: AppState) {
  return app.customize?.packageName || st.current?.apk.split('_')[0] || app.packageName;
}

export async function buildSite() {
  const cfg = loadConfig();
  const url = pagesUrl(cfg);
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(`${OUT}/assets`, { recursive: true });
  const fd = 'fdroid-work';
  rmSync(fd, { recursive: true, force: true });
  mkdirSync(`${fd}/repo`, { recursive: true });
  mkdirSync(`${fd}/metadata`, { recursive: true });

  const apps = cfg.apps.map((a) => ({ app: a, st: loadState(a.id) })).filter(({ st }) => st.releases?.length);
  info(`Generating store for ${apps.length} published app(s) → ${url}`);

  // ---- F-Droid repository
  for (const { app, st } of apps) {
    const pkg = finalPackage(app, st);
    for (const r of st.releases.slice(0, KEEP_IN_FDROID)) {
      try {
        await download(r.url, `${fd}/repo/${r.apk}`, REPO && env.GITHUB_TOKEN ? {} : {});
      } catch (e: any) {
        warn(`Skipping ${r.apk}: ${e.message}`);
      }
    }
    const warnText =
      cfg.settings.notifications?.fdroid && st.attention
        ? `<p><b>⚠ ${esc(st.attention.kind === 'build-failed' ? 'An update is available but the build is failing — check it out in Relevance.' : 'An update changed what you picked — review it in Relevance.')}</b></p>`
        : '';
    const desc = warnText + htmlToFdroid(app.listing?.description || `<p>${esc(app.listing?.summary || app.name)}</p>`);
    const patches = st.current?.patches?.length ? `<p><b>Patches applied</b></p><ul>${st.current.patches.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>` : '';
    const yml = [
      `Categories:`,
      `  - ${JSON.stringify(app.listing?.category || 'System')}`,
      `License: Unknown`,
      `Name: ${JSON.stringify(displayName(app))}`,
      `Summary: ${JSON.stringify((app.listing?.summary || displayName(app)).slice(0, 80))}`,
      `Description: ${JSON.stringify(desc + patches)}`,
      ...(app.listing?.website ? [`WebSite: ${JSON.stringify(app.listing.website)}`] : []),
      `AuthorName: ${JSON.stringify(REPO.split('/')[0])}`,
      `AutoName: ${JSON.stringify(displayName(app))}`,
      '',
    ].join('\n');
    writeFileSync(`${fd}/metadata/${pkg}.yml`, yml);
    const loc = `${fd}/metadata/${pkg}/en-US`;
    mkdirSync(`${loc}/phoneScreenshots`, { recursive: true });
    await assetTo(app.customize?.icon?.path || app.iconUrl, `${loc}/icon.png`);
    let i = 1;
    for (const s of app.listing?.screenshots || []) await assetTo(s, `${loc}/phoneScreenshots/${i++}.png`);
  }

  const ksB64 = env.RELEVANCE_KEYSTORE;
  if (ksB64) {
    writeFileSync(`${fd}/keystore.p12`, Buffer.from(ksB64, 'base64'));
    const title = cfg.settings.store?.title || `${REPO.split('/')[0]}'s apps`;
    if (await assetTo(`${cfg.settings.relevanceUrl}/icon-512.png`, `${fd}/repo/icons/icon.png`)) copyFileSync(`${fd}/repo/icons/icon.png`, `${fd}/icon.png`);
    else warn('Could not download the repository icon');
    writeFileSync(
      `${fd}/config.yml`,
      [
        `repo_url: ${url}/fdroid/repo`,
        `repo_name: ${JSON.stringify(title)}`,
        `repo_icon: icon.png`,
        `repo_description: ${JSON.stringify(cfg.settings.store?.description || 'Apps built with Relevance.')}`,
        `archive_older: 0`,
        `keystore: keystore.p12`,
        `keystorepass: ${JSON.stringify(env.RELEVANCE_KEYSTORE_PASSWORD || '')}`,
        `keypass: ${JSON.stringify(env.RELEVANCE_KEYSTORE_PASSWORD || '')}`,
        `repo_keyalias: ${JSON.stringify(env.RELEVANCE_KEY_ALIAS || 'relevance')}`,
        `keydname: "CN=Relevance"`,
        `make_current_version_link: false`,
        '',
      ].join('\n'),
    );
    try {
      await run('fdroid', ['update', '--pretty', '--use-date-from-apk', '--create-metadata'], { cwd: fd });
      rmSync(`${fd}/keystore.p12`);
      mkdirSync(`${OUT}/fdroid`, { recursive: true });
      await run('cp', ['-r', `${fd}/repo`, `${OUT}/fdroid/repo`], { quiet: true });
      ok('F-Droid repository index signed and generated');
    } catch (e: any) {
      warn(`F-Droid index generation failed: ${e.message}`);
    }
  } else {
    warn('No signing key available — skipping the F-Droid repository');
  }

  // ---- store site
  await assetTo(`${cfg.settings.relevanceUrl}/art/storefront.webp`, `${OUT}/assets/storefront.webp`);
  await assetTo(`${cfg.settings.relevanceUrl}/icon-512.png`, `${OUT}/assets/icon.png`);
  writeFileSync(`${OUT}/assets/style.css`, STYLE);
  writeFileSync(`${OUT}/assets/site.js`, SCRIPT);
  const fdroidUrl = `${url}/fdroid/repo`;
  const fingerprint = cfg.settings.signing?.fingerprint?.replace(/[^0-9A-Fa-f]/g, '').toUpperCase();
  const fdroidAdd = fingerprint ? `${fdroidUrl}?fingerprint=${fingerprint}` : fdroidUrl;
  const cards: string[] = [];
  for (const { app, st } of apps) {
    const dir = `${OUT}/apps/${app.id}`;
    mkdirSync(`${dir}/shots`, { recursive: true });
    const icon = (await assetTo(app.customize?.icon?.path || app.iconUrl, `${dir}/icon.png`)) ? 'icon.png' : '../../assets/icon.png';
    const shots: string[] = [];
    let i = 1;
    for (const s of app.listing?.screenshots || []) {
      const ext = /\.(jpe?g)$/i.test(s) ? 'jpg' : /\.webp$/i.test(s) ? 'webp' : 'png';
      if (await assetTo(s, `${dir}/shots/${i}.${ext}`)) shots.push(`shots/${i}.${ext}`);
      i++;
    }
    const ps = [...BUILTIN_SOURCES, ...cfg.patchSources].find((s) => s.id === app.patchSourceId || (s.builtin && s.tool === app.tool));
    const recipe = encodeRecipe(recipeFromApp(app, ps ? { tool: ps.tool, name: ps.name, url: ps.url } : undefined));
    writeFileSync(`${dir}/index.html`, appPage(cfg, app, st, { icon, shots, url, fdroidAdd, recipe }));
    cards.push(appCard(app, st, `apps/${app.id}/`, `apps/${app.id}/${icon === 'icon.png' ? 'icon.png' : '../../assets/icon.png'}`));
  }
  writeFileSync(`${OUT}/index.html`, indexPage(cfg, cards, { url, fdroidAdd }));
  writeFileSync(`${OUT}/404.html`, indexPage(cfg, cards, { url, fdroidAdd }));
  writeFileSync(`${OUT}/.nojekyll`, '');
  writeFileSync(`${OUT}/qr.svg`, qrSvg(fdroidAdd));
  log(`Store site: ${url}`);
  const total = dirSize(OUT);
  ok(`Site generated (${formatBytes(total)})`);
}

function dirSize(d: string): number {
  let n = 0;
  for (const f of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, f.name);
    n += f.isDirectory() ? dirSize(p) : statSync(p).size;
  }
  return n;
}

async function assetTo(src: string | undefined, dest: string): Promise<boolean> {
  if (!src) return false;
  try {
    mkdirSync(join(dest, '..'), { recursive: true });
    if (/^https?:/.test(src)) await download(src, dest);
    else if (existsSync(src)) copyFileSync(src, dest);
    else return false;
    return true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------ templates

function shell(cfg: RelevanceConfig, title: string, body: string, depth: number, extraHead = '') {
  const base = depth ? '../'.repeat(depth) : './';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="color-scheme" content="light dark">
<meta name="generator" content="Relevance">
<link rel="icon" href="${base}assets/icon.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700;900&family=Roboto+Mono:wght@400;500&display=swap" rel="stylesheet">
<link rel="stylesheet" href="${base}assets/style.css">
${extraHead}
</head>
<body>
<header class="top">
  <a class="brand" href="${base}"><img src="${base}assets/icon.png" alt="" width="32" height="32"><span>${esc(cfg.settings.store?.title || 'My apps')}</span></a>
  <a class="btn tonal sm" href="#fdroid" data-scroll>${ICON.download} Add to F-Droid</a>
</header>
${body}
<footer class="foot">
  <a href="${esc(cfg.settings.relevanceUrl)}" class="relevance-link">${ICON.external} Customize it further on Relevance</a>
  <p>Built with Relevance. All apps are built and published by the owner of this repository, who is responsible for them.</p>
</footer>
<script src="${base}assets/site.js" defer></script>
</body>
</html>`;
}

function fdroidCard(fdroidAdd: string, depth: number) {
  const base = depth ? '../'.repeat(depth) : './';
  return `<section class="card fdroid reveal" id="fdroid">
  <div>
    <h2>F-Droid repository</h2>
    <p>Add this repository in F-Droid to install and receive updates automatically.</p>
    <div class="copy-row"><code>${esc(fdroidAdd.split('?')[0])}</code><button class="icon-btn" data-copy="${esc(fdroidAdd)}" aria-label="Copy">${ICON.copy}</button></div>
    <a class="btn filled" href="fdroidrepos://${esc(fdroidAdd.replace(/^https?:\/\//, ''))}">${ICON.download} Open in F-Droid</a>
  </div>
  <img class="qr" src="${base}qr.svg" alt="QR code for the F-Droid repository" width="132" height="132">
</section>`;
}

function appCard(app: AppConfig, st: AppState, href: string, icon: string) {
  return `<a class="app-card reveal" href="${href}">
  <img class="tile" src="${icon}" alt="" width="64" height="64" loading="lazy">
  <div><h3>${esc(displayName(app))}</h3><p class="mono">${esc(finalPackage(app, st))}</p><p class="mono muted">v${esc(st.current?.version)}</p>
  <p class="sum">${esc(app.listing?.summary || '')}</p></div>
</a>`;
}

function indexPage(cfg: RelevanceConfig, cards: string[], o: { url: string; fdroidAdd: string }) {
  const body = `<main class="wrap">
<section class="hero">
  <div class="hero-text">
    <h1>${esc(cfg.settings.store?.title || 'My apps')}</h1>
    <p>${esc(cfg.settings.store?.description || 'A small, honest collection of apps — kept up to date automatically.')}</p>
  </div>
  <img class="art" src="assets/storefront.webp" alt="" aria-hidden="true">
</section>
<section class="grid">${cards.join('\n') || '<p class="muted">No apps published yet.</p>'}</section>
${fdroidCard(o.fdroidAdd, 0)}
</main>`;
  return shell(cfg, cfg.settings.store?.title || 'My apps', body, 0);
}

function appPage(
  cfg: RelevanceConfig,
  app: AppConfig,
  st: AppState,
  o: { icon: string; shots: string[]; url: string; fdroidAdd: string; recipe: string },
) {
  const cur = st.current!;
  const versions = st.releases
    .map(
      (r: ReleaseEntry) =>
        `<tr><td class="mono">${esc(r.version)}</td><td class="mono">${esc(r.date.slice(0, 10))}</td><td class="mono">${formatBytes(r.size)}</td><td><a class="icon-btn" href="${esc(r.url)}" aria-label="Download ${esc(r.version)}">${ICON.download}</a></td></tr>`,
    )
    .join('');
  const warning =
    cfg.settings.notifications?.fdroid && st.attention
      ? `<div class="notice">${ICON.warn}<span>${esc(st.attention.kind === 'build-failed' ? 'An update is available but the build is currently failing. The version below is the last good build.' : 'An update changed the patch selection; the owner is reviewing it.')}</span></div>`
      : '';
  const body = `<main class="wrap">
<section class="app-hero">
  <img class="tile big" src="${o.icon}" alt="" width="128" height="128">
  <div class="meta">
    <h1>${esc(displayName(app))}</h1>
    <p class="mono">package: ${esc(finalPackage(app, st))}</p>
    <p class="mono">latest: ${esc(cur.version)}</p>
    <div class="actions">
      <a class="btn filled" href="${esc(cur.url)}">${ICON.download} Download APK</a>
      <button class="btn outlined" data-share="${esc(`${o.url}/apps/${app.id}/`)}" data-title="${esc(displayName(app))}">${ICON.share} Share</button>
      <a class="btn outlined" href="${esc(cfg.settings.relevanceUrl)}/recipe#${o.recipe}">${ICON.flask} Use this recipe</a>
    </div>
  </div>
  <img class="art" src="../../assets/storefront.webp" alt="" aria-hidden="true">
</section>
${warning}
${o.shots.length ? `<section class="shots">${o.shots.map((s) => `<button class="shot" data-zoom="${s}"><img src="${s}" alt="Screenshot" loading="lazy"></button>`).join('')}</section>` : ''}
<section class="two">
  <article class="card reveal"><h2>Description</h2><div class="desc">${sanitizeHtml(app.listing?.description || `<p>${esc(app.listing?.summary || '')}</p>`)}</div></article>
  <article class="card reveal"><h2>Patches applied</h2>${
    cur.patches.length
      ? `<ul class="checks">${cur.patches.map((p) => `<li>${ICON.check}<span>${esc(p)}</span></li>`).join('')}</ul>`
      : `<p class="muted">${app.customize?.name || app.customize?.icon || app.customize?.packageName ? 'Basic modifications only (name, icon or package).' : 'Unmodified — passed on exactly as released.'}</p>`
  }</article>
</section>
<section class="two">
  <article class="card reveal"><h2>Versions</h2><table class="versions"><thead><tr><th>Version</th><th>Date</th><th>Size</th><th></th></tr></thead><tbody>${versions}</tbody></table></article>
  ${fdroidCard(o.fdroidAdd, 2)}
</section>
</main>
<dialog id="zoom"><img alt=""></dialog>`;
  return shell(cfg, `${displayName(app)} · ${cfg.settings.store?.title || 'My apps'}`, body, 2);
}

const ICON = {
  download: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M12 15.6 7.4 11l1.4-1.4 2.2 2.2V4h2v7.8l2.2-2.2 1.4 1.4zM6 20q-.8 0-1.4-.6T4 18v-3h2v3h12v-3h2v3q0 .8-.6 1.4T18 20z"/></svg>',
  share: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M17 22q-1.2 0-2.1-.9T14 19l.1-.7-7-4.1q-.4.4-.9.6T5 15q-1.2 0-2.1-.9T2 12t.9-2.1T5 9q.6 0 1.2.2t.9.6l7-4.1L14 5q0-1.2.9-2.1T17 2t2.1.9T20 5t-.9 2.1T17 8q-.6 0-1.2-.2t-.9-.6l-7 4.1.1.7-.1.7 7 4.1q.4-.4.9-.6T17 16q1.2 0 2.1.9T20 19t-.9 2.1T17 22"/></svg>',
  flask: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M5 21q-1.3 0-1.8-1.1t.2-2.1L9 10V5H8V3h8v2h-1v5l5.6 7.8q.7 1 .2 2.1T19 21zm2-3h10l-3.4-5H10.4z"/></svg>',
  copy: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M9 18q-.8 0-1.4-.6T7 16V4q0-.8.6-1.4T9 2h9q.8 0 1.4.6T20 4v12q0 .8-.6 1.4T18 18zm0-2h9V4H9zm-4 6q-.8 0-1.4-.6T3 20V6h2v14h11v2z"/></svg>',
  check: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="currentColor"/><path fill="#fff" d="m10.6 16.2 7-7-1.4-1.4-5.6 5.6-2.8-2.8-1.4 1.4z"/></svg>',
  external: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M5 21q-.8 0-1.4-.6T3 19V5q0-.8.6-1.4T5 3h7v2H5v14h14v-7h2v7q0 .8-.6 1.4T19 21zm4.7-5.3-1.4-1.4L17.6 5H14V3h7v7h-2V6.4z"/></svg>',
  warn: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M1 21 12 2l11 19zm11-3q.4 0 .7-.3t.3-.7-.3-.7-.7-.3-.7.3-.3.7.3.7.7.3m-1-3h2v-5h-2z"/></svg>',
};

const STYLE = `
:root{--bg:#f6eee3;--surface:#fbf6ef;--container:#f1e6d7;--sand:#e8d9c4;--text:#3a2a1f;--muted:#7a6858;--olive:#5f6b2e;--olive-c:#dfe4bb;--terra:#c0664a;--terra-c:#f6d8cb;--outline:#dccdb9;--warn:#fbe7bf;--shadow:0 1px 2px rgba(80,50,20,.06),0 6px 24px rgba(80,50,20,.08)}
@media (prefers-color-scheme:dark){:root{--bg:#1d1814;--surface:#26201a;--container:#2f2820;--sand:#3a3128;--text:#f2e8db;--muted:#bba893;--olive:#c7d08f;--olive-c:#434a20;--terra:#eb9a80;--terra-c:#5a2e21;--outline:#4a3f33;--warn:#4f3d18;--shadow:0 1px 2px rgba(0,0,0,.3),0 8px 28px rgba(0,0,0,.35)}.art{filter:saturate(.8) brightness(.8)}}
*{box-sizing:border-box}html{scroll-behavior:smooth}
body{margin:0;background:var(--bg);color:var(--text);font:16px/1.55 Roboto,system-ui,sans-serif;-webkit-font-smoothing:antialiased}
a{color:inherit}.mono,code{font-family:"Roboto Mono",ui-monospace,monospace;font-size:.86em}.muted{color:var(--muted)}
.top{position:sticky;top:0;z-index:5;display:flex;justify-content:space-between;align-items:center;padding:14px clamp(16px,4vw,40px);background:color-mix(in srgb,var(--bg) 82%,transparent);backdrop-filter:blur(12px)}
.brand{display:flex;gap:10px;align-items:center;text-decoration:none;font-weight:800;font-size:1.25rem}.brand img{border-radius:9px}
.wrap{max-width:1120px;margin:0 auto;padding:0 clamp(16px,4vw,40px) 40px}
.hero,.app-hero{position:relative;display:flex;gap:28px;align-items:center;min-height:260px;padding:24px 0}
.hero-text{position:relative;z-index:1;max-width:520px}
h1{font-size:clamp(2.2rem,5vw,3.4rem);line-height:1.05;margin:0 0 10px;font-weight:900;letter-spacing:-.02em}
h2{margin:0 0 12px;font-size:1.3rem;font-weight:800}
.art{position:absolute;right:-20px;top:0;height:100%;max-width:62%;object-fit:contain;opacity:.95;-webkit-mask-image:radial-gradient(ellipse 70% 70% at 60% 50%,#000 55%,transparent 100%);mask-image:radial-gradient(ellipse 70% 70% at 60% 50%,#000 55%,transparent 100%);z-index:0;pointer-events:none;animation:drift 18s ease-in-out infinite alternate}
@keyframes drift{to{transform:translate3d(-10px,4px,0) scale(1.02)}}
.app-hero .meta{position:relative;z-index:1}.app-hero p{margin:2px 0;color:var(--muted)}
.tile{border-radius:22%;box-shadow:var(--shadow);background:var(--surface);object-fit:cover}.tile.big{width:128px;height:128px;position:relative;z-index:1;animation:pop .6s cubic-bezier(.2,1.4,.4,1) both}
@keyframes pop{from{transform:scale(.6);opacity:0}}
.actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:16px}
.btn{display:inline-flex;align-items:center;gap:8px;border:0;border-radius:999px;padding:11px 20px;font:500 .95rem Roboto,sans-serif;text-decoration:none;cursor:pointer;transition:transform .2s cubic-bezier(.2,.9,.3,1.3),box-shadow .2s,background .2s;position:relative;overflow:hidden}
.btn:hover{transform:translateY(-2px);box-shadow:var(--shadow)}.btn:active{transform:scale(.96)}
.btn.filled{background:var(--olive);color:var(--bg)}.btn.outlined{background:var(--surface);color:var(--text);box-shadow:inset 0 0 0 1px var(--outline)}.btn.tonal{background:var(--terra);color:#fff}.btn.sm{padding:8px 16px;font-size:.85rem}
.icon-btn{display:inline-grid;place-items:center;width:36px;height:36px;border-radius:50%;border:0;background:transparent;color:var(--muted);cursor:pointer;transition:background .2s,color .2s,transform .2s}.icon-btn:hover{background:var(--container);color:var(--text);transform:scale(1.08)}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:16px;margin:12px 0 28px}
.app-card{display:flex;gap:14px;padding:18px;border-radius:24px;background:var(--surface);box-shadow:var(--shadow);text-decoration:none;transition:transform .35s cubic-bezier(.2,.9,.3,1.2),box-shadow .35s}.app-card:hover{transform:translateY(-4px) rotate(-.3deg)}
.app-card h3{margin:0;font-size:1.1rem}.app-card p{margin:2px 0}.app-card .sum{font-size:.9rem;color:var(--muted);margin-top:6px}
.card{background:var(--surface);border-radius:24px;padding:22px;box-shadow:var(--shadow)}
.two{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin:18px 0}@media(max-width:760px){.two{grid-template-columns:1fr}.art{opacity:.35;max-width:100%}.app-hero{flex-direction:column;align-items:flex-start}}
.shots{display:flex;gap:14px;overflow-x:auto;padding:10px 2px 18px;scroll-snap-type:x mandatory}
.shot{flex:0 0 auto;border:0;padding:0;background:none;cursor:zoom-in;scroll-snap-align:start;border-radius:18px;overflow:hidden;box-shadow:var(--shadow);transition:transform .3s}.shot:hover{transform:translateY(-4px)}.shot img{display:block;height:340px;width:auto}
.checks{list-style:none;padding:0;margin:0}.checks li{display:flex;gap:10px;align-items:center;padding:6px 0;color:var(--text)}.checks svg{color:var(--olive);flex:0 0 auto}
.versions{width:100%;border-collapse:collapse}.versions th{font-weight:500;color:var(--muted);text-align:left;font-size:.85rem;padding:6px}.versions td{padding:6px;border-top:1px solid var(--outline)}.versions tr{transition:background .2s}.versions tbody tr:hover{background:var(--container)}
.fdroid{display:flex;gap:20px;justify-content:space-between;align-items:center;margin:18px 0}.fdroid .qr{background:#fff;padding:10px;border-radius:14px;flex:0 0 auto}
.copy-row{display:flex;align-items:center;gap:6px;background:var(--container);border-radius:12px;padding:4px 4px 4px 12px;margin:10px 0 14px;overflow:hidden}.copy-row code{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}
.notice{display:flex;gap:10px;align-items:center;background:var(--warn);border-radius:16px;padding:12px 16px;margin:6px 0 10px}
.foot{text-align:center;padding:30px 16px 50px;color:var(--muted);font-size:.85rem}.relevance-link{display:inline-flex;gap:6px;align-items:center;color:var(--terra);font-weight:500;font-size:1rem}
.desc p{margin:.4em 0}
dialog#zoom{border:0;padding:0;background:transparent;max-width:92vw;max-height:92vh}dialog#zoom::backdrop{background:rgba(30,20,10,.6);backdrop-filter:blur(4px)}dialog#zoom img{max-height:90vh;max-width:90vw;border-radius:18px}
.reveal{opacity:0;transform:translateY(18px);transition:opacity .7s ease,transform .7s cubic-bezier(.2,.8,.2,1)}.reveal.in{opacity:1;transform:none}
.toast{position:fixed;left:50%;bottom:24px;transform:translate(-50%,40px);opacity:0;background:var(--text);color:var(--bg);padding:10px 18px;border-radius:12px;transition:.35s cubic-bezier(.2,.9,.3,1.2)}.toast.show{transform:translate(-50%,0);opacity:1}
@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}.reveal{opacity:1;transform:none}}
`;

const SCRIPT = `
const io=new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting){e.target.classList.add('in');io.unobserve(e.target)}}),{threshold:.08});
document.querySelectorAll('.reveal').forEach((el,i)=>{el.style.transitionDelay=(i%6)*60+'ms';io.observe(el)});
function toast(t){const d=document.createElement('div');d.className='toast';d.textContent=t;document.body.append(d);requestAnimationFrame(()=>d.classList.add('show'));setTimeout(()=>{d.classList.remove('show');setTimeout(()=>d.remove(),400)},1800)}
document.addEventListener('click',async e=>{const c=e.target.closest('[data-copy]');if(c){await navigator.clipboard.writeText(c.dataset.copy);toast('Copied')}
const s=e.target.closest('[data-share]');if(s){const url=s.dataset.share;if(navigator.share){try{await navigator.share({title:s.dataset.title,url})}catch{}}else{await navigator.clipboard.writeText(url);toast('Link copied')}}
const z=e.target.closest('[data-zoom]');if(z){const d=document.getElementById('zoom');d.querySelector('img').src=z.dataset.zoom;d.showModal()}
if(e.target.id==='zoom')e.target.close()});
`;
