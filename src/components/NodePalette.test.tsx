// R13.3 node palette: one column, full names, kit icons, collapsible sections
// with counts (Essentials open), search across sections with highlight,
// one-line tooltips, keyboard navigation, resizable width.
//
// No DOM in this package's tests: the model is tested directly and the
// component renders with react-dom/server.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';

import { NODE_CATEGORIES } from '../types/nodes';
import {
  buildPaletteSections,
  clampPaletteWidth,
  DEFAULT_EXPANSION,
  ESSENTIALS_KEY,
  EXPANSION_STORAGE_KEY,
  filterPaletteSections,
  highlightSegments,
  isSectionExpanded,
  loadExpansion,
  loadPaletteWidth,
  oneLineDescription,
  PALETTE_MAX_WIDTH,
  PALETTE_MIN_WIDTH,
  paletteKeyAction,
  saveExpansion,
  savePaletteWidth,
  type PaletteKeyItem,
} from '../utils/paletteModel';
import { NODE_ICON_BY_TYPE, NODE_ICON_BY_TYPE_AND_LABEL, nodeIconName } from '../utils/nodeIcons';
import { NodePalette } from './NodePalette';

function memoryStore(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: (k: string) => (k in data ? data[k] : null),
    setItem: (k: string, v: string) => {
      data[k] = v;
    },
  };
}

function renderPalette(): string {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } });
  return renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(NodePalette)));
}

const paletteNodes = Object.values(NODE_CATEGORIES).flatMap((c) => c.nodes.filter((n) => !n.hiddenInPalette));

describe('palette sections', () => {
  it('starts with Essentials, then every semantic category exactly once', () => {
    const sections = buildPaletteSections();
    expect(sections[0].key).toBe(ESSENTIALS_KEY);
    expect(sections[0].nodes.map((n) => n.type)).toEqual([
      'on_flow_start', 'on_flow_end', 'agent', 'llm_call', 'code', 'if', 'for', 'string_template',
    ]);
    const listed = sections.slice(1).flatMap((s) => s.nodes);
    expect(listed.length).toBe(paletteNodes.length);
    for (const n of paletteNodes) expect(listed).toContain(n);
  });

  it('Essentials is open by default, every other section closed', () => {
    const sections = buildPaletteSections();
    const expansion = loadExpansion(memoryStore());
    expect(expansion).toEqual(DEFAULT_EXPANSION);
    expect(isSectionExpanded(ESSENTIALS_KEY, expansion, '')).toBe(true);
    for (const s of sections.slice(1)) expect(isSectionExpanded(s.key, expansion, '')).toBe(false);
  });

  it('remembers the expansion per browser (and survives junk in storage)', () => {
    const store = memoryStore();
    saveExpansion({ essentials: false, media: true }, store);
    expect(JSON.parse(store.data[EXPANSION_STORAGE_KEY])).toEqual({ essentials: false, media: true });
    const loaded = loadExpansion(store);
    expect(isSectionExpanded('essentials', loaded, '')).toBe(false);
    expect(isSectionExpanded('media', loaded, '')).toBe(true);
    expect(loadExpansion(memoryStore({ [EXPANSION_STORAGE_KEY]: '{oops' }))).toEqual(DEFAULT_EXPANSION);
    expect(loadExpansion(memoryStore({ [EXPANSION_STORAGE_KEY]: '[1]' }))).toEqual(DEFAULT_EXPANSION);
  });
});

