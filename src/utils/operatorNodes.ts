/**
 * Operator nodes can be collapsed on the canvas into a small round node that
 * shows only the operator, its pins and its wires (operator 2026-10-11:
 * "collapse a concat or append or math operator node into a circle with only
 * the operator sign"): pure nodes whose meaning fits a sign. Nothing is lost:
 * the node's values stay, the hover card lists what feeds each input, and
 * unfolding shows the full card.
 */
import type { FlowNodeData } from '../types/flow';

/**
 * Each foldable node: the sign it shows folded, what it is (the hover card's
 * first line) and its folded shape. Operators fold into a circle with their
 * sign; a variable getter folds into a rounded rectangle with the variable's
 * name (the name is what it says), as visual languages draw a getter as a
 * compact pill and an operator as a compact sign.
 */
type FoldedShape = 'circle' | 'rounded';
const OPERATORS: Readonly<Record<string, { sign: string; title: string; shape?: FoldedShape }>> = {
  add: { sign: '+', title: 'Add numbers' },
  subtract: { sign: '−', title: 'Subtract numbers' },
  multiply: { sign: '×', title: 'Multiply numbers' },
  divide: { sign: '÷', title: 'Divide numbers' },
  modulo: { sign: '%', title: 'Remainder (modulo)' },
  power: { sign: '^', title: 'Power' },
  abs: { sign: '|x|', title: 'Absolute value' },
  round: { sign: '≈', title: 'Round a number' },
  concat: { sign: '++', title: 'String concat' },
  length: { sign: 'len', title: 'String length' },
  is_empty_string: { sign: '∅?', title: 'Is the string empty' },
  contains: { sign: '∋', title: 'String contains' },
  uppercase: { sign: 'AA', title: 'Uppercase' },
  lowercase: { sign: 'aa', title: 'Lowercase' },
  trim: { sign: 'trim', title: 'Trim whitespace' },
  make_array: { sign: '[ ]', title: 'Make array' },
  array_append: { sign: '+[ ]', title: 'Array append' },
  array_concat: { sign: '[ ]+[ ]', title: 'Array concat' },
  array_length: { sign: 'len', title: 'Array length' },
  make_object: { sign: '{ }', title: 'Build JSON object' },
  merge: { sign: '{ }+{ }', title: 'Merge objects' },
  break_object: { sign: '{ }→', title: 'Break object into fields' },
  and: { sign: '&&', title: 'Logical AND' },
  or: { sign: '||', title: 'Logical OR' },
  not: { sign: '!', title: 'Logical NOT' },
  coalesce: { sign: '??', title: 'First non-empty value' },
  compare: { sign: '=?', title: 'Compare' },
  get_var: { sign: '(x)', title: 'Read variable', shape: 'rounded' },
  get_vars: { sign: '(x)', title: 'Read variables', shape: 'rounded' },
  string_template: { sign: '', title: 'Text with variables', shape: 'circle' },
};

/** The folded shape: a circle for an operator, a rounded rectangle for a variable getter. */
export function foldedShape(nodeType: string): FoldedShape {
  return OPERATORS[nodeType]?.shape ?? 'circle';
}

export function isCollapsibleOperator(nodeType: unknown): boolean {
  return typeof nodeType === 'string' && Object.prototype.hasOwnProperty.call(OPERATORS, nodeType);
}

/**
 * The sign a folded operator shows. Compare shows its operator when the node
 * sets it (no wire and no expression feeds `op`: those win at run time).
 */
