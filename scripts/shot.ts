// Screenshot helper: bun scripts/shot.ts <url> <out.png> [width] [height] [dark] [token] [waitMs]
import { chromium } from 'playwright-core';
const [url, out, w = '1440', h = '900', dark = '0', token = '', wait = '2500', script = ''] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: process.env.CHROME || 'google-chrome', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: +w, height: +h }, colorScheme: dark === '1' ? 'dark' : 'light', deviceScaleFactor: 1 });
const page = await ctx.newPage();
const errors: string[] = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()));
if (token) {
  await page.goto(new URL('/api/config', url).href);
  await page.evaluate(([t, r]) => { localStorage.setItem('rv-token', t); }, [token, '']);
}
await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(+wait);
await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 400) { scrollTo(0, y); await new Promise((r) => setTimeout(r, 120)); } scrollTo(0, 0); });
await page.waitForTimeout(900);
if (script) { await page.evaluate(script); await page.waitForTimeout(1500); }
await page.screenshot({ path: out, fullPage: process.env.FULL !== '0' });
console.log(errors.join('\n') || 'no errors');
await browser.close();
