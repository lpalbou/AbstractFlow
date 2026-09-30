import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { ListDisclosure } from '../components/ListDisclosure';
import { LIBRARY_STACKED_QUERY, LIST_OPEN_KEYS, readListOpen, writeListOpen } from '../utils/listOpen';

// Space on phones and tablets (DESIGN §12). Each test goes red when its part
// of the fix is removed: the disclosure's semantics, the remembered state, the
// wiring on the two list + detail screens, the one-scroll / flat / full-width
// CSS, and the dialogs leaving the page <header>.

const ROOT = resolve(__dirname, '..', '..');
const read = (...p: string[]) => readFileSync(resolve(ROOT, ...p), 'utf-8');
const CSS = read('src', 'styles', 'space.css').replace(/\/\*[\s\S]*?\*\//g, '');

/** Concatenated bodies of every @media block whose prelude is exactly `query`. */
function mediaBody(css: string, query: string): string {
  const out: string[] = [];
  let from = 0;
  for (;;) {
    const at = css.indexOf('@media', from);
    if (at < 0) break;
    const open = css.indexOf('{', at);
    const prelude = css.slice(at + '@media'.length, open).trim();
    let depth = 1;
    let i = open + 1;
    while (depth > 0 && i < css.length) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}') depth--;
      i++;
    }
    if (prelude === query) out.push(css.slice(open + 1, i - 1));
    from = i;
  }
  return out.join('\n');
}

/** Declarations of every rule in `body` whose selector list contains `selector`. */
function declsFor(body: string, selector: string): string {
  const out: string[] = [];
  for (const m of body.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = m[1].split(',').map((s) => s.trim());
    if (selectors.includes(selector)) out.push(m[2]);
  }
  return out.join(';');
}

function expectRule(query: string | null, selector: string, decl: RegExp) {
  const body = query ? mediaBody(CSS, query) : CSS.replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');
  expect(body, `no @media block "${query}"`).not.toBe('');
  expect(declsFor(body, selector), `${selector} under ${query || 'top level'}`).toMatch(decl);
}

const PHONE = '(max-width: 767.98px)';
const RUN_STACKED = '(max-width: 1023.98px)';
const LIBRARY_STACKED = LIBRARY_STACKED_QUERY;

/** A Storage stand-in (Map-backed). */
function memoryStorage(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init));
  return { getItem: (k: string) => (m.has(k) ? m.get(k)! : null), setItem: (k: string, v: string) => void m.set(k, v), map: m };
}
const throwingStorage = {
  getItem: () => {
    throw new Error('SecurityError');
  },
  setItem: () => {
    throw new Error('QuotaExceededError');
  },
};

describe('collapsible list state (remembered per viewer)', () => {
  it('is open by default: nothing stored, no storage, or storage that throws', () => {
    expect(readListOpen('library', memoryStorage())).toBe(true);
    expect(readListOpen('library', null)).toBe(true);
    expect(readListOpen('runSteps', throwingStorage)).toBe(true);
  });

  it('remembers a closed list per list and reopens it', () => {
    const s = memoryStorage();
    writeListOpen('library', false, s);
    expect(s.map.get(LIST_OPEN_KEYS.library)).toBe('0');
    expect(readListOpen('library', s)).toBe(false);
    expect(readListOpen('runSteps', s)).toBe(true);
    writeListOpen('library', true, s);
    expect(readListOpen('library', s)).toBe(true);
  });

  it('a storage that throws on write does not throw', () => {
    expect(() => writeListOpen('runSteps', false, throwingStorage)).not.toThrow();
  });

  it('keys are AbstractFlow-owned (one origin under the gateway)', () => {
    for (const key of Object.values(LIST_OPEN_KEYS)) expect(key).toMatch(/^abstractflow_list_open_/);
  });
});

