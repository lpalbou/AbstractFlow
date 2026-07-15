/**
 * Live end-to-end proof of assistant SUBFLOW CREATION (graph.subflows):
 * signs into the editor, opens the assistant drawer, asks for a workflow
 * that requires a helper subflow, waits for the turn, then verifies against
 * the gateway that (a) a helper workflow was CREATED in the store and
 * (b) the canvas references it from a subflow node.
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
const OUT = '/tmp/flow-subflow-drive';
mkdirSync(OUT, { recursive: true });
const note = (s) => console.log(`[subflow-drive] ${s}`);

const REQUEST = [
  'Create a workflow with ONE helper subflow.',
  'The helper: name it text-shouter, it takes a string input "text" and returns it uppercased as output "shouted" (use a code node with body: result = str(inputs.get("text") or "").upper()).',
  'The main workflow: input "message" on flow start, call the helper via a subflow node, expose the helper output as flow output "result".',
  'No agents, no LLM calls, no other nodes. Keep it minimal.',
].join(' ');

async function flowsSnapshot() {
  const res = await fetch(`${GATEWAY}/api/gateway/visualflows`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  const list = await res.json();
  return Array.isArray(list) ? list.map((f) => ({ id: f.id, name: f.name })) : [];
}

const before = await flowsSnapshot();
note(`store before: ${before.length} flows`);

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--disable-gpu', '--hide-scrollbars', '--window-size=1600,950'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 950, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => note(`PAGEERROR ${String(e).slice(0, 140)}`));

  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 30000 });
  if (await page.$('.af-gateway-signin')) {
    const inputs = await page.$$('.af-gateway-signin input');
    const set = async (h, v) => h.evaluate((el, val) => { const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; s.call(el, val); el.dispatchEvent(new Event('input', { bubbles: true })); }, v);
    await set(inputs[0], GATEWAY); await set(inputs[1], USER); await set(inputs[2], TOKEN);
    await page.click('.af-gateway-signin__primary');
    await page.waitForSelector('.app-header .logo-text', { timeout: 30000 });
  }
  note('signed in');

  // Open the assistant drawer via the right rail.
  await page.waitForFunction(() => {
    if (document.querySelector('.authoring-assistant')) return true;
    const btn = Array.from(document.querySelectorAll('.right-drawer-rail-action')).find((b) => /assistant/i.test(b.getAttribute('title') || b.textContent || ''));
    if (btn) { btn.click(); }
    return document.querySelector('.authoring-assistant') !== null;
  }, { timeout: 20000, polling: 600 });
  note('assistant drawer open');

  // Type the request and send.
  await page.evaluate((text) => {
    const ta = document.querySelector('.assistant-input-area textarea');
    const s = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    s.call(ta, text);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }, REQUEST);
  await new Promise((r) => setTimeout(r, 400));
  await page.evaluate(() => {
    const send = Array.from(document.querySelectorAll('.assistant-actions-send button')).find((b) => b.textContent?.trim() === 'Send');
    send?.click();
  });
  note('request sent — waiting for the turn (up to 10 min)');
  await page.screenshot({ path: `${OUT}/1_sent.png` });

  // Wait until busy clears (Send button returns / Stop disappears).
  const deadline = Date.now() + 10 * 60_000;
  let done = false;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 5000));
    const state = await page.evaluate(() => {
      const stop = Array.from(document.querySelectorAll('.assistant-actions-send button')).find((b) => /Stop/i.test(b.textContent || ''));
      const pill = document.querySelector('.assistant-state-pill')?.textContent || '';
      const lastMsg = Array.from(document.querySelectorAll('.assistant-message, .assistant-messages [class*=message]')).pop()?.textContent?.slice(0, 120) || '';
      return { busy: Boolean(stop), pill, lastMsg };
    });
    if (!state.busy) { done = true; note(`turn finished (pill: ${state.pill})`); break; }
  }
  if (!done) note('#TIMEOUT turn still running after 10 min');
  await page.screenshot({ path: `${OUT}/2_done.png`, fullPage: false });

  // Verify: canvas has a subflow node; store gained a helper.
  const canvas = await page.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll('.react-flow__node'));
    return nodes.map((n) => (n.textContent || '').slice(0, 60));
  });
  note(`canvas nodes: ${JSON.stringify(canvas)}`);

  const after = await flowsSnapshot();
  const beforeIds = new Set(before.map((f) => f.id));
  const created = after.filter((f) => !beforeIds.has(f.id));
  note(`store after: ${after.length} flows; CREATED: ${JSON.stringify(created)}`);

  if (created.length > 0) {
    const helper = created.find((f) => /shout/i.test(f.name)) || created[0];
    const res = await fetch(`${GATEWAY}/api/gateway/visualflows/${helper.id}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
    const graph = await res.json();
    const types = (graph.nodes || []).map((n) => n.type);
    note(`helper "${helper.name}" (${helper.id}): nodes=${JSON.stringify(types)} desc="${(graph.description || '').slice(0, 80)}"`);
  }
  console.log('\nDRIVE DONE');
} finally {
  await browser.close();
}
