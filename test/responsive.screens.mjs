// Responsive capture screens for AbstractFlow (used by the shared harness
// untracked/responsive/harness/capture.mjs; not a vitest file).
//
//   node capture.mjs --app flow --url http://127.0.0.1:18784 \
//     --screens <this file> --out <dir> --sweep
//
// Needs the hermetic gateway fixture (abstractcode/web/e2e/gateway_fixture.py)
// and the Flow dev server proxying it (ABSTRACTFLOW_GATEWAY_URL). The fixture
// user/token are test-only values. FLOW_GATEWAY_URL overrides the gateway URL.
const GATEWAY_URL = process.env.FLOW_GATEWAY_URL || 'http://127.0.0.1:18783';
const USER = 'web-tester';
const TOKEN = 'abstractcode-e2e-only';
const FLOW_NAME = 'map-reduce';

async function signedIn(page) {
  return (await page.locator('.app-header').count()) > 0;
}

async function ensureSignedIn(page) {
  if (await signedIn(page)) return;
  await page.waitForSelector('#gateway-session-user', { timeout: 15000 });
  const url = page.locator('#gateway-session-url');
  if (await url.count()) await url.fill(GATEWAY_URL);
  await page.fill('#gateway-session-user', USER);
  await page.fill('#gateway-session-token', TOKEN);
  await page.click('button.af-gateway-signin__primary');
  await page.waitForSelector('.app-header', { timeout: 15000 });
  await page.waitForTimeout(400);
}

// Close whatever overlay a previous screen left open.
async function closeOverlays(page) {
  for (let i = 0; i < 3; i++) {
    const open = await page.locator('.modal-overlay, .af-appearance-overlay, [role="dialog"]').count();
    if (!open) break;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
  }
  // Modals that ignore Escape: use their visible Cancel/Close button.
  const cancel = page.locator('.modal-overlay .modal-button.cancel, .run-window-control.close, .af-appearance-overlay button[aria-label="Close"]').first();
  if (await cancel.count()) {
    try { await cancel.click({ timeout: 1500 }); } catch { /* not clickable */ }
  }
}

async function clickToolbar(page, name) {
  // Wide layouts show the button in the toolbar; narrow layouts may move it
  // into the toolbar's "More" menu.
  const direct = page.getByRole('button', { name, exact: true }).first();
  if (await direct.isVisible().catch(() => false)) {
    await direct.click();
    return;
  }
  const more = page.locator('.toolbar-more-button').first();
  if (await more.count()) {
    await more.click();
    await page.getByRole('menuitem', { name, exact: true }).first().click();
    return;
  }
  await direct.click();
}

async function openLibrary(page) {
  await clickToolbar(page, 'Open Flow');
  await page.waitForSelector('.flow-library-modal', { timeout: 10000 });
  await page.waitForTimeout(600);
}

async function ensureFlowLoaded(page, { reload = false } = {}) {
  await ensureSignedIn(page);
  const name = await page.locator('.flow-name-input, .app-header input').first().inputValue().catch(() => '');
  if (!reload && name.startsWith(FLOW_NAME)) return;
  await closeOverlays(page);
  await openLibrary(page);
  await page.fill('.flow-library-search', FLOW_NAME);
  await page.waitForTimeout(500);
  await page.locator('.flow-library-row', { hasText: FLOW_NAME }).first().click();
  await page.locator('.flow-library-actions .modal-button.primary', { hasText: 'Load' }).click();
  await page.waitForSelector('.react-flow__node', { timeout: 10000 });
  await page.waitForTimeout(600);
}

async function fitView(page) {
  const fit = page.locator('.react-flow__controls-fitview');
  if (await fit.isVisible().catch(() => false)) await fit.click({ force: true, timeout: 3000 }).catch(() => {});
}

async function clearSelection(page) {
  await page.keyboard.press('Escape');
  const pane = page.locator('.react-flow__pane');
  if (await pane.count()) {
    const box = await pane.boundingBox();
    if (box) await page.mouse.click(box.x + 8, box.y + box.height - 8);
  }
}