describe('ListDisclosure (the list header)', () => {
  it('is a button with aria-expanded, aria-controls and a chevron, open and closed', () => {
    const open = renderToStaticMarkup(
      React.createElement(ListDisclosure, { open: true, onToggle: () => {}, controls: 'x-list', title: 'Flows', detail: 19 }),
    );
    expect(open).toMatch(/^<button type="button"/);
    expect(open).toContain('aria-expanded="true"');
    expect(open).toContain('aria-controls="x-list"');
    expect(open).toContain('<svg');
    expect(open).toContain('>Flows<');
    expect(open).toContain('>19<');
    const closed = renderToStaticMarkup(
      React.createElement(ListDisclosure, { open: false, onToggle: () => {}, controls: 'x-list', title: 'Flows' }),
    );
    expect(closed).toContain('aria-expanded="false"');
    expect(closed).toContain('title="Show flows"');
  });

  it('a collapsed list is not displayed (hidden beats the lists\' own display: flex)', () => {
    expectRule(null, '.run-steps-list[hidden]', /display:\s*none/);
    expectRule(null, '.flow-library-list[hidden]', /display:\s*none/);
  });

  it('is 44 px tall (a touch target) wherever it is rendered', () => {
    expectRule(null, '.list-disclosure', /min-height:\s*44px/);
  });
});

describe('wiring on the list + detail screens', () => {
  it('flow library: the list header is a disclosure when stacked, the list hides when closed', () => {
    const src = read('src', 'components', 'FlowLibraryModal.tsx');
    expect(src).toMatch(/useAfMedia\(LIBRARY_STACKED_QUERY\)/);
    expect(src).toMatch(/useListOpen\('library'\)/);
    expect(src).toMatch(/<ListDisclosure[\s\S]{0,200}controls="flow-library-list"/);
    expect(src).toMatch(/className="flow-library-list" id="flow-library-list"[^>]*hidden=\{stacked && !listOpen\}/);
    // Enter on the disclosure toggles it; the window-level Enter (load the
    // selected flow) steps aside for it.
    expect(src).toMatch(/target\.closest\('\.list-disclosure'\)\) return;/);
  });

  it('run window: the Execution header is a disclosure when stacked, the steps hide when closed', () => {
    const src = read('src', 'components', 'RunFlowModal.tsx');
    expect(src).toMatch(/useAfMedia\(AF_MEDIA\.md\)/);
    expect(src).toMatch(/useListOpen\('runSteps'\)/);
    expect(src).toMatch(/<ListDisclosure[\s\S]{0,200}controls="run-steps-list"/);
    expect(src).toMatch(/className="run-steps-list" id="run-steps-list"[^>]*hidden=\{stepsHidden\}/);
  });

  it('the CSS stacks the library under the same query the component listens to', () => {
    expect(mediaBody(CSS, LIBRARY_STACKED)).not.toBe('');
  });
});

describe('one scroll and flat sections when stacked', () => {
  it('flow library: list and preview stack and grow the sheet (no inner scroll box, no card)', () => {
    expectRule(LIBRARY_STACKED, '.flow-library-body', /flex-direction:\s*column/);
    expectRule(LIBRARY_STACKED, '.flow-library-list', /overflow:\s*visible/);
    expectRule(LIBRARY_STACKED, '.flow-library-preview', /overflow:\s*visible/);
    expectRule(LIBRARY_STACKED, '.flow-library-list', /border:\s*0/);
    expectRule(LIBRARY_STACKED, '.flow-library-modal', /overflow-y:\s*auto/);
  });

  it('flow library: the tree chevron moves to the row end so names start at the gutter', () => {
    expectRule(LIBRARY_STACKED, '.flow-library-tree .af-disclosure__chevron', /order:\s*2/);
    expectRule(LIBRARY_STACKED, '.flow-library-tree .af-disclosure__chevron--spacer', /display:\s*none/);
  });

  it('run window: steps above details, the body is the one scroller, sections flat', () => {
    expectRule(RUN_STACKED, '.run-modal-execution', /flex-direction:\s*column/);
    expectRule(RUN_STACKED, '.run-steps-list', /overflow:\s*visible/);
    expectRule(RUN_STACKED, '.run-details-body', /overflow:\s*visible/);
    expectRule(RUN_STACKED, '.run-steps', /border:\s*0/);
    expectRule(RUN_STACKED, '.run-modal-body .run-details-output', /max-height:\s*none/);
    expectRule(RUN_STACKED, '.run-modal-body .run-param-markdown', /max-height:\s*none/);
  });
});

