import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

// Design-token integrity guard (backlog 0114).
//
// Root cause class this pins: `var(--x)` with no fallback silently collapses
// (color-mix -> transparent, colors -> currentColor) when --x is defined
// nowhere, which is how ~20 hover/warning states shipped broken. The guard
// resolves every no-fallback var() reference in the app stylesheets against
// tokens defined in (a) the app stylesheets, (b) the ui-kit theme, or
// (c) TS/TSX sources that set custom properties dynamically.
//
// Note: vitest resolves `?raw` CSS imports to an empty string in this setup,
// so the guard reads the stylesheets from disk instead.

const APP_ROOT = resolve(__dirname, '..', '..');
const STYLE_DIR = join(APP_ROOT, 'src', 'styles');
const UI_KIT_THEME = resolve(APP_ROOT, '..', 'abstractuic', 'ui-kit', 'src', 'theme.css');

function readAppCss(): string[] {
  return readdirSync(STYLE_DIR)
    .filter((f) => f.endsWith('.css'))
    .map((f) => readFileSync(join(STYLE_DIR, f), 'utf-8'));
}

function collectDefinitions(css: string): Set<string> {
  const defs = new Set<string>();
  for (const match of css.matchAll(/--([\w-]+)\s*:/g)) {
    defs.add(`--${match[1]}`);
  }
  return defs;
}

function collectTsxDefinedTokens(): Set<string> {
  // Custom properties written from TS/TSX: setProperty('--x', ...) or style
  // object keys ('--x': value). Bare reads (getPropertyValue) must not mask
  // a missing definition.
  const defs = new Set<string>();
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(path);
      } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
        const text = readFileSync(path, 'utf-8');
        for (const match of text.matchAll(/setProperty\(\s*['"`](--[\w-]+)['"`]/g)) {
          defs.add(match[1]);
        }
        for (const match of text.matchAll(/['"`](--[\w-]+)['"`]\s*:/g)) {
          defs.add(match[1]);
        }
      }
    }
  };
  walk(join(APP_ROOT, 'src'));
  return defs;
}

function collectNoFallbackReferences(css: string): Set<string> {
  const refs = new Set<string>();
  for (const match of css.matchAll(/var\(\s*(--[\w-]+)\s*\)/g)) {
    refs.add(match[1]);
  }
  return refs;
}

describe('css token integrity (backlog 0114)', () => {
  it('defines the app-layer bridge tokens that app styles depend on', () => {
    const indexCss = readFileSync(join(STYLE_DIR, 'index.css'), 'utf-8');
    for (const token of ['--accent-primary', '--accent-secondary', '--border-color', '--focus-ring']) {
      expect(indexCss, `${token} must be defined in index.css`).toMatch(
        new RegExp(`${token}\\s*:`)
      );
    }
  });

  it('resolves every no-fallback var() reference in app styles to a defined token', () => {
    const appCss = readAppCss();
    const defined = new Set<string>();
    for (const css of appCss) {
      for (const token of collectDefinitions(css)) defined.add(token);
    }
    for (const token of collectDefinitions(readFileSync(UI_KIT_THEME, 'utf-8'))) {
      defined.add(token);
    }
    for (const token of collectTsxDefinedTokens()) defined.add(token);

    const missing = new Set<string>();
    for (const css of appCss) {
      for (const ref of collectNoFallbackReferences(css)) {
        if (!defined.has(ref)) missing.add(ref);
      }
    }

    expect(
      [...missing].sort(),
      'var() references with no fallback and no definition anywhere (app css, ui-kit theme, ts/tsx)'
    ).toEqual([]);
  });
});
