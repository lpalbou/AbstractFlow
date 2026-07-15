/**
 * Reproduce the "can't cancel an ongoing workflow" bug end to end.
 * Loads the cancel-probe flow (ask_user, no model), runs it live, waits for
 * the WAITING state, clicks the footer Cancel, then reports BOTH the UI
 * status label AND the gateway's run status (bisects frontend vs backend).
 */
import { existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let puppeteer;
try { puppeteer = require('puppeteer-core'); }
catch { puppeteer = createRequire('/Users/albou/tmp/abstractflow/web/frontend/package.json')('puppeteer-core'); }

const CHROME = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(existsSync);
const BASE = 'http://127.0.0.1:3000';
const GATEWAY = 'http://127.0.0.1:8080';
const USER = process.env.DRIVE_USER || '';
const TOKEN = process.env.DRIVE_TOKEN || '';
const OUT = '/tmp/flow-cancel';
mkdirSync(OUT, { recursive: true });
const note = (s) => console.log(`[cancel] ${s}`);

// Self-contained: (re)create the probe flow in the store first so the drive
// never depends on leftover fixtures.
const PROBE = {
  id: 'ca11ce15',
  name: 'cancel-probe',
  description: 'Minimal ask_user flow (no model) to reproduce the cancel-while-waiting bug end to end.',
  interfaces: [],
  entryNode: 'node-1',
  nodes: [
    { id: 'node-1', type: 'on_flow_start', position: { x: -360, y: 64 }, data: { nodeType: 'on_flow_start', label: 'On Flow Start', icon: '&#x1F3C1;', headerColor: '#C0392B', inputs: [], outputs: [{ id: 'exec-out', label: '', type: 'execution' }, { id: 'prompt', label: 'prompt', type: 'string' }] } },
    { id: 'node-4', type: 'ask_user', position: { x: 240, y: 64 }, data: { nodeType: 'ask_user', label: 'Ask User', icon: '&#x2753;', headerColor: '#9B59B6', pinDefaults: { prompt: 'Waiting forever until you cancel me.' }, inputs: [{ id: 'exec-in', label: '', type: 'execution' }, { id: 'prompt', label: 'prompt', type: 'string' }, { id: 'choices', label: 'choices', type: 'array' }], outputs: [{ id: 'exec-out', label: '', type: 'execution' }, { id: 'response', label: 'response', type: 'string' }] } },
    { id: 'node-2', type: 'on_flow_end', position: { x: 840, y: 64 }, data: { nodeType: 'on_flow_end', label: 'On Flow End', icon: '&#x23F9;', headerColor: '#C0392B', inputs: [{ id: 'exec-in', label: '', type: 'execution' }, { id: 'output1', label: 'output1', type: 'string' }], outputs: [] } },
  ],
  edges: [
    { id: 'e1', source: 'node-1', sourceHandle: 'exec-out', target: 'node-4', targetHandle: 'exec-in' },
    { id: 'e2', source: 'node-4', sourceHandle: 'exec-out', target: 'node-2', targetHandle: 'exec-in' },
    { id: 'e3', source: 'node-4', sourceHandle: 'response', target: 'node-2', targetHandle: 'output1' },
  ],
};
let probeId = '';
{
  // POST creates (schema forbids `id`: the gateway mints one); PUT updates.
  const { id: _omit, ...createBody } = PROBE;
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` };
  const res = await fetch(`${GATEWAY}/api/gateway/visualflows`, { method: 'POST', headers, body: JSON.stringify(createBody) });
  if (!res.ok) throw new Error(`probe flow create failed: ${await res.text()}`);
  const created = await res.json();
  probeId = String(created.id || '');
  note(`probe flow created: ${probeId}`);
}

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--disable-gpu', '--hide-scrollbars', '--window-size=1440,900'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => note(`PAGEERROR ${String(e).slice(0, 160)}`));
  let cancelRunId = '';
  page.on('request', (req) => {
    if (req.url().includes('/api/gateway/commands') && req.method() === 'POST') {
      try { const b = JSON.parse(req.postData() || '{}'); if (b.type === 'cancel') { cancelRunId = b.run_id || ''; note(`CANCEL command POSTed for run_id=${cancelRunId}`); } } catch {}
    }
  });

  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 30000 });
  const modal = await page.$('.af-gateway-signin');
  if (modal) {
    const inputs = await page.$$('.af-gateway-signin input');
    const set = async (h, v) => h.evaluate((el, val) => { const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; s.call(el, val); el.dispatchEvent(new Event('input', { bubbles: true })); }, v);
    await set(inputs[0], GATEWAY); await set(inputs[1], USER); await set(inputs[2], TOKEN);
    await page.click('.af-gateway-signin__primary');
    await page.waitForSelector('.app-header .logo-text', { timeout: 30000 });
  }
  note('signed in');

  // Open library, load the cancel-probe.
  await page.waitForFunction(() => {
    if (document.querySelector('.flow-library-modal')) return true;
    const b = document.querySelector('button[aria-label="Open Flow"]');
    if (!b || b.disabled) return false; b.click(); return document.querySelector('.flow-library-modal') !== null;
  }, { timeout: 30000, polling: 700 });
  await new Promise((r) => setTimeout(r, 1200));
  await page.type('.flow-library-search', 'cancel-probe', { delay: 10 });
  await new Promise((r) => setTimeout(r, 800));
  await page.evaluate(() => {
    const hit = Array.from(document.querySelectorAll('.flow-library-item-name')).find((n) => (n.textContent || '').startsWith('cancel-probe'));
    const row = hit?.closest('.af-disclosure__row');
    if (row) row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  });
  await new Promise((r) => setTimeout(r, 1500));
  note('cancel-probe loaded');

  // Run it.
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('button')).find((x) => (x.textContent || '').trim() === 'Run' || x.getAttribute('aria-label') === 'Run Flow');
    if (b) b.click();
  });
  await page.waitForSelector('.run-modal', { timeout: 15000 });
  await new Promise((r) => setTimeout(r, 800));
  await page.evaluate(() => { const c = document.querySelector('.modal-button.run-cta'); if (c) c.click(); });

  // Wait for WAITING.
  await page.waitForFunction(() => {
    const el = document.querySelector('.run-steps-subtitle');
    return el && /WAITING/.test(el.textContent || '');
  }, { timeout: 30000 });
  note('run reached WAITING');
  await page.screenshot({ path: `${OUT}/1_waiting.png` });

  // Click the footer Cancel.
  const clicked = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('.run-modal-footer-right button, .run-modal .modal-button'));
    const cancel = btns.find((b) => (b.textContent || '').trim() === 'Cancel');
    if (cancel) { cancel.click(); return true; }
    return false;
  });
  note(`footer Cancel clicked: ${clicked}`);
  await new Promise((r) => setTimeout(r, 4000));

  const uiStatus = await page.$eval('.run-steps-subtitle', (el) => (el.textContent || '').trim()).catch(() => '(no subtitle)');
  note(`UI status after cancel: ${uiStatus}`);
  await page.screenshot({ path: `${OUT}/2_after_cancel.png` });

  // Backend truth.
  if (cancelRunId) {
    const res = await fetch(`${GATEWAY}/api/gateway/runs/${cancelRunId}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
    const body = await res.json().catch(() => ({}));
    note(`BACKEND run status: ${body.status} (paused=${body.paused}, waiting=${body.waiting ? 'yes' : 'no'})`);
  } else {
    note('NO cancel command was POSTed — the button did not fire a cancel');
  }
  console.log('\nREPRO DONE');
} finally {
  await browser.close();
  // Leave the store clean: the probe is a diagnostic fixture, not a library flow.
  if (probeId) await fetch(`${GATEWAY}/api/gateway/visualflows/${probeId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${TOKEN}` } }).catch(() => {});
}
