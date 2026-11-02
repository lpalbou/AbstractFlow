import type { Pin } from '../types/flow';

/**
 * Lists of short texts on a node card. An `array` pin whose schema says its items are
 * strings (a Decision's `options` / `levels`, any `{type:'array', items:{type:'string'}}`
 * pin) is edited inline as one comma-separated line: `returns, shipping, billing`.
 */
export function isStringListPin(pin: Pick<Pin, 'type' | 'schema'>): boolean {
  if (pin.type !== 'array') return false;
  const schema = pin.schema as { items?: { type?: unknown; enum?: unknown } } | undefined;
  const items = schema?.items;
  if (!items || typeof items !== 'object') return false;
  return items.type === 'string' || Array.isArray(items.enum);
}

/** The card's text for a stored list value (non-strings are shown as JSON). */
export function stringListToText(value: unknown): string {
  if (!Array.isArray(value)) return '';
  return value
    .map((item) => (typeof item === 'string' ? item : JSON.stringify(item)))
    .join(', ');
}

/** The list a typed line means: split on commas, trimmed, blanks dropped, repeats kept once. */
export function textToStringList(text: string): string[] {
  const out: string[] = [];
  for (const part of text.split(',')) {
    const clean = part.trim();
    if (clean && !out.includes(clean)) out.push(clean);
  }
  return out;
}

export const STRING_LIST_ITEMS_SCHEMA = { type: 'array', items: { type: 'string' } } as const;
