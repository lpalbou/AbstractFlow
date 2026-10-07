// R14-W8 node category colours: every category is mapped, every node resolves
// to its home category's hue (Essentials included), the hues live ONLY in
// styles/categories.css (light + dark steps, the kit's light-theme group), and
// no hex literal is used for category colour anywhere else.
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { NODE_CATEGORIES } from '../types/nodes';
import { buildPaletteSections, ESSENTIALS_KEY, PALETTE_SECTION_DEFS } from './paletteModel';
import {
  CATEGORY_COLOR_SECTION,
  COLOR_SECTIONS,
  OTHER_COLOR_SECTION,
  categoryColorToken,
  categoryColorVar,
  colorSectionForCategory,
  nodeColorSection,
} from './nodeCategoryColors';

const APP = resolve(__dirname, '..', '..');
const SRC = join(APP, 'src');
const STYLES = join(SRC, 'styles');
const TOKEN_FILE = join(STYLES, 'categories.css');
const tokenCss = readFileSync(TOKEN_FILE, 'utf8');
const HEX = /#[0-9a-fA-F]{3,8}\b/;

/** Declarations of the first rule whose selector list is exactly `selectors`. */
function ruleBody(css: string, selectors: string[]): string {
  const want = selectors.join(',');
  for (const m of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    if (m[1].split(',').map((s) => s.trim()).join(',') === want) return m[2];
  }
  throw new Error(`no rule for ${want}`);
}

function decls(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}

const KIT_THEME = readFileSync(join(APP, 'node_modules/@abstractframework/ui-kit/src/theme.css'), 'utf8');
/** The kit's light-theme group: the selector list of the block that sets color-scheme: light + the entity light steps. */
function kitLightGroup(): string[] {
  for (const m of KIT_THEME.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    if (/color-scheme:\s*light/.test(m[2]) && /--entity-identity/.test(m[2])) return m[1].split(',').map((s) => s.trim());
  }
  throw new Error('kit light group not found');
}

const LIGHT = kitLightGroup();
const darkHues = decls(ruleBody(tokenCss, [':root']));
const lightHues = decls(ruleBody(tokenCss, LIGHT));
const cardHues = decls(ruleBody(tokenCss, ['.flow-node', '.exec-view-node']));
const mapping = decls(ruleBody(tokenCss, [':root', '.flow-node', '.exec-view-node']));

describe('category → section mapping', () => {
  it('every semantic category is mapped to a palette section (none falls to "other")', () => {
    for (const key of Object.keys(NODE_CATEGORIES)) {
      expect(CATEGORY_COLOR_SECTION[key], key).toBeTruthy();
      expect(colorSectionForCategory(key), key).not.toBe(OTHER_COLOR_SECTION);
    }
  });

  it('every palette section is a colour section, and an unknown category is neutral', () => {
    for (const def of PALETTE_SECTION_DEFS) expect(COLOR_SECTIONS).toContain(def.key);
    expect(colorSectionForCategory('nope')).toBe(OTHER_COLOR_SECTION);
    expect(colorSectionForCategory(undefined)).toBe(OTHER_COLOR_SECTION);
    expect(categoryColorVar('nope')).toBe('var(--flow-cat-other)');
  });

  it('every node template resolves (type + label) to the hue of its own category', () => {
    let n = 0;
    for (const [key, category] of Object.entries(NODE_CATEGORIES)) {
      for (const t of category.nodes) {
        expect(nodeColorSection(t.type, t.label), `${t.type}|${t.label}`).toBe(CATEGORY_COLOR_SECTION[key]);
        n += 1;
      }
    }
    expect(n).toBeGreaterThan(150);
  });

  it('Essentials rows keep the colour of their home section (On Flow Start = Events and time, Agent = Core, If = Control flow)', () => {
    const ess = buildPaletteSections().find((s) => s.key === ESSENTIALS_KEY)!;
    for (const t of ess.nodes) expect(colorSectionForCategory(t.category), t.type).toBe(CATEGORY_COLOR_SECTION[t.category]);
    expect(nodeColorSection('on_flow_start')).toBe('events');
    expect(nodeColorSection('agent')).toBe('core');
    expect(nodeColorSection('if')).toBe('control');
  });

  it('the artifact literals (shared literal_json type) wear the Files colour by their label', () => {
    expect(nodeColorSection('literal_json', 'Image Artifact')).toBe('files');
    expect(nodeColorSection('literal_json', 'JSON')).toBe('values');
  });
});

