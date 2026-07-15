/**
 * Headless verification of the kit AfTopBarActions adoption (toolbar_check
 * harness): screenshots both themes AND asserts the structural contract —
 * cluster present, enforced order (assistant → appearance → pill), pill
 * rightmost, pill label per phase.
 *
 * Usage:
 *   npx vite dev --port 5199 --strictPort --host 127.0.0.1
 *   node scripts/topbar_verify.mjs
 */

import { existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const puppeteer = require('puppeteer-core');

const CHROME = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
]
  .filter(Boolean)
  .find((p) => existsSync(p));
if (!CHROME) {
  console.error('No Chrome/Chromium binary found; set CHROME_PATH.');
  process.exit(2);
}

const BASE = process.env.TOPBAR_BASE || 'http://127.0.0.1:5199/scripts/toolbar_check.html';
const OUT = process.env.TOPBAR_OUT || '/tmp/topbar_shots';
mkdirSync(OUT, { recursive: true });

const failures = [];
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1500, height: 500, deviceScaleFactor: 2 });

  for (const [name, url] of [
    ['topbar_dark', BASE],
    ['topbar_light', `${BASE}?theme=one-light`],
  ]) {
    await page.goto(url, { waitUntil: 'networkidle0' });
    await page.waitForFunction('window.__TOOLBAR_CHECK_READY === true', { timeout: 15000 });
    await new Promise((r) => setTimeout(r, 400));

    const facts = await page.evaluate(() => {
      const bars = Array.from(document.querySelectorAll('.af-topbar'));
      return bars.map((bar) => ({
        labels: Array.from(bar.querySelectorAll('button')).map(
          (b) => b.getAttribute('aria-label') || b.className
        ),
        pill: bar.querySelector('.af-topbar__pill')?.textContent?.trim() || null,
        pillIsLast: bar.lastElementChild?.classList?.contains('af-topbar__pill') || false,
        assistantPressed: bar.querySelector('button[aria-pressed]')?.getAttribute('aria-pressed') || null,
      }));
    });

    if (facts.length !== 2) failures.push(`${name}: expected 2 af-topbar clusters, saw ${facts.length}`);
    for (const [i, bar] of facts.entries()) {
      if (!bar.pillIsLast) failures.push(`${name} bar ${i}: connection pill is not the rightmost element`);
      const [first, second] = bar.labels;
      if (!/assistant/i.test(String(first))) failures.push(`${name} bar ${i}: first control is not the assistant (${first})`);
      if (!/appearance/i.test(String(second))) failures.push(`${name} bar ${i}: second control is not appearance (${second})`);
    }
    if (facts[0] && facts[0].pill !== 'Disconnect') failures.push(`${name}: connected pill says "${facts[0].pill}", expected Disconnect`);
    if (facts[1] && facts[1].pill !== 'Connect') failures.push(`${name}: disconnected pill says "${facts[1].pill}", expected Connect`);

    await page.screenshot({ path: `${OUT}/${name}.png` });
    console.log(`${name}: ${JSON.stringify(facts)}`);
  }
} finally {
  await browser.close();
}

if (failures.length) {
  console.error('FAILURES:');
  for (const f of failures) console.error(` - ${f}`);
  process.exit(1);
}
console.log(`OK — screenshots in ${OUT}`);
