import type { FlowNodeData, Pin } from '../types/flow';

/**
 * String Template as a text with variable chips (operator 2026-10-11: "can't we handle the string
 * template ourselves? something where a person could build its dynamic sentence and just add
 * variables in it by selecting them"). The stored form stays the runtime's `{{name}}` text, so
 * older templates open with chips and run unchanged. A chip reads, first match wins: an input of
 * the node (a value that comes from a wire), else the run variable of that name
 * (abstractruntime string_template).
 */

export type TemplateSegment = { kind: 'text'; text: string } | { kind: 'slot'; expr: string; name: string };

const SLOT = /\{\{\s*(.*?)\s*\}\}/g;

/** What a placeholder reads, without its filters: `knowledge | json` → `knowledge`, `user.name` stays. */
export function slotName(expr: string): string {
  return expr.split('|')[0].trim();
}

/** The variable or input a path starts from: `user.name` → `user`, `items[0]` → `items`. */
function slotRoot(name: string): string {
  return name.split(/[.[]/)[0].trim();
}

export function parseTemplate(text: string): TemplateSegment[] {
  const out: TemplateSegment[] = [];
  let last = 0;
  for (const m of text.matchAll(SLOT)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ kind: 'text', text: text.slice(last, at) });
    out.push({ kind: 'slot', expr: m[1], name: slotName(m[1]) });
    last = at + m[0].length;
  }
  if (last < text.length) out.push({ kind: 'text', text: text.slice(last) });
  return out;
}

export function serializeTemplate(segments: TemplateSegment[]): string {
  return segments.map((s) => (s.kind === 'text' ? s.text : `{{${s.expr}}}`)).join('');
}

/** The node's inputs that a chip can read (values that come from a wire): all but the text itself. */
export function templateInputPins(inputs: Pin[]): Pin[] {
  return inputs.filter((p) => p.type !== 'execution' && p.id !== 'template' && p.id !== 'vars');
}

/** A usable name for a new input of the node, or why not. */
export function templateInputNameProblem(name: string, taken: ReadonlySet<string>): string | null {
  const trimmed = name.trim();
  if (!trimmed) return 'An input needs a name';
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(trimmed)) return 'Input names are one word: letters, digits and _';
  if (trimmed === 'template' || trimmed === 'vars') return `"${trimmed}" is reserved by this node`;
  if (taken.has(trimmed)) return `"${trimmed}" is already an input of this node`;
  return null;
}

export type SlotKind = 'input' | 'variable' | 'unknown';

export function slotKind(name: string, inputIds: ReadonlySet<string>, variables: ReadonlySet<string>): SlotKind {
  const root = slotRoot(name);
  if (inputIds.has(name) || inputIds.has(root)) return 'input';
  if (variables.has(name) || variables.has(root)) return 'variable';
  return 'unknown';
}

/**
 * Older String Templates had a `vars` input that had to receive every value as one object (often
 * the pin expression `vars`, i.e. all run variables). Placeholders now read run variables
 * directly, so on load an unwired `vars` pin with nothing of its own, or with exactly that
 * expression, goes. One with a wire or a value set on it stays. Same data when nothing changes.
 */
export function withoutRedundantTemplateVars(data: FlowNodeData, wiredInputs: ReadonlySet<string>): FlowNodeData {
  if (data.nodeType !== 'string_template') return data;
  const inputs = data.inputs || [];
  if (!inputs.some((p) => p.id === 'vars') || wiredInputs.has('vars')) return data;
  const defaults = (data.pinDefaults || {}) as Record<string, unknown>;
  const value = defaults.vars;
  const hasValue = value !== undefined && value !== null && !(typeof value === 'object' && Object.keys(value as object).length === 0);
  const expressions: Record<string, string> = { ...(data.pinExpressions || {}) };
  const expression = typeof expressions.vars === 'string' ? expressions.vars.trim() : '';
  if (hasValue || (expression && expression !== 'vars')) return data;
  delete expressions.vars;
  const { vars: _dropped, ...pinDefaults } = defaults;
  const next: FlowNodeData = { ...data, inputs: inputs.filter((p) => p.id !== 'vars'), pinDefaults: pinDefaults as FlowNodeData['pinDefaults'] };
  if (Object.keys(expressions).length > 0) next.pinExpressions = expressions;
  else delete next.pinExpressions;
  return next;
}
