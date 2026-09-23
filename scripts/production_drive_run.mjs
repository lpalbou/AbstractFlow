/**
 * Production drive part 2: a LIVE run through the run modal — loads the
 * operator's no-LLM `test-code` flow (zero token cost), starts it against the
 * live gateway, and captures the steps panel + terminal state as evidence.
 *
 * Usage: DRIVE_USER=... DRIVE_TOKEN=... node scripts/production_drive_run.mjs [outDir]
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
].filter(Boolean).find((p) => existsSync(p));

const BASE = process.env.DRIVE_BASE || 'http://127.0.0.1:3000';
const GATEWAY = process.env.DRIVE_GATEWAY || 'http://127.0.0.1:8080';
const USER = process.env.DRIVE_USER || '';
const TOKEN = process.env.DRIVE_TOKEN || '';
const OUT = process.argv[2] || '/tmp/flow-drive';
mkdirSync(OUT, { recursive: true });

const note = (s) => console.log(`[drive2] ${s}`);

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--disable-gpu', '--hide-scrollbars', '--window-size=1440,900'],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
  page.on('pageerror', (err) => note(`PAGEERROR: ${String(err).slice(0, 200)}`));

  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 30000 });
  await page.waitForSelector('.af-gateway-signin, .app-header', { timeout: 15000 });

  // Sign in if the modal is up (session may persist from part 1's browser —
  // fresh headless profile means we sign in again).
  const modal = await page.$('.af-gateway-signin');
  if (modal) {
    const inputs = await page.$$('.af-gateway-signin input');
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
    await page.waitForSelector('.app-header .logo-text', { timeout: 30000 });
  }
  note('signed in');

  // Open library, search test-code, load it. The toolbar action stays
  // DISABLED until the gateway capabilities query lands — retry until the
  // modal actually opens (the operator's own first-click experience).
  try {
    await page.waitForFunction(
      () => {
        if (document.querySelector('.flow-library-modal')) return true;
        const hit = document.querySelector('button[aria-label="Open Flow"]');
        if (!hit || hit.disabled) return false;
        hit.click();
        return document.querySelector('.flow-library-modal') !== null;
      },
      { timeout: 30000, polling: 700 }
    );
  } catch (e) {
    await page.screenshot({ path: `${OUT}/07_open_flow_stuck.png` });
    const state = await page.evaluate(() => {
      const b = document.querySelector('button[aria-label="Open Flow"]');
      return b ? `found disabled=${b.disabled} tooltip=${b.getAttribute('data-tooltip') || b.title}` : 'button not found';
    });
    note(`OPEN FLOW STUCK: ${state}`);
    throw e;
  }
  await page.waitForSelector('.flow-library-modal', { timeout: 15000 });
  await new Promise((r) => setTimeout(r, 1500));
  await page.type('.flow-library-search', 'test-code', { delay: 10 });
  await new Promise((r) => setTimeout(r, 800));
  const loaded = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('.flow-library-item-name'));
    const hit = rows.find((r) => (r.textContent || '').trim().startsWith('test-code'));
    if (!hit) return false;
    const row = hit.closest('.af-disclosure__row');
    if (!row) return false;
    row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    return true;
  });
  note(`test-code load: ${loaded}`);
  await new Promise((r) => setTimeout(r, 1500));
  await page.screenshot({ path: `${OUT}/07_testcode_loaded.png` });

  // Run it: toolbar Run opens the run modal.
  await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll('button'));
    const hit = els.find((b) => (b.textContent || '').trim() === 'Run' || (b.getAttribute('aria-label') || '') === 'Run Flow');
    if (hit) hit.click();
  });
  await page.waitForSelector('.run-modal', { timeout: 15000 });
  await new Promise((r) => setTimeout(r, 1200));
  await page.screenshot({ path: `${OUT}/08_run_preflight.png` });
  note('run modal open (preflight)');

  // Start the run.
  await page.evaluate(() => {
    const cta = document.querySelector('.modal-button.run-cta');
    if (cta) cta.click();
  });
  // Wait for terminal state: SUCCESS/FAILED in the steps subtitle.
  await page.waitForFunction(
    () => {
      const el = document.querySelector('.run-steps-subtitle');
      const t = el ? el.textContent || '' : '';
      return t.includes('SUCCESS') || t.includes('FAILED');
    },
    { timeout: 60000 }
  );
  await new Promise((r) => setTimeout(r, 800));
  const verdict = await page.$eval('.run-steps-subtitle', (el) => (el.textContent || '').trim());
  note(`run terminal state: ${verdict}`);
  const stepCount = await page.$$eval('.run-step', (els) => els.length);
  note(`steps rendered: ${stepCount}`);
  await page.screenshot({ path: `${OUT}/09_run_complete.png` });

  console.log('\nDRIVE2 COMPLETE');
} finally {
  await browser.close();
}