describe('phones use the full width', () => {
  it('run window: 12 px gutter, label/value rows that wrap, code without a box', () => {
    expectRule(PHONE, '.run-modal-body', /padding:\s*8px max\(12px/);
    expectRule(PHONE, '.run-param-row', /flex-wrap:\s*wrap/);
    expectRule(PHONE, '.run-modal-body .run-details-output', /border:\s*0/);
    expectRule(PHONE, '.run-modal-body .run-details-output', /overflow-wrap:\s*anywhere/);
  });

  it('right drawer: the rail is a tab row on top, the canvas and the open panel get the full width', () => {
    expectRule(PHONE, '.app-main', /flex-direction:\s*column/);
    expectRule(PHONE, '.properties-drawer.collapsed', /order:\s*-1/);
    expectRule(PHONE, '.properties-drawer.open', /flex-direction:\s*column-reverse/);
    expectRule(PHONE, '.properties-drawer .right-drawer-rail', /flex-direction:\s*row/);
    expectRule(PHONE, '.properties-drawer .right-drawer-rail-action', /writing-mode:\s*horizontal-tb/);
    expectRule(PHONE, '.properties-drawer .right-drawer-rail-action', /min-height:\s*44px/);
  });

  it('assistant transcript: flat assistant turns at 14 px', () => {
    expectRule(PHONE, '.assistant-message.assistant', /border:\s*0/);
    expectRule(PHONE, '.assistant-message.assistant', /padding:\s*0/);
    expectRule(PHONE, '.assistant-markdown', /font-size:\s*var\(--font-size-body, 14px\)/);
  });
});

describe('touch screens: body text 14–17 px (§12.1)', () => {
  const TOUCH = '(pointer: coarse)';
  it('the type scale moves up on a coarse pointer (helper 13 px, body 14–15 px)', () => {
    expectRule(TOUCH, ':root', /--font-size-xs:\s*calc\(13px \* var\(--font-scale\)\)/);
    expectRule(TOUCH, ':root', /--font-size-sm:\s*calc\(14px \* var\(--font-scale\)\)/);
    expectRule(TOUCH, ':root', /--font-size-md:\s*calc\(14px \* var\(--font-scale\)\)/);
    expectRule(TOUCH, ':root', /--font-size-base:\s*calc\(15px \* var\(--font-scale\)\)/);
  });

  it('desktop floors: dense text 12 px, helper text 13 px', () => {
    expectRule(null, ':root', /--font-size-xxs:\s*calc\(12px \* var\(--font-scale\)\)/);
    expectRule(null, ':root', /--font-size-xs:\s*calc\(12px \* var\(--font-scale\)\)/);
    expectRule(null, ':root', /--font-size-sm:\s*calc\(13px \* var\(--font-scale\)\)/);
  });

  it('canvas node text keeps the node design sizes at every width (documented exception)', () => {
    expectRule(null, '.react-flow', /--font-size-xs:\s*calc\(11px \* var\(--font-scale\)\)/);
    expectRule(null, '.react-flow', /--font-size-xxs:\s*calc\(10px \* var\(--font-scale\)\)/);
  });

  it('run history: row metadata at body size, the list grows the sheet on phones', () => {
    expectRule(TOUCH, '.run-history-row.subtle', /font-size:\s*var\(--font-size-sm\)/);
    expectRule(PHONE, '.run-history-list', /max-height:\s*none/);
    expectRule(PHONE, '.run-history-list', /overflow:\s*visible/);
  });
});

describe('dialogs live outside the page header', () => {
  it('the toolbar portals its dialogs to <body>', () => {
    const src = read('src', 'components', 'Toolbar.tsx');
    const portal = src.indexOf('createPortal(');
    expect(portal).toBeGreaterThan(0);
    const body = src.slice(portal, src.indexOf('document.body', portal));
    for (const dialog of ['<RunFlowModal', '<RunHistoryModal', '<FlowLibraryModal', '<PublishFlowModal', '<WorkflowLifecycleModal', '<ModelResidencyPanel']) {
      expect(body, `${dialog} inside the portal`).toContain(dialog);
    }
  });
});
