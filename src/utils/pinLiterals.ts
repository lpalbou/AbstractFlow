/**
 * Typed pin literals (root ADR 0049, operator ruling 2026-11-02).
 *
 * A value typed on an unwired input takes the type of that input: a number
 * pin stores a number, a true/false pin a boolean, a text pin a string. An
 * `any` pin that names a type variable (`Pin.typeVar` on the node template:
 * Compare's `a`/`b`, Coalesce's inputs and result) takes the type the node's
 * wires give that variable, the way a compiler unifies a type variable:
 * Compare `a` wired to a number makes the `5` typed on `b` the number 5, never
 * the text "5". With nothing to resolve from, a typed value is text.
 *
 * The type is decided by the graph, never guessed from the text: "5" on an
 * unresolved pin stays the text "5". The saved flow stores the JSON value
 * with its type (5, "5", true), and the runtime executes it as stored.
 *
 * One function keeps the stored values true to their types whatever changes
 * the wiring (`withTypedPinLiterals`, run by the store subscription and by
 * loadFlow): when an input's type is declared or resolved from a wire, a
 * value that converts exactly is converted ("5" <-> 5, "true" <-> true),
 * anything else stays as typed and is flagged on the node and by the run
 * checks (`pinLiteralProblem`), never kept as a silent wrong type. With
 * nothing to resolve from, a stored value keeps its own JSON type (a
 * generator's `[]` default stays a list; the 5 typed while `a` was wired stays
 * 5 once `a` is unwired), and new text typed in the box is text.
 */
import type { Edge, Node } from 'reactflow';
import type { FlowNodeData, JsonValue, Pin, PinType } from '../types/flow';
import { getNodeTemplate } from '../types/nodes';
import { isRouteOverrideEdge } from './multiEntryRoutes';

/** The JSON type a typed value is stored as. */
export type LiteralKind = 'string' | 'number' | 'boolean' | 'object' | 'array';

/** What the type tag beside a typed box says. */
export const LITERAL_KIND_LABEL: Record<LiteralKind, string> = {
  string: 'text',
  number: 'number',
  boolean: 'true/false',
  object: 'JSON',
  array: 'list',
};

/**
 * Where a pin's literal type comes from: its own declared type (`pin`), the
 * wires of its type variable (`wire`), or nothing to resolve from (`default`:
 * text typed on a type-variable pin with no wired peer is text, and a value
 * already stored keeps its own JSON type: no wire says otherwise).
 */
export type PinLiteralType = { kind: LiteralKind; from: 'pin' | 'wire' | 'default' };

const STRING_TYPES: ReadonlySet<PinType> = new Set<PinType>([
  'string',
  'provider',
  'model',
  'provider_text',
  'model_text',
  'provider_image',
  'model_image',
  'provider_video',
  'model_video',
  'provider_voice',
  'model_voice',
  'provider_music',
  'model_music',
  'workspace_file',
  'workspace_folder',
]);
const OBJECT_TYPES: ReadonlySet<PinType> = new Set<PinType>([
  'object',
  'json_schema',
  'memory',
  'assertion',
  'email',
  'artifact',
  'artifact_image',
  'artifact_audio',
  'artifact_text',
  'artifact_video',
]);
const ARRAY_TYPES: ReadonlySet<PinType> = new Set<PinType>([
  'array',
  'tools',
  'assertions',
  'emails',
  'artifacts',
  'artifacts_image',
  'artifacts_audio',
  'artifacts_text',
  'artifacts_video',
]);

/** The JSON type a value of this pin type is (null: execution, `any`, or a type with no JSON literal). */
export function literalKindOfType(type: PinType): LiteralKind | null {
  if (type === 'number') return 'number';
  if (type === 'boolean') return 'boolean';
  if (STRING_TYPES.has(type)) return 'string';
  if (OBJECT_TYPES.has(type)) return 'object';
  if (ARRAY_TYPES.has(type)) return 'array';
  return null;
}

/**
 * Declared pins whose typed value the editor converts: the scalar ones. A
 * declared object/list pin keeps its own JSON editor and is left as stored.
 */
const DECLARED_LITERAL_KINDS: Partial<Record<PinType, LiteralKind>> = {
  string: 'string',
  number: 'number',
  boolean: 'boolean',
};

/** The JSON type a stored value has (null for null). */
export function literalKindOfValue(value: JsonValue): LiteralKind | null {
  if (value === null) return null;
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'object') return 'object';
  return typeof value as 'string' | 'number' | 'boolean';
}

// ---------------------------------------------------------------------------
// The graph index, one per (nodes, edges) pair: a card render or a store
// update asks for many pins of the same graph.

type Graph = {
  nodesById: Map<string, Node<FlowNodeData>>;
  /** `${target}\0${handle}` -> the wire feeding that input. */
  incoming: Map<string, Edge>;
  /** `${source}\0${handle}` -> the wires leaving that output. */
  outgoing: Map<string, Edge[]>;
};