describe('palette search', () => {
  it('filters across every section, drops empty sections and Essentials, and opens the matches', () => {
    const sections = buildPaletteSections();
    const hits = filterPaletteSections(sections, 'memory');
    expect(hits.length).toBeGreaterThanOrEqual(2);
    expect(hits.map((s) => s.key)).not.toContain(ESSENTIALS_KEY);
    expect(hits.map((s) => s.key)).toEqual(expect.arrayContaining(['memory', 'entity']));
    for (const s of hits) {
      expect(s.nodes.length).toBeGreaterThan(0);
      expect(isSectionExpanded(s.key, {}, 'memory')).toBe(true);
    }
    // Essentials nodes match too, but are listed once, under their own section.
    const agentHits = filterPaletteSections(sections, 'agent');
    expect(agentHits.map((s) => s.key)).not.toContain(ESSENTIALS_KEY);
    expect(agentHits.flatMap((s) => s.nodes).filter((n) => n.type === 'agent').length).toBe(1);
    // A section closed by the viewer still opens while it matches.
    expect(isSectionExpanded('memory', { memory: false }, 'memory')).toBe(true);
  });

  it('matches label, type and description, case-insensitively, trimmed', () => {
    const sections = buildPaletteSections();
    const byLabel = filterPaletteSections(sections, '  IF/else ').flatMap((s) => s.nodes.map((n) => n.type));
    expect(byLabel).toContain('if');
    const byType = filterPaletteSections(sections, 'llm_call').flatMap((s) => s.nodes.map((n) => n.type));
    expect(byType).toContain('llm_call');
    expect(filterPaletteSections(sections, 'zzzz-no-such-node')).toEqual([]);
    expect(filterPaletteSections(sections, '   ')).toBe(sections);
  });

  it('highlights every occurrence of the term in the label', () => {
    expect(highlightSegments('Memory Recall', 'memory')).toEqual([
      { text: 'Memory', match: true },
      { text: ' Recall', match: false },
    ]);
    expect(highlightSegments('Array Append', 'a')).toEqual([
      { text: 'A', match: true }, { text: 'rr', match: false }, { text: 'a', match: true },
      { text: 'y ', match: false }, { text: 'A', match: true }, { text: 'ppend', match: false },
    ]);
    expect(highlightSegments('Agent', '')).toEqual([{ text: 'Agent', match: false }]);
  });

  it('tooltips carry a one-line description (first sentence)', () => {
    expect(oneLineDescription('Entry point for a workflow run. Emits exec-out.')).toBe('Entry point for a workflow run.');
    expect(oneLineDescription('Uses metadata (e.g. kind). Second.')).toBe('Uses metadata (e.g. kind).');
    expect(oneLineDescription('No period at all')).toBe('No period at all');
  });
});

describe('palette keyboard', () => {
  const items: PaletteKeyItem[] = [
    { kind: 'header', section: 'essentials' },
    { kind: 'node', section: 'essentials', nodeType: 'agent', nodeLabel: 'Agent' },
    { kind: 'node', section: 'essentials', nodeType: 'code', nodeLabel: 'Code', disabled: true },
    { kind: 'header', section: 'core' },
  ];

  it('arrows, Home and End move the focus; ArrowUp on the first row returns to search', () => {
    expect(paletteKeyAction('ArrowDown', items, 0, false)).toEqual({ kind: 'focus', index: 1 });
    expect(paletteKeyAction('ArrowDown', items, 3, false)).toEqual({ kind: 'focus', index: 3 });
    expect(paletteKeyAction('ArrowUp', items, 2, false)).toEqual({ kind: 'focus', index: 1 });
    expect(paletteKeyAction('ArrowUp', items, 0, false)).toEqual({ kind: 'focusSearch' });
    expect(paletteKeyAction('Home', items, 2, false)).toEqual({ kind: 'focus', index: 0 });
    expect(paletteKeyAction('End', items, 0, false)).toEqual({ kind: 'focus', index: 3 });
  });

  it('Enter adds the focused node at the canvas centre; never a disabled one', () => {
    expect(paletteKeyAction('Enter', items, 1, false)).toEqual({ kind: 'add', nodeType: 'agent', nodeLabel: 'Agent' });
    expect(paletteKeyAction('Enter', items, 2, false)).toEqual({ kind: 'none' });
  });

  it('Enter / Right / Left open and close a section; Left on a node jumps to its header', () => {
    expect(paletteKeyAction('Enter', items, 3, false)).toEqual({ kind: 'toggle', section: 'core' });
    expect(paletteKeyAction('Enter', items, 3, true)).toEqual({ kind: 'none' });
    expect(paletteKeyAction('ArrowRight', items, 3, false)).toEqual({ kind: 'toggle', section: 'core', open: true });
    expect(paletteKeyAction('ArrowLeft', items, 0, false)).toEqual({ kind: 'toggle', section: 'essentials', open: false });
    expect(paletteKeyAction('ArrowLeft', items, 2, false)).toEqual({ kind: 'focus', index: 0 });
    expect(paletteKeyAction('x', items, 1, false)).toEqual({ kind: 'none' });
  });

  it('the component dispatches Enter through requestPaletteAdd (the canvas centre path)', () => {
    const src = readFileSync(resolve(__dirname, 'NodePalette.tsx'), 'utf8');
    expect(src).toMatch(/action\.kind === 'add'[\s\S]{0,300}requestPaletteAdd\(template\)/);
  });
});

