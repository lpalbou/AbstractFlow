/**
 * Palette screenshot: sign in through the real connect modal on the dev
 * server, then capture the reorganized node palette (default state and one
 * expanded long section) as visual evidence.
 *
 * Usage: DRIVE_USER=... DRIVE_TOKEN=... node scripts/palette_shot.mjs [outDir]
 */

import { existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let puppeteer;
try {
  puppeteer = require('puppeteer-core');
} catch {
  // The workspace was renamed donotuse-abstractflow; its node_modules still
  // carries puppeteer-core (this repo deliberately does not depend on it).
  const sibling = createRequire('/Users/albou/tmp/donotuse-abstractflow/web/frontend/package.json');
  puppeteer = sibling('puppeteer-core');
}

const CHROME = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean).find((p) => existsSync(p));
if (!CHROME) {
  console.error('No Chrome binary found');
  process.exit(2);
}

const BASE = process.env.DRIVE_BASE || 'http://127.0.0.1:5199';
const GATEWAY = process.env.DRIVE_GATEWAY || 'http://127.0.0.1:8080';
const USER = process.env.DRIVE_USER || '';
const TOKEN = process.env.DRIVE_TOKEN || '';
const OUT = process.argv[2] || '/tmp/palette-shot';
mkdirSync(OUT, { recursive: true });

const note = (s) => console.log(`[palette-shot] ${s}`);

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--disable-gpu', '--hide-scrollbars', '--window-size=1440,940'],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 940, deviceScaleFactor: 2 });
  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 30000 });

  const signin = await page.$('.af-gateway-signin');
  if (signin) {
    const inputs = await page.$$('.af-gateway-signin input');
    if (inputs.length < 3) throw new Error(`expected >=3 signin inputs, got ${inputs.length}`);
    // React-controlled inputs: set the value through the native setter +
    // input event (typing after a triple-click concatenates instead of
    // replacing — the production_drive lesson).
    const setField = async (handle, value) => {
      await handle.evaluate((el, v) => {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(el, v);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }, value);
    };
    await setField(inputs[0], GATEWAY);
    await setField(inputs[1], USER);
    await setField(inputs[2], TOKEN);
    await page.click('.af-gateway-signin__primary');
    try {
      await page.waitForSelector('.node-palette', { timeout: 20000 });
    } catch (err) {
      const detail = await page
        .$eval('.af-gateway-signin__error, .af-gateway-signin__status, [class*="error"]', (el) => el.textContent || '')
        .catch(() => '(no visible error)');
      await page.screenshot({ path: `${OUT}/signin_failed.png` });
      throw new Error(`sign-in did not reach the editor: ${detail}`);
    }
    note('signed in; editor loaded');
  } else {
    await page.waitForSelector('.node-palette', { timeout: 20000 });
    note('already signed in');
  }
  await new Promise((r) => setTimeout(r, 1200));

  const palette = await page.$('.node-palette');
  await palette.screenshot({ path: `${OUT}/palette_default.png` });
  note(`palette_default.png captured`);

  // Expand a long merged section (Data & Text) to show the two-column grid at scale.
  const headers = await page.$$('.category-header');
  for (const h of headers) {
    const label = await h.$eval('.category-label', (el) => el.textContent || '').catch(() => '');
    if (label.startsWith('Data')) {
      await h.click();
      break;
    }
  }
  await new Promise((r) => setTimeout(r, 400));
  await palette.screenshot({ path: `${OUT}/palette_data_expanded.png` });
  note(`palette_data_expanded.png captured`);

  // Search state: chips filtered across sections.
  await page.type('.palette-search input', 'array', { delay: 10 });
  await new Promise((r) => setTimeout(r, 400));
  await palette.screenshot({ path: `${OUT}/palette_search.png` });
  note(`palette_search.png captured`);
} finally {
  await browser.close();
}
