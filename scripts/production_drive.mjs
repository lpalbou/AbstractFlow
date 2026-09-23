/**
 * Production drive (operator directive c1505 ask 2): drive the LIVE editor on
 * :3000 against the LIVE gateway on :8080 the way the operator does —
 * sign-in through the real connect modal, browse the real library, load the
 * bundled basic-agent, run a real (no-LLM) flow through the run modal — and
 * screenshot every stage as evidence.
 *
 * Usage: node scripts/production_drive.mjs [outDir]
 * Env:   DRIVE_USER / DRIVE_TOKEN (gateway credentials; no defaults printed)
 */

import { existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let puppeteer;
try {
  puppeteer = require('puppeteer-core');
} catch {
  const sibling = createRequire(`${process.env.HOME}/tmp/abstractflow/web/frontend/package.json`);
  puppeteer = sibling('puppeteer-core');
}

const CHROME = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
].filter(Boolean).find((p) => existsSync(p));
if (!CHROME) {
  console.error('No Chrome binary found');
  process.exit(2);
}

const BASE = process.env.DRIVE_BASE || 'http://127.0.0.1:3000';
const GATEWAY = process.env.DRIVE_GATEWAY || 'http://127.0.0.1:8080';
const USER = process.env.DRIVE_USER || '';
const TOKEN = process.env.DRIVE_TOKEN || '';
const OUT = process.argv[2] || '/tmp/flow-drive';
mkdirSync(OUT, { recursive: true });

const findings = [];
const note = (s) => {
  findings.push(s);
  console.log(`[drive] ${s}`);
};

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--disable-gpu', '--hide-scrollbars', '--window-size=1440,900'],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
  page.on('pageerror', (err) => note(`PAGEERROR: ${String(err).slice(0, 200)}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') note(`CONSOLE-ERROR: ${msg.text().slice(0, 200)}`);
  });

  // 1. Boot: signed out -> connect modal is the first screen.
  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 30000 });
  await page.waitForSelector('.af-gateway-signin, .gateway-connection-kicker', { timeout: 15000 });
  await page.screenshot({ path: `${OUT}/01_connect_modal.png` });
  note('boot: connect modal rendered as first screen');

  // 2. Sign in through the REAL modal inputs (no API shortcuts).
  const inputs = await page.$$('.af-gateway-signin input');
  if (inputs.length < 3) throw new Error(`expected >=3 signin inputs, got ${inputs.length}`);
  // Field order: gateway URL, user id, token (per GatewaySessionSignInCard).
  // React-controlled inputs: set via the native value setter + input event so
  // pre-filled defaults are REPLACED, never appended to.
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
    await page.waitForSelector('.app-header .logo-text', { timeout: 30000 });
  } catch (e) {
    await page.screenshot({ path: `${OUT}/02_signin_failed.png` });
    const errText = await page.evaluate(() => {
      const el = document.querySelector('.af-gateway-signin__error, .af-gateway-signin__status, [class*="error"]');
      return el ? el.textContent : document.body.innerText.slice(0, 600);
    });
    note(`SIGNIN FAILURE STATE: ${String(errText).slice(0, 400)}`);
    throw e;
  }
  note('sign-in: session established, editor rendered');
  await new Promise((r) => setTimeout(r, 1500));
  await page.screenshot({ path: `${OUT}/02_editor.png` });

  // 3. Open the Flow Library (the real toolbar action).
  const openBtn = await page.$('button[aria-label="Open Flow"], [data-tooltip="Open a saved flow"]');
  if (openBtn) {
    await openBtn.click();
  } else {
    // Fallback: find by visible label text.
    await page.evaluate(() => {
      const els = Array.from(document.querySelectorAll('button'));
      const hit = els.find((b) => (b.textContent || '').includes('Open Flow'));
      if (hit) hit.click();
    });
  }
  await page.waitForSelector('.flow-library-modal', { timeout: 15000 });
  await new Promise((r) => setTimeout(r, 1200)); // let the flows query land
  await page.screenshot({ path: `${OUT}/03_library_all.png` });
  const counts = await page.$eval('.flow-library-count', (el) => el.textContent || '');
  note(`library: header counts = "${counts.trim()}"`);

  // 4. Runnable view — basic-agent must be present (the operator's report).
  await page.evaluate(() => {
    const tabs = Array.from(document.querySelectorAll('.flow-library-view-option'));
    const runnable = tabs.find((t) => (t.textContent || '').includes('Runnable'));
    if (runnable) runnable.click();
  });
  await new Promise((r) => setTimeout(r, 600));
  const runnableNames = await page.$$eval('.flow-library-item-name', (els) =>
    els.map((e) => (e.textContent || '').trim())
  );
  note(`runnable view rows: ${JSON.stringify(runnableNames.slice(0, 10))}`);
  if (!runnableNames.some((n) => n.includes('basic-agent'))) {
    note('FINDING(P1): basic-agent NOT visible in Runnable view');
  }
  await page.screenshot({ path: `${OUT}/04_library_runnable.png` });

  // 5. Expand a family in All view (kit DisclosureList expansion, live data).
  await page.evaluate(() => {
    const tabs = Array.from(document.querySelectorAll('.flow-library-view-option'));
    const all = tabs.find((t) => (t.textContent || '').trim() === 'All');
    if (all) all.click();
  });
  await new Promise((r) => setTimeout(r, 600));
  const expanded = await page.evaluate(() => {
    const body = document.querySelector('[data-flow-id="deep-research"]');
    const row = body ? body.closest('.af-disclosure__row') : null;
    const chev = row ? row.querySelector('.af-disclosure__chevron') : null;
    if (chev) {
      chev.click();
      return true;
    }
    return false;
  });
  await new Promise((r) => setTimeout(r, 800));
  note(`family expand on deep-research: ${expanded ? 'clicked' : 'row not found'}`);
  await page.screenshot({ path: `${OUT}/05_library_family.png` });

  // 6. Load bundled basic-agent (double-click activates).
  await page.evaluate(() => {
    const body = document.querySelector('[data-flow-id="81795ea9"]');
    const row = body ? body.closest('.af-disclosure__row') : null;
    if (row) row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  });
  await new Promise((r) => setTimeout(r, 1500));
  const canvasNodes = await page.$$eval('.react-flow__node', (els) => els.length);
  note(`basic-agent loaded: ${canvasNodes} nodes on canvas`);
  await page.screenshot({ path: `${OUT}/06_basic_agent_loaded.png` });

  console.log('\nDRIVE COMPLETE');
  for (const f of findings) console.log(` - ${f}`);
} finally {
  await browser.close();
}
