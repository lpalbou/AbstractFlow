/**
 * Headless-Chrome screenshots of the toolbar harness (toolbar_check.html):
 * one PNG per width x theme, plus a line per header saying whether the action
 * strip fits (scrollWidth vs clientWidth) and the Save button's state.
 *
 * Usage:
 *   npx vite --port 3015 --strictPort   (in the repo root), or a file:// URL
 *     to a `vite build` of the harness (TOOLBAR_CHECK_URL)
 *   node scripts/toolbar_check_shot.mjs
 *
 * Env:
 *   TOOLBAR_CHECK_URL     harness URL (default http://localhost:3015/scripts/toolbar_check.html)
 *   TOOLBAR_CHECK_OUT     output directory (default /tmp)
 *   TOOLBAR_CHECK_PREFIX  file name prefix (default toolbar)
 *   TOOLBAR_CHECK_WIDTHS  comma list (default 1920,1440,1024)
 *   TOOLBAR_CHECK_THEMES  comma list (default dark,light)
 */

import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

// puppeteer-core is not a dependency of this package: take it from here if
// installed, else from a sibling checkout that has it.
let puppeteer;
for (const from of [
  import.meta.url,
  new URL('../../abstractentity/package.json', import.meta.url).href,
  `${process.env.HOME}/tmp/abstractflow/web/frontend/package.json`,
]) {
  try {
    puppeteer = createRequire(from)('puppeteer-core');
    break;
  } catch {
    // next candidate
  }
}
if (!puppeteer) {
  console.error('puppeteer-core not found (npm i -D puppeteer-core, or a sibling checkout that has it).');
  process.exit(2);
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
const outDir = process.env.TOOLBAR_CHECK_OUT ?? '/tmp';
const prefix = process.env.TOOLBAR_CHECK_PREFIX ?? 'toolbar';
const widths = (process.env.TOOLBAR_CHECK_WIDTHS ?? '1920,1440,1024').split(',').map((w) => Number(w.trim()));
const themes = (process.env.TOOLBAR_CHECK_THEMES ?? 'dark,light').split(',').map((t) => t.trim());
mkdirSync(outDir, { recursive: true });

const browser = await puppeteer.launch({
  executablePath,
  headless: 'new',
  // file:// builds of the harness load ES modules from disk.
  args: ['--no-sandbox', '--allow-file-access-from-files'],
});
try {
  for (const theme of themes) {
    for (const width of widths) {
      const page = await browser.newPage();
      await page.setViewport({ width, height: 400, deviceScaleFactor: 2 });
      page.on('pageerror', (err) => console.error('[pageerror]', err.message));
      const sep = url.includes('?') ? '&' : '?';
      await page.goto(`${url}${sep}theme=${encodeURIComponent(theme)}`, { waitUntil: 'networkidle2', timeout: 30000 });
      await page.waitForFunction(() => window.__TOOLBAR_CHECK_READY === true, { timeout: 15000 });
      await new Promise((r) => setTimeout(r, 600));
      const report = await page.evaluate(() =>
        [...document.querySelectorAll('[data-check]')].map((h) => {
          const strip = h.querySelector('.toolbar-actions');
          const save = h.querySelector('.save-button');
          const labels = [...h.querySelectorAll('.file-action-label')].filter((el) => getComputedStyle(el).display !== 'none').length;
          const header = h.getBoundingClientRect();
          const topbar = h.querySelector('.af-topbar')?.getBoundingClientRect();
          const toolbar = h.querySelector('.toolbar')?.getBoundingClientRect();
          return {
            state: h.getAttribute('data-check'),
            strip: strip ? `${strip.scrollWidth}/${strip.clientWidth}` : '-',
            clipped: strip ? strip.scrollWidth > strip.clientWidth + 1 : null,
            overlap: topbar && toolbar ? toolbar.right > topbar.left + 1 : null,
            labels,
            save: save ? `${save.className} disabled=${save.disabled}` : '-',
            height: Math.round(header.height),
          };
        })
      );
      const height = await page.evaluate(() => Math.ceil(document.querySelector('.app-container').getBoundingClientRect().bottom));
      const shot = join(outDir, `${prefix}-${width}-${theme}.png`);
      await page.screenshot({ path: shot, clip: { x: 0, y: 0, width, height } });
      console.log(`screenshot: ${shot}`);
      for (const r of report) console.log(`  ${r.state}: strip ${r.strip} clipped=${r.clipped} overlap=${r.overlap} labels=${r.labels} | ${r.save}`);
      await page.close();
    }
  }
} finally {
  await browser.close();
}
