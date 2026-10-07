/**
 * Node category → colour token (R14-W8).
 *
 * Every node takes the colour of its HOME palette section (an Essentials row
 * keeps its home colour: On Flow Start is an "Events and time" node, Agent a
 * "Core" node). The colour itself is a CSS custom property defined only in
 * styles/categories.css (`--flow-cat-<section>`, light + dark steps); this
 * module only names the token, so no hue is ever written in TS/TSX.
 *
 * Presentation only: the saved `headerColor` stays in the flow file for
 * older clients, it is simply no longer what the editor paints.
 */
import { NODE_CATEGORIES, getNodeTemplate } from '../types/nodes';
import { PALETTE_SECTION_DEFS } from './paletteModel';

/** The neutral section for a node type no palette section claims. */
export const OTHER_COLOR_SECTION = 'other';

/** Semantic category (NODE_CATEGORIES key) → the palette section whose colour it wears. */
export const CATEGORY_COLOR_SECTION: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(PALETTE_SECTION_DEFS.flatMap((def) => def.categories.map((category) => [category, def.key])))
);

/** Every colour section the token file must define (palette sections + "other"). */
export const COLOR_SECTIONS: readonly string[] = Object.freeze([
  ...PALETTE_SECTION_DEFS.map((def) => def.key),
  OTHER_COLOR_SECTION,
]);

/** The section a semantic category is painted with ("other" when unknown). */
export function colorSectionForCategory(category: string | undefined | null): string {
  return (category && CATEGORY_COLOR_SECTION[category]) || OTHER_COLOR_SECTION;
}

/**
 * The semantic category of a node on the canvas: the template with the same
 * type AND label first (palette entries that share a type, e.g. the artifact
 * literals are `literal_json` under "artifacts"), then the canonical template
 * of the type.
 */
export function nodeSemanticCategory(nodeType: string, label?: string): string | undefined {
  if (label) {
    for (const [key, category] of Object.entries(NODE_CATEGORIES)) {
      if (category.nodes.some((n) => n.type === nodeType && n.label === label)) return key;
    }
  }
  try {
    return getNodeTemplate(nodeType as Parameters<typeof getNodeTemplate>[0])?.category;
  } catch {
    return undefined;
  }
}

/** The colour section of a node (type + label). */
export function nodeColorSection(nodeType: string, label?: string): string {
  return colorSectionForCategory(nodeSemanticCategory(nodeType, label));
}

/** The CSS custom property holding a section's hue. */
export function categoryColorToken(section: string): string {
  return `--flow-cat-${COLOR_SECTIONS.includes(section) ? section : OTHER_COLOR_SECTION}`;
}

/** `var(--flow-cat-<section>)` — the value to put in a style. */
export function categoryColorVar(section: string): string {
  return `var(${categoryColorToken(section)})`;
}
