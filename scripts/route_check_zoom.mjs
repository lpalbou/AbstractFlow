/**
 * Capture zoomed screenshots of specific edges for visual review.
 * Usage: node scripts/route_check_zoom.mjs edge-id1 edge-id2 ...
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

const executablePath = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean).find((p) => existsSync(p));

const edgeIds = process.argv.slice(2);
const url = process.env.ROUTE_CHECK_URL ?? 'http://localhost:3014/scripts/route_check.html';

const browser = await puppeteer.launch({ executablePath, headless: 'new', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1700, height: 1200, deviceScaleFactor: 2 });
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
  await page.waitForFunction(() => window.__ROUTE_CHECK_READY === true, { timeout: 15000 });
  await new Promise((r) => setTimeout(r, 1200));

  for (const edgeId of edgeIds) {
    // Center the viewport on the edge by panning via fitView on its endpoints.
    const clip = await page.evaluate((id) => {
      const meta = (window.__ROUTE_CHECK_EDGES || []).find((e) => e.id === id);
      if (!meta) return null;
      const rects = [];
      for (const nid of [meta.source, meta.target]) {
        const el = document.querySelector(`.react-flow__node[data-id="${nid}"]`);
        if (el) rects.push(el.getBoundingClientRect());
      }
      const pathEl = document.querySelector(`[data-testid="rf__edge-${id}"] path.react-flow__edge-path`);
      if (pathEl) rects.push(pathEl.getBoundingClientRect());
      if (rects.length === 0) return null;
      const x = Math.min(...rects.map((r) => r.left)) - 24;
      const y = Math.min(...rects.map((r) => r.top)) - 24;
      const right = Math.max(...rects.map((r) => r.right)) + 24;
      const bottom = Math.max(...rects.map((r) => r.bottom)) + 24;
      return { x: Math.max(0, x), y: Math.max(0, y), width: Math.min(right - x, 1700), height: Math.min(bottom - y, 1200) };
    }, edgeId);
    if (!clip) {
      console.error(`No clip for ${edgeId}`);
      continue;
    }
    const file = `/tmp/abstractflow_zoom_${edgeId}.png`;
    await page.screenshot({ path: file, clip });
    console.log(`Screenshot: ${file}`);
  }
} finally {
  await browser.close();
}
