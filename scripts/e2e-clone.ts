// Duplicate flow: open the Edit menu → Duplicate, walk the wizard, save and build.
// Usage: CHROME=… TOKEN=… FROM=<app id> bun scripts/e2e-clone.ts <outDir>
import { chromium } from 'playwright-core';
const out = process.argv[2];
const U = 'https://relevance.cocoparrot-backend.workers.dev';
const FROM = process.env.FROM || 'binary-eye-mod';
const browser = await chromium.launch({ executablePath: process.env.CHROME, args: ['--no-sandbox'] });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 950 } })).newPage();
page.on('pageerror', (e) => console.log('pageerror', e.message));
page.on('response', (r) => r.status() >= 400 && console.log('http', r.status(), r.url().slice(0, 160)));
page.on('console', (m) => console.log('console', m.type(), m.text().slice(0, 300)));
await page.goto(U + '/api/config');
await page.evaluate((t) => localStorage.setItem('rv-token', t), process.env.TOKEN!);
await page.goto(`${U}/apps/${FROM}`, { waitUntil: 'networkidle' });
await page.waitForTimeout(3000);
await page.click('button:has-text("Edit")');
await page.waitForTimeout(400);
await page.screenshot({ path: `${out}/clone-01-menu.png` });
await page.click('a:has-text("Duplicate")');
await page.waitForURL(/\/add\/(patches|customize)/, { timeout: 15000 });
await page.waitForTimeout(2500);
await page.screenshot({ path: `${out}/clone-02-first.png` });
console.log('first step', page.url());
while (!(await page.$('.plan'))) {
  await page.click('.nav .btn.lg');
  await page.waitForTimeout(2000);
  console.log('step', page.url());
  if (page.url().includes('/customize')) await page.screenshot({ path: `${out}/clone-03-customize.png` });
}
await page.screenshot({ path: `${out}/clone-04-review.png`, fullPage: true });
await page.waitForTimeout(1000);
console.log('hit', await page.evaluate(() => { const b = document.querySelector('.nav .btn.lg') as HTMLElement; const r = b.getBoundingClientRect(); const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return [b.textContent, b.disabled, top?.className, top?.tagName]; }));
console.log('navs', await page.evaluate(() => document.querySelectorAll('.nav .btn.lg').length));
await page.evaluate(() => (document.querySelector('.nav .btn.lg') as HTMLElement).click());
await page.waitForTimeout(400);
for (let i = 0; i < 10; i++) { await page.waitForTimeout(1500); console.log('phase', await page.evaluate(() => document.querySelector('.phase, .busy, [class*=phase]')?.textContent?.trim() || document.querySelector('.nav')?.parentElement?.textContent?.match(/(Preparing|Saving|Starting|Uploading)[^.…]*[.…]/)?.[0])); }
console.log('after click', await page.evaluate(() => [document.querySelector('.nav .btn.lg')?.outerHTML.slice(0, 200), (window as any).__err]));
for (let i = 0; i < 6; i++) { await page.waitForTimeout(700); const t = await page.evaluate(() => document.querySelector('.toasts')?.textContent?.trim()); if (t) { console.log('toast', t); break; } }
for (let i = 0; i < 45 && !/\/builds\/\d+/.test(page.url()); i++) await page.waitForTimeout(2000);
await page.screenshot({ path: `${out}/clone-05-after.png` });
console.log('toasts', await page.evaluate(() => document.body.innerText.match(/.{0,80}(rror|failed|Could|lost).{0,120}/g)));
console.log('url', page.url());
await browser.close();