const graphCache = new WeakMap<Node<FlowNodeData>[], WeakMap<Edge[], Graph>>();

function pinKey(nodeId: string, handle: string | null | undefined): string {
  return `${nodeId}\u0000${handle || ''}`;
}

function graphOf(nodes: Node<FlowNodeData>[], edges: Edge[]): Graph {
  let byEdges = graphCache.get(nodes);
  if (!byEdges) {
    byEdges = new WeakMap();
    graphCache.set(nodes, byEdges);
  }
  const cached = byEdges.get(edges);
  if (cached) return cached;
  const incoming = new Map<string, Edge>();
  const outgoing = new Map<string, Edge[]>();
  for (const edge of edges) {
    // A per-path wire (dashed) replaces the value on one way in only; the pin's
    // own value still applies on the others, so it neither wires nor types it.
    if (isRouteOverrideEdge(edge)) continue;
    incoming.set(pinKey(edge.target, edge.targetHandle), edge);
    const out = pinKey(edge.source, edge.sourceHandle);
    const list = outgoing.get(out);
    if (list) list.push(edge);
    else outgoing.set(out, [edge]);
  }
  const graph: Graph = { nodesById: new Map(nodes.map((n) => [n.id, n])), incoming, outgoing };
  byEdges.set(edges, graph);
  return graph;
}

// ---------------------------------------------------------------------------
// Type variables.

type Side = 'input' | 'output';

/** The type variable the node's TEMPLATE puts on this pin (a saved pin never declares one). */
function typeVarOf(node: Node<FlowNodeData>, pinId: string, side: Side): string | undefined {
  const template = getNodeTemplate(node.data.nodeType);
  const pins = side === 'input' ? template?.inputs : template?.outputs;
  return pins?.find((p) => p.id === pinId)?.typeVar;
}

function savedPin(node: Node<FlowNodeData>, pinId: string, side: Side): Pin | undefined {
  const pins = side === 'input' ? node.data.inputs : node.data.outputs;
  return Array.isArray(pins) ? pins.find((p) => p.id === pinId) : undefined;
}

/** The one type a set of candidates agrees on, or null (none, or wires that disagree). */
function agreed(types: PinType[]): PinType | null {
  const distinct = new Set(types);
  return distinct.size === 1 ? types[0] : null;
}

/** The type an output carries: its declared type, or its type variable's resolution. */
function outputType(graph: Graph, nodeId: string, pinId: string, seen: Set<string>): PinType | null {
  const node = graph.nodesById.get(nodeId);
  const pin = node ? savedPin(node, pinId, 'output') : undefined;
  if (!node || !pin || pin.type === 'execution') return null;
  if (pin.type !== 'any') return pin.type;
  const typeVar = typeVarOf(node, pinId, 'output');
  return typeVar ? resolveTypeVar(graph, node, typeVar, seen) : null;
}

/** The type an input takes: its declared type, or its type variable's resolution. */
function inputType(graph: Graph, nodeId: string, pinId: string, seen: Set<string>): PinType | null {
  const node = graph.nodesById.get(nodeId);
  const pin = node ? savedPin(node, pinId, 'input') : undefined;
  if (!node || !pin || pin.type === 'execution') return null;
  if (pin.type !== 'any') return pin.type;
  const typeVar = typeVarOf(node, pinId, 'input');
  return typeVar ? resolveTypeVar(graph, node, typeVar, seen) : null;
}

/**
 * The concrete type a node's type variable takes, in order: a pin of the
 * variable the node already types itself (Get Variable's `value`, typed by the
 * variable it reads); else what is wired INTO its pins; else what its outputs
 * are wired to. Each step must agree on one type; wires that disagree leave
 * the variable unresolved. `seen` stops a cycle of generic nodes.
 */
function resolveTypeVar(graph: Graph, node: Node<FlowNodeData>, typeVar: string, seen: Set<string>): PinType | null {
  const key = pinKey(node.id, typeVar);
  if (seen.has(key)) return null;
  seen.add(key);
  const template = getNodeTemplate(node.data.nodeType);
  if (!template) return null;
  const inputs = template.inputs.filter((p) => p.typeVar === typeVar).map((p) => p.id);
  const outputs = template.outputs.filter((p) => p.typeVar === typeVar).map((p) => p.id);

  const own: PinType[] = [];
  for (const id of inputs) {
    const t = savedPin(node, id, 'input')?.type;
    if (t && t !== 'any' && t !== 'execution') own.push(t);
  }
  for (const id of outputs) {
    const t = savedPin(node, id, 'output')?.type;
    if (t && t !== 'any' && t !== 'execution') own.push(t);
  }
  if (own.length > 0) return agreed(own);

  const fed: PinType[] = [];
  for (const id of inputs) {
    const edge = graph.incoming.get(pinKey(node.id, id));
    if (!edge) continue;
    const t = outputType(graph, edge.source, String(edge.sourceHandle || ''), seen);
    if (t) fed.push(t);
  }
  if (fed.length > 0) return agreed(fed);

  const fedTo: PinType[] = [];
  for (const id of outputs) {
    for (const edge of graph.outgoing.get(pinKey(node.id, id)) || []) {
      const t = inputType(graph, edge.target, String(edge.targetHandle || ''), seen);
      if (t) fedTo.push(t);
    }
  }
  return fedTo.length > 0 ? agreed(fedTo) : null;
}

