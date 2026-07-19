/**
 * Headless-Chrome screenshots of the Flow Library preview harness
 * (library-preview.html), one PNG per state.
 *
 * Usage:
 *   npx vite dev --port 5199 --strictPort --host 127.0.0.1
 *   node scripts/library_preview_shot.mjs [outDir]
 *
 * States are driven through the harness URL params (view/q/expand/select/
 * theme) so every screenshot exercises the real modal code paths.
 */

import { existsSync, mkdirSync } from 'node:fs';
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

const BASE = process.env.PREVIEW_BASE || 'http://127.0.0.1:5199/library-preview.html';
const OUT_DIR = process.argv[2] || '/tmp/flowlib-shots';
mkdirSync(OUT_DIR, { recursive: true });

const STATES = [
  ['all_dark', 'view=all'],
  ['expanded_dark', 'expand=deep-research,report-pipeline&select=deep-research'],
  ['runnable_dark', 'view=executable&select=81795ea9'],
  ['search_dark', 'q=dp'],
  ['all_light', 'view=all&theme=light'],
  ['expanded_light', 'expand=deep-research&select=deep-research&theme=light'],
];

const browser = await puppeteer.launch({
  executablePath,
  headless: 'new',
  args: ['--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=2'],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 860, deviceScaleFactor: 2 });
  for (const [name, qs] of STATES) {
    await page.goto(`${BASE}?${qs}`, { waitUntil: 'networkidle0', timeout: 30000 });
    await page.waitForSelector('body[data-preview-ready="true"]', { timeout: 10000 });
    await page.screenshot({ path: `${OUT_DIR}/${name}.png` });
    console.log(`${name}.png written`);
  }
} finally {
  await browser.close();
}
