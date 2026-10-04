/**
 * Node palette model (R13.3): display sections, search, highlight, and the
 * per-browser expansion state. Pure functions — NodePalette renders them.
 *
 * NODE_CATEGORIES stays the semantic source of truth (tests + assistant
 * catalog read it); the palette regroups those categories into ordered
 * display sections. Essentials is a curated section of the nodes nearly every
 * flow uses: expanded by default, collapsible like every other section.
 */
import { NODE_CATEGORIES, getNodeTemplate, type NodeTemplate } from '../types/nodes';

export interface PaletteSection {
  key: string;
  label: string;
  nodes: NodeTemplate[];
}

/** Ordered display sections; each pulls one or more semantic categories. */
export const PALETTE_SECTION_DEFS: readonly { key: string; label: string; categories: string[] }[] = [
  { key: 'core', label: 'Core', categories: ['core'] },
  { key: 'control', label: 'Control flow', categories: ['control'] },
  { key: 'events', label: 'Events and time', categories: ['events'] },
  { key: 'variables', label: 'Variables', categories: ['variables'] },
  { key: 'data', label: 'Data and text', categories: ['data'] },
  { key: 'values', label: 'Values and schema', categories: ['literals', 'schema'] },
  { key: 'files', label: 'Files and artifacts', categories: ['files', 'artifacts'] },
  { key: 'media', label: 'Media', categories: ['media'] },
  { key: 'memory', label: 'Memory', categories: ['memory'] },
  { key: 'entity', label: 'Entity mind', categories: ['entity'] },
  { key: 'math', label: 'Math', categories: ['math'] },
];

/** Curated quick-access section: the nodes nearly every workflow reaches for. */
export const ESSENTIAL_NODE_TYPES: Parameters<typeof getNodeTemplate>[0][] = [
  'on_flow_start',
  'on_flow_end',
  'agent',
  'llm_call',
  'code',
  'if',
  'for',
  'string_template',
];

export const ESSENTIALS_KEY = 'essentials';

/** Every palette section, Essentials first. A category no section claims gets its own trailing section. */
export function buildPaletteSections(): PaletteSection[] {
  const claimed = new Set(PALETTE_SECTION_DEFS.flatMap((s) => s.categories));
  const defs = [
    ...PALETTE_SECTION_DEFS,
    ...Object.entries(NODE_CATEGORIES)
      .filter(([key]) => !claimed.has(key))
      .map(([key, category]) => ({ key, label: category.label, categories: [key] })),
  ];
  const essentials: PaletteSection = {
    key: ESSENTIALS_KEY,
    label: 'Essentials',
    nodes: ESSENTIAL_NODE_TYPES.map((type) => getNodeTemplate(type)).filter((t): t is NodeTemplate => Boolean(t)),
  };
  return [
    essentials,
    ...defs.map((def) => ({
      key: def.key,
      label: def.label,
      nodes: def.categories
        .flatMap((categoryKey) => NODE_CATEGORIES[categoryKey]?.nodes ?? [])
        .filter((n) => !n.hiddenInPalette),
    })),
  ];
}

export function normalizeSearch(term: string): string {
  return term.trim().toLowerCase();
}

export function nodeMatchesSearch(node: NodeTemplate, term: string): boolean {
  const q = normalizeSearch(term);
  if (!q) return true;
  return (
    node.label.toLowerCase().includes(q) ||
    node.type.toLowerCase().includes(q) ||
    node.description.toLowerCase().includes(q)
  );
}

/**
 * Sections to show for a search term: no term → every section (Essentials
 * first); a term → only sections with a match, each filtered, and Essentials
 * left out (its nodes are listed again under their own section).
 */
export function filterPaletteSections(sections: PaletteSection[], term: string): PaletteSection[] {
  const q = normalizeSearch(term);
  if (!q) return sections;
  return sections
    .filter((s) => s.key !== ESSENTIALS_KEY)
    .map((s) => ({ ...s, nodes: s.nodes.filter((n) => nodeMatchesSearch(n, q)) }))
    .filter((s) => s.nodes.length > 0);
}

/** Label split around every case-insensitive occurrence of the term (for <mark>). */
export function highlightSegments(label: string, term: string): { text: string; match: boolean }[] {
  const q = normalizeSearch(term);
  if (!q) return [{ text: label, match: false }];
  const out: { text: string; match: boolean }[] = [];
  const lower = label.toLowerCase();
  let i = 0;
  while (i < label.length) {
    const at = lower.indexOf(q, i);
    if (at < 0) {
      out.push({ text: label.slice(i), match: false });
      break;
    }
    if (at > i) out.push({ text: label.slice(i, at), match: false });
    out.push({ text: label.slice(at, at + q.length), match: true });
    i = at + q.length;
  }
  return out.length ? out : [{ text: label, match: false }];
}

/** The one-line description shown in a node's tooltip: the first sentence of the template description. */
export function oneLineDescription(description: string): string {
  const text = String(description || '').replace(/\s+/g, ' ').trim();
  // "e.g." / "i.e." are not sentence ends.
  const masked = text.replace(/\b(e\.g|i\.e)\./gi, (s) => s.replace(/\./g, '\u0000'));
  const m = masked.match(/^(.+?[.!?])(\s|$)/);
  return (m ? m[1] : masked).replace(/\u0000/g, '.');
}

