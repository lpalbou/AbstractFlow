/**
 * Headless-Chrome screenshot of the toolbar harness (toolbar_check.html).
 *
 * Usage:
 *   npx vite --port 3015 --strictPort   (in the repo root)
 *   node scripts/toolbar_check_shot.mjs
 */

import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let puppeteer;
try {
  puppeteer = require('puppeteer-core');
} catch {
  const sibling = createRequire('/Users/albou/tmp/abstractflow/web/frontend/package.json');
  puppeteer = sibling('puppeteer-core');
}

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
].filter(Boolean);

const executablePath = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!executablePath) {
  console.error('No Chrome/Chromium binary found; set CHROME_PATH.');
  process.exit(2);
}

const url = process.env.TOOLBAR_CHECK_URL ?? 'http://localhost:3015/scripts/toolbar_check.html';
const shot = process.env.TOOLBAR_CHECK_SHOT ?? '/tmp/abstractflow_toolbar_check.png';

const browser = await puppeteer.launch({ executablePath, headless: 'new', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1500, height: 220, deviceScaleFactor: 2 });
  page.on('pageerror', (err) => console.error('[pageerror]', err.message));
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
  await page.waitForFunction(() => window.__TOOLBAR_CHECK_READY === true, { timeout: 15000 });
  await new Promise((r) => setTimeout(r, 600));
  await page.screenshot({ path: shot, clip: { x: 0, y: 0, width: 1500, height: 130 } });
  console.log(`screenshot: ${shot}`);
} finally {
  await browser.close();
}