async function closeDrawers(page) {
  for (const label of ['Close authoring assistant', 'Close properties', 'Close functions', 'Close node palette']) {
    const b = page.getByRole('button', { name: label }).first();
    if (await b.isVisible().catch(() => false)) await b.click().catch(() => {});
  }
}

export default {
  async setup(page) {
    // Nothing: the first screen is the sign-in gate itself.
    await page.waitForTimeout(300);
  },
  screens: [
    {
      name: 'connect',
      async run(page) {
        await page.waitForSelector('#gateway-session-user', { timeout: 15000 });
      },
    },
    {
      name: 'home',
      async run(page) {
        await ensureSignedIn(page);
        await closeOverlays(page);
      },
      settle: 900,
    },
    {
      name: 'library',
      async run(page) {
        await ensureSignedIn(page);
        await closeOverlays(page);
        await openLibrary(page);
        await page.locator('.flow-library-row', { hasText: FLOW_NAME }).first().click().catch(() => {});
      },
    },
    {
      name: 'editor',
      async run(page) {
        await ensureFlowLoaded(page);
        await closeOverlays(page);
        await clearSelection(page);
        await closeDrawers(page);
        await fitView(page);
      },
      settle: 900,
    },
    {
      name: 'palette',
      async run(page) {
        await ensureFlowLoaded(page);
        await closeOverlays(page);
        const opener = page.getByRole('button', { name: 'Open node palette' }).first();
        if (await opener.isVisible().catch(() => false)) await opener.click();
        const search = page.locator('.node-palette input, .sidebar.left input').first();
        await search.fill('llm');
      },
    },
    {
      name: 'properties',
      async run(page) {
        await ensureFlowLoaded(page);
        const search = page.locator('.node-palette input, .sidebar.left input').first();
        if (await search.isVisible().catch(() => false)) await search.fill('');
        await closeDrawers(page);
        await closeOverlays(page);
        await fitView(page);
        await page.locator('.react-flow__node .node-title', { hasText: /per-item llm/i }).first().click({ force: true });
        await page.waitForSelector('.properties-panel, .properties-drawer-open', { timeout: 5000 }).catch(() => {});
      },
    },
    {
      name: 'run',
      async run(page) {
        await ensureFlowLoaded(page);
        await closeDrawers(page);
        await clearSelection(page);
        // A bundled flow is read-only and Run stays gated while the editor
        // holds edits: save a standalone copy in the (throwaway) fixture
        // gateway first.
        let run = page.getByRole('button', { name: 'Run flow', exact: true }).first();
        // An earlier screen's tap can leave the bundled flow marked modified
        // (Run is gated then): reload it unmodified first.
        if (await run.isDisabled().catch(() => true)) {
          await ensureFlowLoaded(page, { reload: true });
          await closeDrawers(page);
          run = page.getByRole('button', { name: 'Run flow', exact: true }).first();
        }
        if (await run.isDisabled().catch(() => true)) {
          await clickToolbar(page, 'Duplicate Flow');
          const save = page.locator('.modal .modal-button.primary', { hasText: 'Save copy' }).first();
          await save.click({ timeout: 5000 }).catch(() => {});
          await page.waitForTimeout(1500);
        }
        await clickToolbar(page, 'Run flow');
        await page.waitForSelector('.run-modal', { timeout: 10000 });
        await page.waitForTimeout(500);
        const start = page.locator('.run-modal button').filter({ hasText: /^(Run|Start|Start run)$/ }).first();
        if (await start.isVisible().catch(() => false)) {
          await start.click().catch(() => {});
          await page.waitForTimeout(2500);
        }
      },
      settle: 1200,
    },
    {
      name: 'assistant',
      async run(page) {
        await ensureSignedIn(page);
        await closeOverlays(page);
        await closeOverlays(page);
        const b = page.getByRole('button', { name: 'Authoring assistant' }).first();
        if (await b.isVisible().catch(() => false)) await b.click();
        else await page.getByRole('button', { name: 'Open authoring assistant' }).first().click();
      },
      settle: 1200,
    },
    {
      name: 'settings',
      async run(page) {
        await closeDrawers(page);
        await closeOverlays(page);
        await page.getByRole('button', { name: /Appearance/ }).first().click();
        await page.waitForTimeout(300);
      },
    },
  ],
  sweepScreen: 'editor',
};
