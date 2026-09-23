/**
 * Headless-Chrome screenshots of the run-modal harness (runmodal_check.html).
 *
 * Usage:
 *   npx vite --port 3015 --strictPort   (in the repo root)
 *   node scripts/runmodal_check_shot.mjs
 */

import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let puppeteer;
try {
  puppeteer = require('puppeteer-core');
} catch {
  const sibling = createRequire(`${process.env.HOME}/tmp/abstractflow/web/frontend/package.json`);
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

const base = process.env.RUNMODAL_CHECK_URL ?? 'http://localhost:3015/scripts/runmodal_check.html';
const shots = [
  { q: '?view=launch&theme=dark', out: '/tmp/abstractflow_runmodal_launch_dark.png' },
  { q: '?view=launch&theme=light', out: '/tmp/abstractflow_runmodal_launch_light.png' },
  { q: '?view=exec&theme=dark', out: '/tmp/abstractflow_runmodal_exec_dark.png' },
  { q: '?view=exec&theme=light', out: '/tmp/abstractflow_runmodal_exec_light.png' },
];

const browser = await puppeteer.launch({ executablePath, headless: 'new', args: ['--no-sandbox'] });
try {
  for (const { q, out } of shots) {
    const page = await browser.newPage();
    await page.setViewport({ width: 1360, height: 940, deviceScaleFactor: 2 });
    page.on('pageerror', (err) => console.error('[pageerror]', q, err.message));
    await page.goto(base + q, { waitUntil: 'networkidle2', timeout: 30000 });
    await page.waitForFunction(() => window.__RUNMODAL_CHECK_READY === true, { timeout: 15000 });
    await new Promise((r) => setTimeout(r, 700));
    await page.screenshot({ path: out });
    console.log(`screenshot: ${out}`);
    await page.close();
  }
} finally {
  await browser.close();
}