/** Whether a section is open: a search opens every matching section; otherwise the remembered state. */
export function isSectionExpanded(key: string, expansion: Record<string, boolean>, term: string): boolean {
  if (normalizeSearch(term)) return true;
  return Boolean(expansion[key]);
}

export const EXPANSION_STORAGE_KEY = 'abstractflow_palette_sections_v2';
export const DEFAULT_EXPANSION: Readonly<Record<string, boolean>> = { [ESSENTIALS_KEY]: true };

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

function storage(): StorageLike | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** Remembered expansion (per browser). Essentials open, the rest closed, until the viewer changes it. */
export function loadExpansion(store: StorageLike | null = storage()): Record<string, boolean> {
  try {
    const raw = store?.getItem(EXPANSION_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_EXPANSION };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ...DEFAULT_EXPANSION };
    const out: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(parsed)) if (typeof v === 'boolean') out[k] = v;
    return out;
  } catch {
    return { ...DEFAULT_EXPANSION };
  }
}

export function saveExpansion(state: Record<string, boolean>, store: StorageLike | null = storage()): void {
  try {
    store?.setItem(EXPANSION_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // A convenience only: never break the palette over storage.
  }
}

/** Palette width on wide layouts (resizable; remembered per browser). */
export const PALETTE_WIDTH_STORAGE_KEY = 'abstractflow_palette_width_v1';
/** Narrowest width: the longest node name still fits on two lines beside its icon. */
export const PALETTE_MIN_WIDTH = 248;
export const PALETTE_MAX_WIDTH = 480;
export const PALETTE_DEFAULT_WIDTH = 272;

export function clampPaletteWidth(px: number): number {
  if (!Number.isFinite(px)) return PALETTE_DEFAULT_WIDTH;
  return Math.round(Math.min(PALETTE_MAX_WIDTH, Math.max(PALETTE_MIN_WIDTH, px)));
}

export function loadPaletteWidth(store: StorageLike | null = storage()): number {
  try {
    const raw = store?.getItem(PALETTE_WIDTH_STORAGE_KEY);
    return raw ? clampPaletteWidth(Number(raw)) : PALETTE_DEFAULT_WIDTH;
  } catch {
    return PALETTE_DEFAULT_WIDTH;
  }
}

export function savePaletteWidth(px: number, store: StorageLike | null = storage()): void {
  try {
    store?.setItem(PALETTE_WIDTH_STORAGE_KEY, String(clampPaletteWidth(px)));
  } catch {
    // convenience only
  }
}

/** One focusable palette row, as the keyboard handler sees it (DOM order). */
export interface PaletteKeyItem {
  kind: 'header' | 'node';
  section: string;
  nodeType?: string;
  nodeLabel?: string;
  disabled?: boolean;
}

export type PaletteKeyAction =
  | { kind: 'focus'; index: number }
  | { kind: 'focusSearch' }
  | { kind: 'toggle'; section: string; open?: boolean }
  | { kind: 'add'; nodeType: string; nodeLabel: string }
  | { kind: 'none' };

/**
 * What a key does on the palette row at `index`:
 * ArrowUp/ArrowDown/Home/End move; ArrowUp on the first row returns to the
 * search box; ArrowRight opens a section, ArrowLeft closes it (from a node,
 * jumps to its section header); Enter/Space toggles a section (not while
 * searching: a search opens every matching section) or adds the node at the
 * centre of the canvas (never a disabled node).
 */
export function paletteKeyAction(key: string, items: PaletteKeyItem[], index: number, searching: boolean): PaletteKeyAction {
  const item = items[index];
  if (!item) return { kind: 'none' };
  if (key === 'ArrowUp' && index === 0) return { kind: 'focusSearch' };
  const next = nextPaletteFocus(key, index, items.length);
  if (next !== null) return { kind: 'focus', index: next };
  if (key === 'ArrowRight' && item.kind === 'header') return { kind: 'toggle', section: item.section, open: true };
  if (key === 'ArrowLeft') {
    if (item.kind === 'header') return { kind: 'toggle', section: item.section, open: false };
    const header = items.findIndex((it) => it.kind === 'header' && it.section === item.section);
    return header >= 0 ? { kind: 'focus', index: header } : { kind: 'none' };
  }
  if (key === 'Enter' || key === ' ') {
    if (item.kind === 'header') return searching ? { kind: 'none' } : { kind: 'toggle', section: item.section };
    if (item.disabled || !item.nodeType || !item.nodeLabel) return { kind: 'none' };
    return { kind: 'add', nodeType: item.nodeType, nodeLabel: item.nodeLabel };
  }
  return { kind: 'none' };
}

/** Next focus index for the palette's roving focus (headers + nodes in DOM order). */
export function nextPaletteFocus(key: string, index: number, count: number): number | null {
  if (count <= 0) return null;
  switch (key) {
    case 'ArrowDown':
      return Math.min(count - 1, index + 1);
    case 'ArrowUp':
      return Math.max(0, index - 1);
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}