/**
 * The type a value typed on this unwired input is stored as, or null when the
 * pin takes anything (an `any` pin with no type variable: typed text stays
 * text, a value written another way keeps its own JSON type) or has no JSON
 * literal (execution, an object/list pin with its own editor).
 */
export function pinLiteralType(
  nodeId: string,
  pinId: string,
  nodes: Node<FlowNodeData>[],
  edges: Edge[]
): PinLiteralType | null {
  const graph = graphOf(nodes, edges);
  const node = graph.nodesById.get(nodeId);
  const pin = node ? savedPin(node, pinId, 'input') : undefined;
  if (!node || !pin || pin.type === 'execution') return null;
  // Wait Until's `duration` is a number of seconds/minutes/hours, or the timestamp to wait
  // for when its node says so (the runtime reads it as text then): the node's own setting
  // types the pin.
  if (node.data.nodeType === 'wait_until' && pinId === 'duration' && node.data.effectConfig?.durationType === 'timestamp') {
    return { kind: 'string', from: 'pin' };
  }
  if (pin.type !== 'any') {
    const kind = DECLARED_LITERAL_KINDS[pin.type];
    return kind ? { kind, from: 'pin' } : null;
  }
  const typeVar = typeVarOf(node, pinId, 'input');
  if (!typeVar) return null;
  const resolved = resolveTypeVar(graph, node, typeVar, new Set());
  if (!resolved) return { kind: 'string', from: 'default' };
  const kind = literalKindOfType(resolved);
  return kind ? { kind, from: 'wire' } : null;
}

/** True when a (non per-path) wire feeds this input. */
export function isInputWired(nodeId: string, pinId: string, nodes: Node<FlowNodeData>[], edges: Edge[]): boolean {
  return graphOf(nodes, edges).incoming.has(pinKey(nodeId, pinId));
}

// ---------------------------------------------------------------------------
// Conversion.

export type LiteralConversion =
  | { ok: true; value: JsonValue | undefined }
  | { ok: false; problem: string };

/**
 * Decimal number text, the grammar Python's float() reads (no inf/nan, no
 * digit separators): `5`, `-2.5`, `.5`, `1e3`. Hex/octal forms JavaScript's
 * Number() would also take are not numbers here.
 */
const DECIMAL_NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

function quoted(text: string): string {
  const short = text.length > 40 ? `${text.slice(0, 39)}…` : text;
  return `“${short}”`;
}

/**
 * Parse what was typed in a box into a value of `kind`. Empty text is no
 * value (undefined: the pin has no default). Never guesses: text that is
 * not a value of the kind is a problem, reported in plain words.
 */
export function parseLiteralText(text: string, kind: LiteralKind): LiteralConversion {
  if (kind === 'string') return { ok: true, value: text };
  const t = text.trim();
  if (t === '') return { ok: true, value: undefined };
  if (kind === 'number') {
    if (!DECIMAL_NUMBER.test(t)) return { ok: false, problem: `${quoted(text)} is not a number` };
    const n = Number(t);
    return Number.isFinite(n) ? { ok: true, value: n } : { ok: false, problem: `${quoted(text)} is too large a number` };
  }
  if (kind === 'boolean') {
    const lower = t.toLowerCase();
    if (lower === 'true') return { ok: true, value: true };
    if (lower === 'false') return { ok: true, value: false };
    return { ok: false, problem: `${quoted(text)} is not true or false` };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(t);
  } catch {
    return { ok: false, problem: `${quoted(text)} is not valid JSON` };
  }
  if (kind === 'array') {
    return Array.isArray(parsed)
      ? { ok: true, value: parsed as JsonValue }
      : { ok: false, problem: `${quoted(text)} is not a list ([ … ])` };
  }
  return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
    ? { ok: true, value: parsed as JsonValue }
    : { ok: false, problem: `${quoted(text)} is not a JSON object ({ … })` };
}

/** What a value of each kind is, in words ("… is a number"). */
export const LITERAL_KIND_NOUN: Record<LiteralKind, string> = {
  string: 'text',
  number: 'a number',
  boolean: 'true or false',
  object: 'a JSON object',
  array: 'a list',
};