describe('the token file (styles/categories.css)', () => {
  it('defines --flow-cat-<section> for every colour section on :root and the dark card surfaces', () => {
    for (const section of COLOR_SECTIONS) {
      expect(mapping[categoryColorToken(section)], section).toBeTruthy();
    }
  });

  it('every category maps to a --flow-hue-* that has a dark, a light and a card step', () => {
    for (const section of COLOR_SECTIONS.filter((s) => s !== OTHER_COLOR_SECTION)) {
      const m = /^var\((--flow-hue-[\w-]+)\)$/.exec(mapping[categoryColorToken(section)]);
      expect(m, section).toBeTruthy();
      const hue = m![1];
      for (const [name, set] of [['dark', darkHues], ['light', lightHues], ['card', cardHues]] as const) {
        expect(set[hue], `${section} ${hue} ${name}`).toMatch(/^#[0-9a-f]{6}$/i);
      }
      // Canvas cards are dark in every theme: they take the dark steps.
      expect(cardHues[hue], hue).toBe(darkHues[hue]);
    }
    expect(mapping['--flow-cat-other']).toBe('var(--text-muted)');
  });

  it('at most 8 hues (the categorical cap), no red (the theme\'s "failed" colour), light ≠ dark steps chosen per mode', () => {
    const hues = Object.keys(darkHues).filter((k) => k.startsWith('--flow-hue-'));
    expect(hues.length).toBeLessThanOrEqual(8);
    expect(hues.some((h) => /red/.test(h))).toBe(false);
    expect(Object.keys(lightHues).sort()).toEqual(hues.sort());
  });

  it('the light steps apply to exactly the kit theme.css light group', () => {
    expect(LIGHT.length).toBeGreaterThan(1);
    expect(() => ruleBody(tokenCss, LIGHT)).not.toThrow();
  });

  it('the related sections share one family and the documented assignment holds', () => {
    const hueOf = (s: string) => mapping[categoryColorToken(s)];
    expect(hueOf('variables')).toBe(hueOf('values'));
    expect(hueOf('data')).toBe(hueOf('math'));
    expect(hueOf('files')).toBe(hueOf('media'));
    expect(hueOf('memory')).toBe(hueOf('entity'));
    const distinct = new Set(['core', 'control', 'events', 'variables', 'data', 'files', 'memory'].map(hueOf));
    expect(distinct.size).toBe(7);
  });
});

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(css|ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

describe('no category colour outside the token file', () => {
  const files = walk(SRC);

  it('--flow-hue-* / --flow-cat-* are defined nowhere else', () => {
    for (const f of files.filter((x) => x !== TOKEN_FILE)) {
      const text = readFileSync(f, 'utf8');
      expect(text, f).not.toMatch(/--flow-(hue|cat)-[\w-]+\s*:/);
    }
  });

  it('no stylesheet declaration that paints a category colour carries a literal colour', () => {
    const CAT_VAR = /var\(--(cat|flow-cat-[\w-]+|node-accent|exec-header-color|node-status-color)\b/;
    for (const f of readdirSync(STYLES).filter((x) => x.endsWith('.css')).map((x) => join(STYLES, x))) {
      if (f === TOKEN_FILE) continue;
      const css = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
      for (const m of css.matchAll(/([\w-]+)\s*:\s*([^;{}]+);/g)) {
        if (!CAT_VAR.test(m[2])) continue;
        expect(`${f}: ${m[1]}: ${m[2]}`).not.toMatch(HEX);
        expect(`${f}: ${m[1]}: ${m[2]}`).not.toMatch(/\b(white|black)\b/);
      }
    }
  });

  it('the TS/TSX that paint category colour name tokens only (no hex)', () => {
    for (const rel of [
      'utils/nodeCategoryColors.ts',
      'components/NodePalette.tsx',
      'components/nodes/NodeStatusGlyph.tsx',
      'components/nodes/ExecViewNode.tsx',
    ]) {
      expect(readFileSync(join(SRC, rel), 'utf8'), rel).not.toMatch(HEX);
    }
    const base = readFileSync(join(SRC, 'components/nodes/BaseNode.tsx'), 'utf8');
    expect(base).toMatch(/'--node-accent' as any\]: categoryColorVar\(colorSection\)/);
    expect(base).not.toMatch(/'--node-accent' as any\]: data\.headerColor/);
  });
});