describe('palette width', () => {
  it('clamps to a minimum that keeps full names and a maximum, and remembers it', () => {
    expect(clampPaletteWidth(10)).toBe(PALETTE_MIN_WIDTH);
    expect(clampPaletteWidth(10_000)).toBe(PALETTE_MAX_WIDTH);
    expect(clampPaletteWidth(Number.NaN)).toBeGreaterThanOrEqual(PALETTE_MIN_WIDTH);
    const store = memoryStore();
    savePaletteWidth(333, store);
    expect(loadPaletteWidth(store)).toBe(333);
    expect(PALETTE_MIN_WIDTH).toBeGreaterThanOrEqual(240);
  });
});

describe('node icons', () => {
  it('every palette node type has an explicit kit icon (no category fallback)', () => {
    const missing = paletteNodes.filter((n) => !NODE_ICON_BY_TYPE[n.type]).map((n) => n.type);
    expect(missing).toEqual([]);
  });

  it('the literal_json family reads by label', () => {
    expect(nodeIconName('literal_json', 'Video Artifact')).toBe(NODE_ICON_BY_TYPE_AND_LABEL['literal_json|Video Artifact']);
    expect(nodeIconName('literal_json', 'Renamed by me')).toBe(NODE_ICON_BY_TYPE.literal_json);
    expect(nodeIconName('brand_new_type', undefined, 'math')).toBe('activity');
  });
});

describe('NodePalette render', () => {
  const html = renderPalette();

  it('is one column (no grid of chips) with every Essentials node and a section header per section', () => {
    expect(html).not.toMatch(/category-nodes grid/);
    for (const s of buildPaletteSections()) {
      expect(html).toContain(`data-category="${s.key}"`);
    }
    const nodes = html.match(/data-palette-item="node"/g) || [];
    expect(nodes.length).toBe(8); // only Essentials is open by default
  });

  it('section headers are buttons with aria-expanded and a count', () => {
    expect(html).toMatch(/data-category="essentials"[^>]*>|aria-expanded="true"[^>]*data-category="essentials"/);
    expect(html).toMatch(/<button[^>]*aria-expanded="true"[^>]*data-category="essentials"/);
    expect(html).toMatch(/<button[^>]*aria-expanded="false"[^>]*data-category="core"/);
    expect(html).toContain('aria-label="8 nodes"');
  });

  it('every node row has a kit svg icon, its full name, and a kit tooltip; no emoji anywhere', () => {
    const rows = html.split('data-palette-item="node"').slice(1);
    expect(rows.length).toBe(8);
    for (const row of rows) {
      const body = row.slice(0, row.indexOf('</div>'));
      expect(body).toMatch(/<svg[^>]*class="palette-node-icon"/);
      expect(body).toMatch(/class="palette-node-label"/);
    }
    expect(html).toMatch(/data-af-tip="Entry point for a workflow run\."/);
    expect(html).toContain('>On Flow Start<');
    expect(html).toContain('>String Template<');
    expect(/\p{Extended_Pictographic}/u.test(html.replace(/<[^>]+>/g, ''))).toBe(false);
    expect(html).not.toContain('dangerouslySetInnerHTML');
  });

  it('has a search box and a resize separator', () => {
    expect(html).toMatch(/<input[^>]*type="search"[^>]*aria-label="Search nodes"/);
    expect(html).toMatch(/role="separator"[^>]*aria-orientation="vertical"/);
    expect(html).toMatch(new RegExp(`aria-valuemin="${PALETTE_MIN_WIDTH}"`));
  });
});

describe('palette stylesheet', () => {
  const css = readFileSync(resolve(__dirname, '../styles/palette.css'), 'utf8');
  const rule = (sel: string) => {
    const i = css.indexOf(`${sel} {`);
    expect(i, `${sel} rule exists`).toBeGreaterThan(-1);
    return css.slice(i, css.indexOf('}', i));
  };

  it('names wrap and are never truncated', () => {
    const label = rule('.palette-node-label');
    expect(label).toMatch(/white-space:\s*normal/);
    expect(label).not.toMatch(/text-overflow:\s*ellipsis/);
    expect(label).not.toMatch(/nowrap/);
    expect(css).not.toMatch(/\.palette-node[^{]*\{[^}]*text-overflow:\s*ellipsis/);
  });

  it('one column: no two-column chip grid', () => {
    expect(css).not.toMatch(/grid-template-columns:\s*repeat\(2/);
    expect(rule('.category-nodes')).toMatch(/flex-direction:\s*column/);
  });
});
