// Browser check (not a vitest file): on a phone and in phone landscape, a toast
// raised while the run window is open must not cover the window's title bar —
// the close control stays the element under a tap, and a real tap closes it.
// 0.5.0 failed this: the "Workflow failed … Click to copy full error" toast sat
// over the traffic lights and the tap copied the error.
//
//   node test/toast_over_sheet.probe.mjs [baseUrl]   (exit 1 on failure)
//
// Needs the hermetic gateway fixture + the Flow dev server, as the responsive
// screens module does (FLOW_GATEWAY_URL, default http://127.0.0.1:18783).
// Playwright from PW_NODE_MODULES (default: the AbstractCode web install).
import { createRequire } from 'node:module';
import mod from './responsive.screens.mjs';

const base = process.argv[2] || 'http://127.0.0.1:18784/';
const require = createRequire(`${process.env.PW_NODE_MODULES || '/Users/albou/tmp/abstractframework/abstractcode/web/node_modules'}/noop.js`);
const pw = require('playwright-core');
const runScreen = mod.screens.find((s) => s.name === 'run');
const browser = await pw.chromium.launch();
const results = [];
for (const vp of [{ name: 'iphone-15pro', width: 393, height: 852 }, { name: 'iphone-15pro-land', width: 852, height: 393 }]) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, hasTouch: true, isMobile: true, colorScheme: 'dark' });
  const page = await ctx.newPage();
  await page.goto(base);
  await mod.setup(page, { browser: 'chromium' });
  await runScreen.run(page, {});
  const r = await page.evaluate(() => {
    const close = document.querySelector('.run-window-control.close');
    const bar = document.querySelector('.run-modal-titlebar');
    const toasts = [...document.querySelectorAll('.app-toaster [role="status"]')].map((t) => t.getBoundingClientRect());
    if (!close || !bar) return { error: 'run window not open' };
    const c = close.getBoundingClientRect();
    const hit = document.elementFromPoint(c.x + c.width / 2, c.y + c.height / 2);
    const barBottom = bar.getBoundingClientRect().bottom;
    return {
      toasts: toasts.length,
      toastTop: toasts.length ? Math.round(Math.min(...toasts.map((t) => t.top))) : null,
      barBottom: Math.round(barBottom),
      closeHit: !!hit && (hit === close || close.contains(hit)),
      toastOverBar: toasts.some((t) => t.top < barBottom && t.bottom > bar.getBoundingClientRect().top),
    };
  });
  if (!r.error) {
    await page.locator('.run-window-control.close').click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(300);
    r.closedByTap = (await page.locator('.run-modal').count()) === 0;
  }
  r.ok = !r.error && r.toasts > 0 && r.closeHit && !r.toastOverBar && r.closedByTap;
  results.push({ viewport: vp.name, ...r });
  await ctx.close();
}
await browser.close();
console.log(JSON.stringify(results, null, 1));
process.exit(results.every((r) => r.ok) ? 0 : 1);
