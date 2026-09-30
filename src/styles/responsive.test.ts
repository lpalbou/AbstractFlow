import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Guard for the responsive layer (DESIGN.md, feat/responsive). Emptying or
// gutting src/styles/responsive.css, or dropping its import, turns these red.
// vitest resolves `?raw` CSS to '' in this setup, so the files are read from disk.

const ROOT = resolve(__dirname, '..', '..');
const CSS = readFileSync(resolve(ROOT, 'src', 'styles', 'responsive.css'), 'utf-8').replace(/\/\*[\s\S]*?\*\//g, '');

/** Concatenated bodies of every @media block whose prelude contains `query`. */
function mediaBody(css: string, query: string): string {
  const out: string[] = [];
  let from = 0;
  for (;;) {
    const at = css.indexOf('@media', from);
    if (at < 0) break;
    const open = css.indexOf('{', at);
    const prelude = css.slice(at, open);
    let depth = 1;
    let i = open + 1;
    while (depth > 0 && i < css.length) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}') depth--;
      i++;
    }
    if (prelude.includes(query)) out.push(css.slice(open + 1, i - 1));
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

function expectRule(query: string, selector: string, decl: RegExp) {
  const body = query ? mediaBody(CSS, query) : CSS;
  expect(body, `no @media block containing "${query}"`).not.toBe('');
  expect(declsFor(body, selector), `${selector} under ${query || 'top level'}`).toMatch(decl);
}

describe('responsive.css (layout guard)', () => {
  it('is imported after the desktop styles by the app entry (only space.css comes later)', () => {
    const main = readFileSync(resolve(ROOT, 'src', 'main.tsx'), 'utf-8');
    const imports = [...main.matchAll(/^import '\.\/styles\/([\w-]+)\.css';/gm)].map((m) => m[1]);
    expect(imports.slice(-2)).toEqual(['responsive', 'space']);
  });

  it('below 1024 px the palette and the right drawer float over the canvas as drawers', () => {
    const md = '(max-width: 1023.98px)';
    expectRule(md, '.sidebar.left', /position:\s*absolute/);
    expectRule(md, '.sidebar.left', /display:\s*none/);
    expectRule(md, '.sidebar.left.open', /display:\s*block/);
    expectRule(md, '.properties-drawer.open', /position:\s*absolute/);
    expectRule(md, '.overlay-scrim', /display:\s*block/);
    expectRule(md, '.palette-toggle', /display:\s*inline-flex/);
    expectRule(md, '.canvas-container', /isolation:\s*isolate/);
  });

  it('keeps the canvas full-bleed and the chrome out of the document width', () => {
    expectRule('', '.app-container', /height:\s*var\(--vh-full/);
    expectRule('(max-width: 1439.98px)', '.toolbar-actions', /overflow-x:\s*auto/);
    expectRule('(max-width: 1439.98px)', '.toolbar', /overflow:\s*hidden/);
    // the toolbar clip belongs to the narrow query only
    expect(declsFor(CSS.replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, ''), '.toolbar')).toBe('');
  });

  it('below 768 px (or 500 px tall) dialogs are bottom sheets above the keyboard', () => {
    const sheet = '(max-width: 767.98px), (max-height: 500px)';
    expectRule(sheet, '.modal-overlay', /align-items:\s*flex-end/);
    expectRule(sheet, '.modal-overlay', /var\(--keyboard-inset/);
    expectRule(sheet, '.modal', /width:\s*100%/);
    expectRule(sheet, '.modal', /var\(--vv-height/);
    expectRule(sheet, '.modal-actions', /position:\s*sticky/);
    expectRule(sheet, '.flow-library-body', /grid-template-columns:\s*minmax\(0,\s*1fr\)/);
    expectRule('(max-width: 767.98px)', '.app-header', /grid-template-areas/);
    expectRule('(max-width: 767.98px)', '.run-modal-execution', /grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  });

  it('the assistant composer stays above the on-screen keyboard', () => {
    expectRule('(max-width: 1023.98px)', '.properties-drawer.open', /bottom:\s*var\(--keyboard-inset/);
    expectRule('(max-width: 1023.98px)', '.authoring-assistant .assistant-input-area', /position:\s*sticky/);
  });

  it('touch: 44 px targets and 16 px inputs', () => {
    const touch = '(pointer: coarse)';
    expectRule(touch, '.toolbar-button', /min-height:\s*44px/);
    expectRule(touch, '.react-flow__controls-button', /width:\s*44px/);
    expectRule(touch, '.palette-node', /min-height:\s*44px/);
    expectRule(touch, '.modal-button', /min-height:\s*44px/);
    expectRule(touch, '.flow-name-input', /font-size:\s*max\(16px/);
    expectRule(touch, '.authoring-assistant select', /font-size:\s*max\(16px/);
    expectRule(touch, '.properties-panel .property-hint', /font-size:\s*var\(--font-size-body/);
  });

  it('uses only the shared breakpoints', () => {
    const widths = [...CSS.matchAll(/\((?:max|min)-width:\s*([\d.]+)px\)/g)].map((m) => m[1]);
    expect(widths.length).toBeGreaterThan(5);
    for (const w of widths) expect(['479.98', '767.98', '1023.98', '1439.98', '768', '1024', '1440']).toContain(w);
  });
});
