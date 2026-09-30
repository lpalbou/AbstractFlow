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
    // dispatchEvent, not click(): in 0.5.0 a top-centre toast sat over the run
    // window's close control on phones (fixed in space.css; checked by
    // test/toast_over_sheet.probe.mjs). Kept so BEFORE captures still run.
    try { await cancel.dispatchEvent('click'); } catch { /* not clickable */ }
    await page.waitForTimeout(250);
  }
}

async function clickToolbar(page, name) {
  // Wide layouts show the button in the toolbar; narrow layouts may move it
  // into the toolbar's "More" menu.
  const direct = page.getByRole('button', { name, exact: true }).first();
  if (await direct.isVisible().catch(() => false)) {
    // dispatchEvent: a phone's top-centre toast ("Click to copy full error")
    // can sit over the header buttons; a real click would copy the toast.
    await direct.dispatchEvent('click');
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
  // Right after a (re)load the toolbar can still be settling: retry once.
  for (let attempt = 0; attempt < 3; attempt++) {
    await clickToolbar(page, 'Open Flow');
    if (await page.locator('.flow-library-modal').isVisible({ timeout: 4000 }).catch(() => false)) break;
    await page.waitForTimeout(800);
  }
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
  // Replacing a modified flow asks for confirmation.
  const cont = page.locator('.modal .modal-button', { hasText: /^Continue$/ }).first();
  if (await cont.isVisible({ timeout: 1500 }).catch(() => false)) await cont.click();
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

// A real run on the fixture gateway (its bundled `prompt-structured` flow:
// answer_user -> ask_user, no model): gives the run history a row and the run
// window a ledger with a message and a waiting question. Started once per
// capture process.
let seededRun = null;
async function seedRun() {
  if (seededRun) return seededRun;
  const res = await fetch(`${GATEWAY_URL}/api/gateway/runs/start`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      bundle_id: 'abstractcode-web-e2e',
      flow_id: 'prompt-structured',
      input_data: {
        prompt: 'Summarise the release notes for the mail watcher and list the three changes that matter to someone who reads their mail on a phone.',
        ticket: 'T-1234',
      },
    }),
  });
  if (!res.ok) throw new Error(`seed run: HTTP ${res.status}`);
  seededRun = (await res.json()).run_id;
  return seededRun;
}

// The editor lists runs of the loaded flow only; the seeded run belongs to the
// fixture bundle, so the runs list is widened to every root run.
async function widenRunList(page) {
  await page.route(/\/api\/gateway\/runs\?/, async (route) => {
    const url = new URL(route.request().url());
    url.searchParams.delete('workflow_id');
    const resp = await route.fetch({ url: url.toString() });
    await route.fulfill({ response: resp });
  });
}

async function openFromToolbar(page, label, selector) {
  await ensureFlowLoaded(page);
  await closeDrawers(page);
  await closeOverlays(page);
  await clickToolbar(page, label);
  await page.waitForSelector(selector, { timeout: 10000 });
  await page.waitForTimeout(600);
}

// Select the first row of a list inside a dialog so its detail is showing.
async function selectFirst(page, rowSelector) {
  const row = page.locator(rowSelector).first();
  if (await row.isVisible({ timeout: 3000 }).catch(() => false)) {
    await row.click().catch(() => {});
    await page.waitForTimeout(700);
  }
}

export default {
  // Space metrics (untracked/responsive/harness README "Space metrics"),
  // documented exceptions excluded from the text-box search and the scroll
  // count: the React Flow canvas (it pans and zooms in its own box by design)
  // and the toasts (transient notices with an icon gutter, not a reading
  // column; they leave on their own).
  spaceIgnore: ['.react-flow', '.app-toaster'],
  async setup(page, info) {
    // The first screen is the sign-in gate itself.
    // Monaco writes the clipboard on some focus/escape paths; headless
    // Chromium denies it and logs NotAllowedError + "Canceled" (noise, seen on
    // main too). A real browser allows it on a user gesture.
    if (!info || info.browser === 'chromium') {
      await page.context().grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
    }
    // Flow's theme is its Appearance setting (not prefers-color-scheme):
    // FLOW_THEME=light (or any kit theme id) captures that theme.
    if (process.env.FLOW_THEME) {
      await page.evaluate((theme) => {
        try {
          localStorage.setItem('af_appearance_abstractflow_v1', JSON.stringify({ theme, font_scale: 'md', header_density: 'standard' }));
        } catch { /* storage blocked: default theme */ }
      }, process.env.FLOW_THEME);
      await page.reload({ waitUntil: 'domcontentloaded' });
    }
    await seedRun();
    await widenRunList(page);
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
      name: 'run-history',
      async run(page) {
        // The list itself: picking a run opens it in the run window (the 'run' screen).
        await openFromToolbar(page, 'Open run history', '.run-history-list, .run-history-empty');
      },
      settle: 900,
    },
    {
      name: 'run-detail',
      async run(page) {
        // The seeded run opened from the history: its ledger (message, waiting
        // question) and the step details.
        await openFromToolbar(page, 'Open run history', '.run-history-list, .run-history-empty');
        await page.locator('.run-history-button').first().click();
        await page.waitForSelector('.run-modal', { timeout: 10000 });
        await page.waitForTimeout(1500);
        const step = page.locator('.run-modal .run-step, .run-modal [class*="step-row"], .run-modal [class*="timeline"] button').first();
        if (await step.isVisible().catch(() => false)) await step.click().catch(() => {});
      },
      settle: 1200,
    },
    {
      name: 'resources',
      async run(page) {
        await openFromToolbar(page, 'Open resources', '.modal-overlay, [role="dialog"], .functions-drawer, .resources-drawer');
      },
      settle: 900,
    },
    {
      name: 'assistant',
      async run(page) {
        await ensureSignedIn(page);
        await closeOverlays(page);
        await closeOverlays(page);
        const b = page.getByRole('button', { name: 'Authoring assistant' }).first();
        if (await b.isVisible().catch(() => false)) await b.dispatchEvent('click');
        else await page.getByRole('button', { name: 'Open authoring assistant' }).first().dispatchEvent('click');
      },
      settle: 1200,
    },
    {
      name: 'settings',
      async run(page) {
        await closeDrawers(page);
        await closeOverlays(page);
        await page.getByRole('button', { name: /Appearance/ }).first().dispatchEvent('click');
        await page.waitForTimeout(300);
      },
    },
  ],
  sweepScreen: 'editor',
};
