// Edit flow: remove a patch that disappeared upstream, save and rebuild.
import { chromium } from 'playwright-core';
const out = process.argv[2];
const U = 'https://relevance.cocoparrot-backend.workers.dev';
const browser = await chromium.launch({ executablePath: process.env.CHROME, args: ['--no-sandbox'] });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 950 } })).newPage();
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto(U + '/api/config');
await page.evaluate((t) => localStorage.setItem('rv-token', t), process.env.TOKEN!);
await page.goto(U + '/apps/infinity-for-reddit', { waitUntil: 'networkidle' });
await page.waitForTimeout(4000);
await page.click('a:has-text("Review patches")');
await page.waitForSelector('.missing', { timeout: 20000 });
await page.screenshot({ path: `${out}/edit-01-missing.png` });
await page.click('.missing button:has-text("Remove")');
await page.waitForTimeout(800);
for (let i = 0; i < 3; i++) { await page.click('.nav .btn.lg'); await page.waitForTimeout(1500); }
await page.waitForSelector('.plan');
await page.screenshot({ path: `${out}/edit-02-review.png`, fullPage: true });
await page.click('.nav .btn.lg');
await page.waitForURL(/\/builds\/\d+/, { timeout: 90000 });
console.log('url', page.url());
await browser.close();