export function operatorSymbol(data: Pick<FlowNodeData, 'nodeType' | 'pinDefaults' | 'pinExpressions'>, opWired = false): string {
  // Compare's operator, or a getter's variable name, when the node sets it (a
  // wire or an expression on that pin wins at run time: then the generic sign).
  const own = data.nodeType === 'compare' ? 'op' : data.nodeType === 'get_var' ? 'name' : '';
  if (own && !opWired && !(data.pinExpressions as Record<string, unknown> | undefined)?.[own]) {
    const value = (data.pinDefaults as Record<string, unknown> | undefined)?.[own];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return OPERATORS[data.nodeType]?.sign ?? '';
}

/** What a foldable node is, in a few words ("String concat", "Array concat"). */
export function operatorTitle(nodeType: string): string {
  return OPERATORS[nodeType]?.title ?? '';
}

/** Is this node drawn folded? Only operators fold, whatever the saved flag says. */
export function isCollapsedOperator(data: Pick<FlowNodeData, 'nodeType' | 'collapsed'>): boolean {
  return data.collapsed === true && isCollapsibleOperator(data.nodeType);
}

/** What feeds one input of a folded operator, for its hover card. */
export interface OperatorInputSource {
  pin: string;
  /**
   * `expression`: a pin expression (it wins at run time); `variable`: wired from a
   * Get Variable node; `wire`: from another node's output; `literal`: a value set on the node.
   */
  kind: 'expression' | 'variable' | 'wire' | 'literal' | 'empty';
  text: string;
}

const LITERAL_MAX = 48;

function clip(text: string): string {
  return text.length > LITERAL_MAX ? `${text.slice(0, LITERAL_MAX - 1)}…` : text;
}

export function operatorInputSources(
  nodeId: string,
  data: Pick<FlowNodeData, 'inputs' | 'pinDefaults' | 'pinExpressions'>,
  nodes: ReadonlyArray<{ id: string; data: Pick<FlowNodeData, 'nodeType' | 'label' | 'outputs' | 'pinDefaults'> }>,
  edges: ReadonlyArray<{ source: string; sourceHandle?: string | null; target: string; targetHandle?: string | null }>
): OperatorInputSource[] {
  const defaults = (data.pinDefaults || {}) as Record<string, unknown>;
  const expressions = (data.pinExpressions || {}) as Record<string, unknown>;
  return data.inputs
    .filter((pin) => pin.type !== 'execution')
    .map((pin) => {
      const expression = expressions[pin.id];
      if (typeof expression === 'string' && expression.trim()) return { pin: pin.label || pin.id, kind: 'expression', text: clip(expression.trim()) };
      let edge = edges.find((e) => e.target === nodeId && e.targetHandle === pin.id);
      // A relay only passes a value on: name what feeds the relay (through a chain of them).
      for (let hops = 0; edge && nodes.find((n) => n.id === edge!.source)?.data.nodeType === 'reroute' && hops < 20; hops += 1) {
        const upstream = edges.find((e) => e.target === edge!.source);
        if (!upstream) break;
        edge = upstream;
      }
      if (edge) {
        const source = nodes.find((n) => n.id === edge.source);
        const varName = source?.data.nodeType === 'get_var' ? (source.data.pinDefaults as Record<string, unknown> | undefined)?.name : undefined;
        if (typeof varName === 'string' && varName.trim()) return { pin: pin.label || pin.id, kind: 'variable', text: varName.trim() };
        const sourcePin = source?.data.outputs.find((p) => p.id === edge.sourceHandle);
        return { pin: pin.label || pin.id, kind: 'wire', text: `${source?.data.label || edge.source} · ${sourcePin?.label || edge.sourceHandle || ''}` };
      }
      const value = defaults[pin.id];
      if (value !== undefined && value !== null && value !== '')
        return { pin: pin.label || pin.id, kind: 'literal', text: clip(typeof value === 'string' ? `"${value}"` : JSON.stringify(value)) };
      return { pin: pin.label || pin.id, kind: 'empty', text: 'empty' };
    });
}

/** One output of a folded operator, for its hover card. */
export interface OperatorOutputRow {
  /** Shown name; empty for an operator's single generic `result` (its type says it all). */
  name: string;
  /** The field path when it is not just the name (Break Object: `data.tasks`). */
  path: string;
  type: string;
  /** What the pin's schema adds: `of object` for an array, `{id, title, done}` for an object. */
  detail: string;
}

function schemaDetail(schema: unknown): string {
  if (!schema || typeof schema !== 'object') return '';
  const s = schema as Record<string, unknown>;
  const items = s.items as Record<string, unknown> | undefined;
  if (items && typeof items === 'object') {
    const inner = typeof items.type === 'string' ? items.type : '';
    const keys = items.properties && typeof items.properties === 'object' ? Object.keys(items.properties as object) : [];
    return [inner ? `of ${inner}` : '', keys.length ? `{${keys.slice(0, 4).join(', ')}${keys.length > 4 ? ', …' : ''}}` : ''].filter(Boolean).join(' ');
  }
  const keys = s.properties && typeof s.properties === 'object' ? Object.keys(s.properties as object) : [];
  return keys.length ? `{${keys.slice(0, 4).join(', ')}${keys.length > 4 ? ', …' : ''}}` : '';
}

export function operatorOutputRows(data: Pick<FlowNodeData, 'outputs'>): OperatorOutputRow[] {
  const outputs = data.outputs.filter((pin) => pin.type !== 'execution');
  return outputs.map((pin) => {
    const generic = outputs.length === 1 && pin.id === 'result';
    const name = generic ? '' : pin.label || pin.id;
    return {
      name,
      path: !generic && pin.id !== name ? pin.id : '',
      type: pin.type,
      detail: schemaDetail(pin.schema),
    };
  });
}
