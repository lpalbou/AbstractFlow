/** Screenshot the LIVE Flow Library (post dp-rename cleanup verification). */
import { existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let puppeteer;
try { puppeteer = require('puppeteer-core'); }
catch { puppeteer = createRequire(`${process.env.HOME}/tmp/abstractflow/web/frontend/package.json`)('puppeteer-core'); }

const CHROME = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(existsSync);
const BASE = 'http://127.0.0.1:3000';
const GATEWAY = 'http://127.0.0.1:8080';
const USER = process.env.DRIVE_USER || '';
const TOKEN = process.env.DRIVE_TOKEN || '';
const OUT = '/tmp/flow-library-live';
mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--disable-gpu', '--hide-scrollbars', '--window-size=1440,900'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 30000 });
  const modal = await page.$('.af-gateway-signin');
  if (modal) {
    const inputs = await page.$$('.af-gateway-signin input');
    const set = async (h, v) => h.evaluate((el, val) => { const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; s.call(el, val); el.dispatchEvent(new Event('input', { bubbles: true })); }, v);
    await set(inputs[0], GATEWAY); await set(inputs[1], USER); await set(inputs[2], TOKEN);
    await page.click('.af-gateway-signin__primary');
    await page.waitForSelector('.app-header .logo-text', { timeout: 30000 });
  }
  await page.waitForFunction(() => {
    if (document.querySelector('.flow-library-modal')) return true;
    const b = document.querySelector('button[aria-label="Open Flow"]');
    if (!b || b.disabled) return false; b.click(); return false;
  }, { timeout: 30000, polling: 700 });
  await new Promise((r) => setTimeout(r, 1800));

  // Search deep-research and expand the family.
  await page.type('.flow-library-search', 'deep-research', { delay: 10 });
  await new Promise((r) => setTimeout(r, 700));
  await page.screenshot({ path: `${OUT}/1_search_deep_research.png` });

  const names = await page.$$eval('.flow-library-item-name', (els) => els.map((e) => (e.textContent || '').trim()));
  console.log('rows:', JSON.stringify(names));

  // Clear, switch to Runnable, screenshot.
  await page.evaluate(() => { const i = document.querySelector('.flow-library-search'); if (i) { const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; s.call(i, ''); i.dispatchEvent(new Event('input', { bubbles: true })); } });
  await new Promise((r) => setTimeout(r, 500));
  await page.evaluate(() => {
    const seg = Array.from(document.querySelectorAll('.flow-library-view-toggle button')).find((b) => /runnable/i.test(b.textContent || ''));
    if (seg) seg.click();
  });
  await new Promise((r) => setTimeout(r, 600));
  // Expand deep-research family if a chevron is present.
  await page.evaluate(() => {
    const hit = Array.from(document.querySelectorAll('.flow-library-item-name')).find((n) => (n.textContent || '').startsWith('deep-research'));
    const row = hit?.closest('.af-disclosure__row');
    const chev = row?.querySelector('.af-disclosure__chevron:not(.af-disclosure__chevron--spacer)');
    if (chev) chev.click();
  });
  await new Promise((r) => setTimeout(r, 700));
  await page.screenshot({ path: `${OUT}/2_runnable_expanded.png` });
  const runnable = await page.$$eval('.flow-library-item-name', (els) => els.map((e) => (e.textContent || '').trim()));
  console.log('runnable rows:', JSON.stringify(runnable.slice(0, 20)));
} finally {
  await browser.close();
}
console.log('SHOT DONE');