/**
 * A stored value as a value of `kind`: unchanged when it already is one,
 * converted when the conversion is exact (the text "5" and the number 5, the
 * text "true" and true), a problem otherwise. null stays null.
 */
export function convertLiteral(value: JsonValue, kind: LiteralKind): LiteralConversion {
  const has = literalKindOfValue(value);
  if (has === null || has === kind) return { ok: true, value };
  if (typeof value === 'string') return parseLiteralText(value, kind);
  if (kind === 'string' && (has === 'number' || has === 'boolean')) return { ok: true, value: String(value) };
  return { ok: false, problem: `${literalText(value)} is ${LITERAL_KIND_NOUN[has]}, not ${LITERAL_KIND_NOUN[kind]}` };
}

/** The text a stored value shows in its box. */
export function literalText(value: JsonValue | undefined): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

/** Why the value stored on this unwired input is not of the type it takes, or null. */
export function pinLiteralProblem(
  nodeId: string,
  pinId: string,
  nodes: Node<FlowNodeData>[],
  edges: Edge[]
): string | null {
  const defaults = graphOf(nodes, edges).nodesById.get(nodeId)?.data.pinDefaults;
  if (!defaults || !Object.prototype.hasOwnProperty.call(defaults, pinId)) return null;
  if (isInputWired(nodeId, pinId, nodes, edges)) return null;
  const literalType = pinLiteralType(nodeId, pinId, nodes, edges);
  if (!literalType || literalType.from === 'default') return null;
  const conversion = convertLiteral(defaults[pinId], literalType.kind);
  return conversion.ok ? null : conversion.problem;
}

/** One value loadFlow (or a rewire) converted to its pin's type. */
export type RetypedLiteral = { nodeId: string; pinId: string; kind: LiteralKind };

/**
 * The same nodes with every stored value on an unwired, typed input converted
 * to that input's type where the conversion is exact (unchanged nodes keep
 * their identity; no change returns `nodes` itself). Values that do not
 * convert are left as typed: `pinLiteralProblem` flags them.
 */
export function typePinLiterals(
  nodes: Node<FlowNodeData>[],
  edges: Edge[]
): { nodes: Node<FlowNodeData>[]; retyped: RetypedLiteral[] } {
  const retyped: RetypedLiteral[] = [];
  let changed = false;
  const next = nodes.map((node) => {
    const defaults = node.data.pinDefaults;
    if (!defaults || !Array.isArray(node.data.inputs)) return node;
    let nextDefaults: Record<string, JsonValue> | null = null;
    for (const pin of node.data.inputs) {
      if (!Object.prototype.hasOwnProperty.call(defaults, pin.id)) continue;
      if (isInputWired(node.id, pin.id, nodes, edges)) continue;
      const literalType = pinLiteralType(node.id, pin.id, nodes, edges);
      if (!literalType || literalType.from === 'default') continue;
      const value = defaults[pin.id];
      const conversion = convertLiteral(value, literalType.kind);
      if (!conversion.ok || conversion.value === value) continue;
      nextDefaults = nextDefaults || { ...defaults };
      if (conversion.value === undefined) delete nextDefaults[pin.id];
      else nextDefaults[pin.id] = conversion.value;
      retyped.push({ nodeId: node.id, pinId: pin.id, kind: literalType.kind });
    }
    if (!nextDefaults) return node;
    changed = true;
    return { ...node, data: { ...node.data, pinDefaults: nextDefaults } };
  });
  return { nodes: changed ? next : nodes, retyped };
}

/** `typePinLiterals` for callers that only need the nodes. */
export function withTypedPinLiterals(nodes: Node<FlowNodeData>[], edges: Edge[]): Node<FlowNodeData>[] {
  return typePinLiterals(nodes, edges).nodes;
}

/** The notice after a load that converted stored values to their pins' types, or null. */
export function retypedLiteralsNotice(retyped: RetypedLiteral[], nodes: Node<FlowNodeData>[], limit = 5): string | null {
  if (retyped.length === 0) return null;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const shown = retyped.slice(0, limit).map((r) => {
    const node = byId.get(r.nodeId);
    const label = node?.data.label?.trim() || r.nodeId;
    const pinLabel = node?.data.inputs.find((p) => p.id === r.pinId)?.label || r.pinId;
    return `${label} ${pinLabel} → ${LITERAL_KIND_LABEL[r.kind]}`;
  });
  if (retyped.length > limit) shown.push(`… ${retyped.length - limit} more`);
  const n = retyped.length;
  return `${n} typed value${n === 1 ? ' now takes' : 's now take'} the type of ${n === 1 ? 'its' : 'their'} input (${shown.join('; ')}). Save to keep ${n === 1 ? 'it' : 'them'}.`;
}
