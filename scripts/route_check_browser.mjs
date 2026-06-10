/**
 * Headless-Chrome verification of edge routing in the real Canvas, against a
 * real saved workflow (see route_check_main.tsx).
 *
 * Assertions, per rendered edge:
 * - No edge may cross its OWN source/target node interior, except the
 *   horizontal pin stub at the pin's own Y (handles are anchored inset
 *   inside the node body, so the stub legitimately crosses the owning node).
 * - Back edges / self loops (which use the orthogonal router) may not cross
 *   ANY node interior.
 * Forward data edges remain Béziers and may pass other nodes; that is
 * pre-existing, unchanged behavior and is not asserted here.
 *
 * Usage:
 *   npx vite --port 3014 --strictPort   (in the repo root)
 *   node scripts/route_check_browser.mjs
 */

import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let puppeteer;
try {
  puppeteer = require('puppeteer-core');
} catch {
  // Fall back to the sibling checkout where puppeteer-core is installed.
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

const url = process.env.ROUTE_CHECK_URL ?? 'http://localhost:3014/scripts/route_check.html';
const screenshotPrefix = process.env.ROUTE_CHECK_SHOT_PREFIX ?? '/tmp/abstractflow_resume_route';

const browser = await puppeteer.launch({ executablePath, headless: 'new', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1700, height: 1200, deviceScaleFactor: 2 });
  page.on('pageerror', (err) => console.error('[pageerror]', err.message));
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
  await page.waitForFunction(() => window.__ROUTE_CHECK_READY === true, { timeout: 15000 });
  await page.waitForFunction(
    () => document.querySelectorAll('.react-flow__edge path.react-flow__edge-path').length >= (window.__ROUTE_CHECK_EDGES?.length ?? 1) * 0.8,
    { timeout: 15000 }
  );
  // Let ReactFlow's measurement pass settle (edge routes depend on measured
  // node sizes, which arrive one render after mount).
  await new Promise((r) => setTimeout(r, 1200));

  const result = await page.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll('.react-flow__node')).map((el) => {
      const m = /translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/.exec(el.style.transform || '');
      return {
        id: el.getAttribute('data-id'),
        x: m ? Number(m[1]) : NaN,
        y: m ? Number(m[2]) : NaN,
        w: el.offsetWidth,
        h: el.offsetHeight,
      };
    });
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const meta = window.__ROUTE_CHECK_EDGES || [];
    const failures = [];
    let checked = 0;
    for (const { id, source, target } of meta) {
      const g = document.querySelector(`[data-testid="rf__edge-${id}"]`);
      const path = g ? g.querySelector('path.react-flow__edge-path') : null;
      if (!path) {
        failures.push(`${id}: edge path not rendered`);
        continue;
      }
      checked += 1;
      const src = byId.get(source);
      const tgt = byId.get(target);
      const len = path.getTotalLength();
      const pinStart = path.getPointAtLength(0);
      const pinEnd = path.getPointAtLength(len);
      const isSelf = source === target;
      const isBack = isSelf || (src && tgt && src.x + src.w > tgt.x + 24);
      // 4px interior tolerance: rounded node corners + the unavoidable graze
      // when nodes are glued together (zero-gap pin pockets) are not bugs.
      const TOL = 4;
      for (let t = 0; t <= len; t += 2) {
        const p = path.getPointAtLength(t);
        let bad = null;
        for (const n of nodes) {
          const inside = p.x > n.x + TOL && p.x < n.x + n.w - TOL && p.y > n.y + TOL && p.y < n.y + n.h - TOL;
          if (!inside) continue;
          const isSourceStub = n.id === source && Math.abs(p.y - pinStart.y) <= 2.5 && p.x >= pinStart.x - 2;
          const isTargetStub = n.id === target && Math.abs(p.y - pinEnd.y) <= 2.5 && p.x <= pinEnd.x + 2;
          // Bézier edges enter inset pins at an angle; the short final
          // approach inside the owning node near the pin is legitimate.
          const nearSourcePin = n.id === source && Math.hypot(p.x - pinStart.x, p.y - pinStart.y) <= 48;
          const nearTargetPin = n.id === target && Math.hypot(p.x - pinEnd.x, p.y - pinEnd.y) <= 48;
          if (isSourceStub || isTargetStub || nearSourcePin || nearTargetPin) continue;
          const ownNode = n.id === source || n.id === target;
          // Routed (back/self) edges must avoid every node; other edges are
          // only asserted against their own endpoints' nodes.
          if (ownNode || isBack) {
            bad = `${id}${isBack ? ' [routed]' : ''}: crosses ${n.id} at (${Math.round(p.x)},${Math.round(p.y)})`;
            break;
          }
        }
        if (bad) {
          failures.push(bad);
          break;
        }
      }
    }
    return { failures, checked, nodeCount: nodes.length };
  });

  console.log(`Checked ${result.checked} edges across ${result.nodeCount} nodes.`);

  // Visual confirmation: fit the whole flow and screenshot it.
  const fitView = await page.$('.react-flow__controls-fitview');
  if (fitView) {
    await fitView.click();
    await new Promise((r) => setTimeout(r, 600));
  }
  const fullShot = `${screenshotPrefix}_full.png`;
  await page.screenshot({ path: fullShot });
  console.log(`Screenshot: ${fullShot}`);

  if (result.failures.length > 0) {
    console.error('FAILURES:');
    for (const f of result.failures) console.error(`  ${f}`);
    process.exit(1);
  }
  console.log('All browser edge routing checks passed.');
} finally {
  await browser.close();
}
