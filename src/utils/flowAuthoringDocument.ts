/**
 * Direct JSON workflow authoring: document format, serializer, and diff
 * compiler.
 *
 * The authoring assistant reads and writes ONE representation of the
 * workflow — the authoring document. `flowToAuthoringDocument` serializes the
 * current graph into that document for the prompt; the model emits the
 * complete document back; `diffAuthoringDocument` compiles the emitted
 * document into the existing validated command batch
 * (`applyFlowAuthoringCommands`), so every validator, canonicalization
 * (exec fan-out, route overrides, loop-back removal) and security guard stays
 * the single source of truth for graph mutation.
 *
 * Ownership semantics (the contract shown to the model):
 * - Nodes and edges are document-owned: anything absent from the document is
 *   removed (omission = deletion; "remove manually" cannot happen).
 * - `pin_defaults` merge per key (there is no unset command; forcing full
 *   re-emission would invite accidental data loss).
 * - Positions are editor-owned: existing nodes never move; new nodes without
 *   an explicit position get execution-depth auto-layout.
 * - Redacted secrets round-trip as the literal '<redacted>' sentinel which the
 *   diff always skips, so an echoed document can never destroy a real secret.
 *
 * Round-trip invariant: diffing a freshly serialized document against the
 * same flow MUST produce zero commands — otherwise idempotent re-emits would
 * masquerade as progress and defeat the stall guard.
 */

import type { FlowNodeData, JsonValue, NodeType, Pin, VisualFlow } from '../types/flow';
import { getAllNodeTemplates, getNodeTemplate, type NodeTemplate } from '../types/nodes';
import { isCanonicalPinType } from './flowAuthoringCommands';

export interface AuthoringPinSpec {
  id: string;
  type: string;
  label?: string;
  description?: string;
  /** Optional JSON-schema fragment (x-abstract-type/items) for boundary pins (e.g. array of file). */
  schema?: Record<string, unknown>;
}

export interface AuthoringDocumentNode {
  id: string;
  type: string;
  /** Palette variant (templateLabel) when the node type has several templates. */
  template?: string;
  label?: string;
  /** Optional explicit position; omitted positions are editor-managed. */
  position?: { x: number; y: number };
  /** Defaults for unconnected input pins; merged per key. */
  pin_defaults?: Record<string, JsonValue>;
  /** literalValue (literal nodes, tools_allowlist names array, var_decl {name,type,default}). */
  literal?: JsonValue;
  /** Code node body (Python, body only). */
  code?: string;
  function_name?: string;
  /** Full data-input pin list for dynamic-input nodes (On Flow End, Concat, String Template, Build JSON). */
  inputs?: AuthoringPinSpec[];
  /** Full data-output pin list for dynamic-output nodes (On Flow Start, Break Object). */
  outputs?: AuthoringPinSpec[];
  /** Switch node cases. */
  switch_cases?: { id?: string; value: string }[];
  /** Sequence/Parallel execution branch count. */
  branch_count?: number;
  /** Event node settings (on_event / on_agent_message / on_schedule). */
  event?: Record<string, JsonValue>;
  /** Tool Parameters node: selected tool name. */
  tool?: string;
  /** Tool Parameters node: parameter pin schema {name: {type, label?, description?}}. */
  tool_parameters?: Record<string, JsonValue>;
  concat_separator?: string;
  /** Read-only context (Properties-panel owned); the diff ignores these. */
  agent_config?: Record<string, JsonValue>;
  effect_config?: Record<string, JsonValue>;
  /**
   * Subflow node: the saved workflow this node executes (AUTHORABLE — the
   * composition seam). The diff resolves it against the saved-workflow list
   * and refuses unknown references loudly with suggestions.
   */
  subflow_ref?: string;
  /** Legacy read-only spelling; accepted on parse as an alias of subflow_ref. */
  subflow_id?: string;
  /** Read-only: the referenced workflow's boundary interface (serializer-only). */
  subflow_interface?: { inputs: AuthoringPinSpec[]; outputs: AuthoringPinSpec[] };
}

export interface AuthoringDocument {
  flow_name: string;
  nodes: AuthoringDocumentNode[];
  /** Edge list as "sourceNode.sourcePin -> targetNode.targetPin" strings. */
  edges: string[];
  /**
   * Deletion confirmation: when a document omits MANY existing nodes at once
   * (a truncation-shaped emission), the diff refuses the implied mass
   * deletion unless the ids are explicitly confirmed here.
   */
  confirm_deletions?: string[];
}

export interface AuthoringDocumentDiff {
  commands: unknown[];
  /** Document-level issues (malformed edges, type changes, unknown references). */
  errors: string[];
}

/** Context the diff needs to resolve cross-workflow references. */
export interface AuthoringDiffContext {
  /** Saved workflows the editor knows about (id + name), for subflow_ref resolution. */
  savedFlows?: { id: string; name: string }[];
  /** Full graphs of saved workflows, when already fetched (enables cycle checks + pin patching downstream). */
  resolvedSubflows?: Map<string, VisualFlow>;
  /** The current flow's saved id (drafts have none). Used to refuse self-reference. */
  currentFlowId?: string | null;
}

const DYNAMIC_INPUT_NODE_TYPES = new Set<string>(['on_flow_end', 'concat', 'string_template', 'make_object']);
const DYNAMIC_OUTPUT_NODE_TYPES = new Set<string>(['on_flow_start', 'break_object']);
const EVENT_CONFIG_NODE_TYPES = new Set<string>(['on_event', 'on_agent_message', 'on_schedule']);
const BRANCH_COUNT_NODE_TYPES = new Set<string>(['sequence', 'parallel']);

const SECRET_KEY_PATTERN = /(api[_-]?key|token|password|secret|credential|bearer|authorization)/i;
const SECRET_VALUE_PATTERN = /(sk-[A-Za-z0-9_-]{16,}|agw_[A-Za-z0-9_-]{16,}|Bearer\s+[A-Za-z0-9._-]{16,})/i;
const REDACTED_SENTINEL = '<redacted>';

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function cleanText(value: unknown, maxLen = 300): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLen) : '';
}

/** Deterministic JSON text (sorted object keys) for deep value comparison. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
}

function deepEqual(a: unknown, b: unknown): boolean {
  return stableStringify(a) === stableStringify(b);
}

function redactValue(value: JsonValue, key = ''): JsonValue {
  if (SECRET_KEY_PATTERN.test(key)) return REDACTED_SENTINEL;
  if (typeof value === 'string') return SECRET_VALUE_PATTERN.test(value) ? REDACTED_SENTINEL : value;
  if (Array.isArray(value)) return value.map((item, index) => redactValue(item, `${key}.${index}`));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, childValue]) => [
        childKey,
        redactValue(childValue, key ? `${key}.${childKey}` : childKey),
      ])
    );
  }
  return value;
}

/** True when a document value is (or contains only) the redaction sentinel — never write it back. */
function isRedacted(value: unknown): boolean {
  return value === REDACTED_SENTINEL;
}

/**
 * Resolve the palette template a node was instantiated from. Node data does
 * not store the template label, so resolution goes: unique type match, then
 * icon match, then template-pin subset match, then the type's base template.
 */
export function resolveNodeTemplate(nodeType: string, data: Pick<FlowNodeData, 'icon' | 'inputs' | 'outputs'>): NodeTemplate | undefined {
  const candidates = getAllNodeTemplates().filter((template) => template.type === nodeType);
  if (candidates.length === 0) return undefined;
  if (candidates.length === 1) return candidates[0];
  const byIcon = candidates.filter((template) => template.icon === data.icon);
  if (byIcon.length === 1) return byIcon[0];
  const pinIds = new Set([
    ...(data.inputs || []).map((pin) => `in:${pin.id}`),
    ...(data.outputs || []).map((pin) => `out:${pin.id}`),
  ]);
  const byPins = candidates.filter((template) =>
    template.inputs.every((pin) => pinIds.has(`in:${pin.id}`)) &&
    template.outputs.every((pin) => pinIds.has(`out:${pin.id}`))
  );
  if (byPins.length >= 1) return byPins[0];
  return getNodeTemplate(nodeType as NodeType) || candidates[0];
}

function visibleTemplateCount(nodeType: string): number {
  return getAllNodeTemplates().filter(
    (template) => template.type === nodeType && !template.hiddenInPalette && !template.deprecated
  ).length;
}

function pinSpec(pin: Pin): AuthoringPinSpec {
  const spec: AuthoringPinSpec = { id: pin.id, type: pin.type };
  if (pin.label && pin.label !== pin.id) spec.label = pin.label;
  if (pin.description) spec.description = pin.description;
  if (pin.schema && Object.keys(pin.schema).length > 0) {
    spec.schema = JSON.parse(JSON.stringify(pin.schema)) as Record<string, unknown>;
  }
  return spec;
}

function dataPins(pins: Pin[] | undefined): Pin[] {
  return (pins || []).filter((pin) => pin.type !== 'execution');
}

function jsonRecord(value: unknown): Record<string, JsonValue> | undefined {
  const record = asRecord(value);
  if (!record || Object.keys(record).length === 0) return undefined;
  return JSON.parse(JSON.stringify(record)) as Record<string, JsonValue>;
}

export function flowToAuthoringDocument(flow: VisualFlow): AuthoringDocument {
  const nodes = flow.nodes.map((node): AuthoringDocumentNode => {
    const data = node.data;
    const nodeType = String(data.nodeType || node.type);
    const template = resolveNodeTemplate(nodeType, data);
    const doc: AuthoringDocumentNode = { id: node.id, type: nodeType };
    if (template && visibleTemplateCount(nodeType) > 1) doc.template = template.label;
    if (data.label) doc.label = data.label;

    if (data.pinDefaults && Object.keys(data.pinDefaults).length > 0) {
      doc.pin_defaults = redactValue(data.pinDefaults as JsonValue, '') as Record<string, JsonValue>;
    }
    if (data.literalValue !== undefined) {
      doc.literal = redactValue(data.literalValue, 'literal');
    }
    if (nodeType === 'code') {
      if (typeof data.codeBody === 'string') doc.code = data.codeBody;
      if (data.functionName) doc.function_name = data.functionName;
    }
    if (nodeType === 'concat' && data.concatConfig?.separator !== undefined) {
      doc.concat_separator = data.concatConfig.separator;
    }
    if (DYNAMIC_INPUT_NODE_TYPES.has(nodeType)) {
      doc.inputs = dataPins(data.inputs).map(pinSpec);
    }
    if (DYNAMIC_OUTPUT_NODE_TYPES.has(nodeType)) {
      doc.outputs = dataPins(data.outputs).map(pinSpec);
    }
    if (nodeType === 'switch') {
      doc.switch_cases = (data.switchConfig?.cases || []).map((item) => ({ id: item.id, value: item.value }));
    }
    if (BRANCH_COUNT_NODE_TYPES.has(nodeType)) {
      doc.branch_count = (data.outputs || []).filter((pin) => /^then:\d+$/.test(pin.id)).length;
    }
    if (EVENT_CONFIG_NODE_TYPES.has(nodeType)) {
      const event = jsonRecord(data.eventConfig);
      if (event) doc.event = redactValue(event, 'event') as Record<string, JsonValue>;
    }
    if (nodeType === 'tool_parameters') {
      if (data.toolParametersConfig?.tool) doc.tool = data.toolParametersConfig.tool;
      const params: Record<string, JsonValue> = {};
      for (const pin of dataPins(data.inputs)) {
        const entry: Record<string, JsonValue> = { type: pin.type };
        if (pin.label && pin.label !== pin.id) entry.label = pin.label;
        if (pin.description) entry.description = pin.description;
        params[pin.id] = entry;
      }
      if (Object.keys(params).length > 0) doc.tool_parameters = params;
    }
    // Read-only context for the model (no authoring command writes these).
    const agentConfig = jsonRecord(data.agentConfig);
    if (agentConfig) doc.agent_config = redactValue(agentConfig, 'agent_config') as Record<string, JsonValue>;
    const effectConfig = jsonRecord(data.effectConfig);
    if (effectConfig) doc.effect_config = redactValue(effectConfig, 'effect_config') as Record<string, JsonValue>;
    if (nodeType === 'subflow') {
      // subflow_ref is AUTHORABLE (composition seam); the interface block is
      // serializer-only context so the model knows which edges are legal
      // into/out of this node (subflow pins are patched from the child flow
      // and are not dynamic-pin authorable).
      if (data.subflowId) doc.subflow_ref = data.subflowId;
      const interfaceInputs = dataPins(data.inputs).filter((pin) => pin.id !== 'inherit_context' && pin.id !== 'inheritContext');
      const interfaceOutputs = dataPins(data.outputs);
      if (interfaceInputs.length > 0 || interfaceOutputs.length > 0) {
        doc.subflow_interface = {
          inputs: interfaceInputs.map(pinSpec),
          outputs: interfaceOutputs.map(pinSpec),
        };
      }
    }
    return doc;
  });

  const edges = flow.edges.map((edge) => `${edge.source}.${edge.sourceHandle} -> ${edge.target}.${edge.targetHandle}`);
  return { flow_name: flow.name, nodes, edges };
}

/** Prompt-facing rendering of the current workflow document. */
export function authoringDocumentText(flow: VisualFlow): string {
  return JSON.stringify(flowToAuthoringDocument(flow), null, 1);
}

// ---------------------------------------------------------------------------
// Document normalization (tolerant parsing of the model-emitted document)
// ---------------------------------------------------------------------------

function firstDefined(record: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (record[key] !== undefined) return record[key];
  }
  return undefined;
}

function pinSpecsFrom(raw: unknown): AuthoringPinSpec[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: AuthoringPinSpec[] = [];
  for (const item of raw) {
    if (typeof item === 'string' && item.trim()) {
      // Accept "name:type" or bare "name" shorthand.
      const text = item.trim();
      const colon = text.lastIndexOf(':');
      if (colon > 0) out.push({ id: text.slice(0, colon).trim(), type: text.slice(colon + 1).trim() || 'string' });
      else out.push({ id: text, type: 'string' });
      continue;
    }
    const record = asRecord(item);
    if (!record) continue;
    const id = cleanText(firstDefined(record, ['id', 'pin', 'name', 'path']), 120);
    if (!id) continue;
    const type = cleanText(firstDefined(record, ['type', 'pinType', 'pin_type']), 40) || 'string';
    const spec: AuthoringPinSpec = { id, type };
    const label = cleanText(record.label, 120);
    if (label) spec.label = label;
    const description = cleanText(record.description, 600);
    if (description) spec.description = description;
    const schema = asRecord(record.schema);
    if (schema && Object.keys(schema).length > 0) spec.schema = schema;
    out.push(spec);
  }
  return out;
}

interface NormalizedDocument {
  flowName: string;
  nodes: AuthoringDocumentNode[];
  edges: { source: string; sourceHandle: string; target: string; targetHandle: string }[];
  confirmDeletions: Set<string>;
  errors: string[];
}

/**
 * Parse one edge endpoint ("node.pin"). Node ids and pin ids may both contain
 * dots, so the split prefers the longest known node id prefix; only when no
 * known id matches does it fall back to the first dot.
 */
export function parseEdgeEndpoint(raw: string, knownNodeIds: Set<string>): { node: string; handle: string } | null {
  const text = raw.trim();
  if (!text) return null;
  let bestNode = '';
  for (const id of knownNodeIds) {
    if (text.startsWith(`${id}.`) && id.length > bestNode.length) bestNode = id;
  }
  if (bestNode) return { node: bestNode, handle: text.slice(bestNode.length + 1) };
  const dot = text.indexOf('.');
  if (dot <= 0 || dot === text.length - 1) return null;
  return { node: text.slice(0, dot), handle: text.slice(dot + 1) };
}

function normalizeDocument(raw: unknown, currentNodeIds: Set<string>): NormalizedDocument {
  const errors: string[] = [];
  const record = asRecord(raw);
  if (!record) {
    return { flowName: '', nodes: [], edges: [], confirmDeletions: new Set(), errors: ['graph document must be a JSON object'] };
  }
  const flowName = cleanText(firstDefined(record, ['flow_name', 'flowName', 'name']), 120);
  const confirmDeletions = new Set<string>(
    (Array.isArray(record.confirm_deletions) ? record.confirm_deletions : [])
      .map((item) => cleanText(item, 120))
      .filter(Boolean)
  );

  const nodes: AuthoringDocumentNode[] = [];
  const rawNodes = Array.isArray(record.nodes) ? record.nodes : [];
  if (!Array.isArray(record.nodes)) errors.push('graph document is missing a nodes array');
  for (const item of rawNodes) {
    const nodeRecord = asRecord(item);
    if (!nodeRecord) {
      errors.push('graph document contains a non-object node entry');
      continue;
    }
    // Ids are IDENTITIES: truncating one silently makes the node look new and
    // the original deleted (phantom rename). Refuse loudly instead.
    const rawId = typeof nodeRecord.id === 'string' ? nodeRecord.id.trim() : '';
    if (rawId.length > 120) {
      errors.push(`graph node id exceeds 120 characters ("${rawId.slice(0, 40)}…") — node ids are identities and are never truncated`);
      continue;
    }
    const id = rawId;
    const type = cleanText(firstDefined(nodeRecord, ['type', 'nodeType', 'node_type']), 80);
    if (!id || !type) {
      errors.push(`graph node missing id or type (${id || type || 'unknown'})`);
      continue;
    }
    if (nodes.some((existing) => existing.id === id)) {
      // Duplicate ids are a classic LLM emission defect; "healing" the second
      // copy via rename created phantom nodes the next cycle then deleted.
      errors.push(`graph document contains duplicate node id "${id}" — every node id must be unique`);
      continue;
    }
    const node: AuthoringDocumentNode = { id, type };
    const template = cleanText(firstDefined(nodeRecord, ['template', 'templateLabel', 'template_label']), 120);
    if (template) node.template = template;
    const label = cleanText(nodeRecord.label, 120);
    if (label) node.label = label;
    const position = asRecord(nodeRecord.position);
    if (position && typeof position.x === 'number' && typeof position.y === 'number'
      && Number.isFinite(position.x) && Number.isFinite(position.y)) {
      node.position = { x: position.x, y: position.y };
    }
    const pinDefaults = asRecord(firstDefined(nodeRecord, ['pin_defaults', 'pinDefaults', 'defaults']));
    if (pinDefaults) node.pin_defaults = pinDefaults as Record<string, JsonValue>;
    const literal = firstDefined(nodeRecord, ['literal', 'literalValue', 'literal_value']);
    if (literal !== undefined) node.literal = literal as JsonValue;
    const code = firstDefined(nodeRecord, ['code', 'codeBody', 'code_body']);
    if (typeof code === 'string') node.code = code;
    const functionName = cleanText(firstDefined(nodeRecord, ['function_name', 'functionName']), 120);
    if (functionName) node.function_name = functionName;
    const inputs = pinSpecsFrom(nodeRecord.inputs);
    if (inputs) node.inputs = inputs;
    const outputs = pinSpecsFrom(nodeRecord.outputs);
    if (outputs) node.outputs = outputs;
    const rawCases = firstDefined(nodeRecord, ['switch_cases', 'switchCases', 'cases']);
    if (Array.isArray(rawCases)) {
      node.switch_cases = rawCases
        .map((entry) => {
          if (typeof entry === 'string') return { value: entry.trim() };
          const caseRecord = asRecord(entry);
          const value = cleanText(caseRecord?.value ?? caseRecord?.label, 120);
          const caseId = cleanText(caseRecord?.id, 80);
          return value ? (caseId ? { id: caseId, value } : { value }) : null;
        })
        .filter((entry): entry is { id?: string; value: string } => Boolean(entry));
    }
    const branchCount = firstDefined(nodeRecord, ['branch_count', 'branchCount']);
    if (typeof branchCount === 'number' && Number.isFinite(branchCount)) node.branch_count = Math.floor(branchCount);
    const event = asRecord(firstDefined(nodeRecord, ['event', 'eventConfig', 'event_config']));
    if (event) node.event = event as Record<string, JsonValue>;
    const tool = cleanText(nodeRecord.tool, 160);
    if (tool) node.tool = tool;
    const toolParameters = asRecord(firstDefined(nodeRecord, ['tool_parameters', 'toolParameters', 'parameters']));
    if (toolParameters) node.tool_parameters = toolParameters as Record<string, JsonValue>;
    const separator = firstDefined(nodeRecord, ['concat_separator', 'concatSeparator', 'separator']);
    if (typeof separator === 'string') node.concat_separator = separator;
    const subflowRef = cleanText(
      firstDefined(nodeRecord, ['subflow_ref', 'subflowRef', 'subflow_id', 'subflowId', 'workflow_id', 'workflowId']),
      160
    );
    if (subflowRef) node.subflow_ref = subflowRef;
    nodes.push(node);
  }

  const knownIds = new Set<string>([...currentNodeIds, ...nodes.map((node) => node.id)]);
  const edges: NormalizedDocument['edges'] = [];
  const rawEdges = Array.isArray(record.edges) ? record.edges : [];
  if (!Array.isArray(record.edges)) errors.push('graph document is missing an edges array');
  for (const item of rawEdges) {
    if (typeof item === 'string') {
      const split = item.split(/\s*(?:->|→)\s*/);
      if (split.length !== 2) {
        errors.push(`graph edge "${item}" must use the form "node.pin -> node.pin"`);
        continue;
      }
      const source = parseEdgeEndpoint(split[0], knownIds);
      const target = parseEdgeEndpoint(split[1], knownIds);
      if (!source || !target) {
        errors.push(`graph edge "${item}" has an invalid endpoint (expected node.pin)`);
        continue;
      }
      edges.push({ source: source.node, sourceHandle: source.handle, target: target.node, targetHandle: target.handle });
      continue;
    }
    const edgeRecord = asRecord(item);
    if (!edgeRecord) {
      errors.push('graph document contains a non-string, non-object edge entry');
      continue;
    }
    const fromText = cleanText(firstDefined(edgeRecord, ['from', 'source']), 240);
    const toText = cleanText(firstDefined(edgeRecord, ['to', 'target']), 240);
    const sourceHandle = cleanText(firstDefined(edgeRecord, ['sourceHandle', 'source_handle']), 120);
    const targetHandle = cleanText(firstDefined(edgeRecord, ['targetHandle', 'target_handle']), 120);
    const source = sourceHandle
      ? { node: fromText, handle: sourceHandle }
      : parseEdgeEndpoint(fromText, knownIds);
    const target = targetHandle
      ? { node: toText, handle: targetHandle }
      : parseEdgeEndpoint(toText, knownIds);
    if (!source?.node || !source.handle || !target?.node || !target.handle) {
      errors.push(`graph edge object ${JSON.stringify(item).slice(0, 120)} is missing endpoints`);
      continue;
    }
    edges.push({ source: source.node, sourceHandle: source.handle, target: target.node, targetHandle: target.handle });
  }

  return { flowName, nodes, edges, confirmDeletions, errors };
}

// ---------------------------------------------------------------------------
// Auto-layout for new nodes
// ---------------------------------------------------------------------------

const LAYOUT_COLUMN_WIDTH = 320;
const LAYOUT_ROW_HEIGHT = 160;

/**
 * Execution-depth auto-layout for new nodes without explicit positions.
 * Depth = longest path from document roots over document edges; new nodes are
 * placed column-by-depth, row-by-arrival, below the existing graph so the
 * user's layout never shifts.
 */
function autoLayoutPositions(
  document: NormalizedDocument,
  newNodeIds: string[],
  existingNodes: VisualFlow['nodes']
): Map<string, { x: number; y: number }> {
  const docNodeIds = new Set(document.nodes.map((node) => node.id));
  const depth = new Map<string, number>();
  for (const id of docNodeIds) depth.set(id, 0);
  // Longest-path layering with a bounded relaxation count (cycles cannot spin).
  for (let pass = 0; pass < document.nodes.length + 1; pass += 1) {
    let changed = false;
    for (const edge of document.edges) {
      if (!docNodeIds.has(edge.source) || !docNodeIds.has(edge.target)) continue;
      const next = (depth.get(edge.source) ?? 0) + 1;
      if (next > (depth.get(edge.target) ?? 0) && next <= document.nodes.length) {
        depth.set(edge.target, next);
        changed = true;
      }
    }
    if (!changed) break;
  }
  const baseX = 80;
  const baseY = existingNodes.length > 0
    ? Math.max(...existingNodes.map((node) => node.position?.y ?? 0)) + LAYOUT_ROW_HEIGHT + 80
    : 80;
  const rowsPerDepth = new Map<number, number>();
  const positions = new Map<string, { x: number; y: number }>();
  for (const id of newNodeIds) {
    const column = depth.get(id) ?? 0;
    const row = rowsPerDepth.get(column) ?? 0;
    rowsPerDepth.set(column, row + 1);
    positions.set(id, { x: baseX + column * LAYOUT_COLUMN_WIDTH, y: baseY + row * LAYOUT_ROW_HEIGHT });
  }
  return positions;
}

// ---------------------------------------------------------------------------
// Diff compiler
// ---------------------------------------------------------------------------

function pinDefaultsCommands(
  nodeId: string,
  docDefaults: Record<string, JsonValue> | undefined,
  currentDefaults: Record<string, JsonValue>
): unknown[] {
  const commands: unknown[] = [];
  for (const [pin, value] of Object.entries(docDefaults || {})) {
    if (isRedacted(value)) continue; // Round-tripped redaction; never write back.
    if (deepEqual(currentDefaults[pin], value)) continue;
    // A verbatim re-emit of a default containing NESTED redacted values
    // (e.g. headers.Authorization) matches the REDACTED current, not the
    // raw one — without this compare the diff emitted an unappliable
    // set_pin_default every cycle (round-trip invariant violation).
    if (deepEqual(redactValue(currentDefaults[pin] ?? null, pin), value)) continue;
    commands.push({ action: 'set_pin_default', nodeId, pin, value });
  }
  return commands;
}

function templateForDocNode(node: AuthoringDocumentNode): NodeTemplate | undefined {
  const candidates = getAllNodeTemplates().filter((template) => template.type === node.type);
  if (candidates.length === 0) return undefined;
  if (node.template) {
    const exact = candidates.find((template) => template.label.toLowerCase() === node.template?.toLowerCase());
    if (exact) return exact;
  }
  return getNodeTemplate(node.type as NodeType) || candidates[0];
}

/** Pin-list diff for dynamic-pin nodes: additions, removals, and in-place updates against a base pin list. */
function dynamicPinCommands(
  nodeId: string,
  side: 'input' | 'output',
  docPins: AuthoringPinSpec[] | undefined,
  basePins: Pin[]
): unknown[] {
  if (docPins === undefined) return []; // Field omitted entirely: keep current pins (merge semantics).
  const commands: unknown[] = [];
  const docIds = new Set(docPins.map((pin) => pin.id));
  const baseDataPins = basePins.filter((pin) => pin.type !== 'execution');
  const baseIds = new Map(baseDataPins.map((pin) => [pin.id, pin]));
  for (const pin of docPins) {
    const existing = baseIds.get(pin.id);
    if (existing) {
      // Same id, changed shape: retype/redoc IN PLACE. The previous contract
      // (id-only diff) silently ignored type changes, making the documented
      // "change the pin type" repair unimplementable — the model re-emitted
      // the pin, zero commands compiled, and the turn stalled.
      // Non-canonical doc spellings ("text") are NOT type changes: apply's
      // inference would fall back to the existing type anyway, so emitting
      // update_pin for them just logs phantom motion every cycle.
      const typeChanged = isCanonicalPinType(pin.type) && pin.type !== existing.type;
      // Clamp the current side like the normalizer clamps the doc side, so a
      // re-emitted long description never compiles a spurious update_pin
      // (truncation-asymmetry class).
      const descriptionChanged =
        pin.description !== undefined && pin.description !== cleanText(existing.description || '', 600);
      const schemaChanged = pin.schema !== undefined && !deepEqual(pin.schema, existing.schema ?? {});
      if (typeChanged || descriptionChanged || schemaChanged) {
        commands.push({
          action: 'update_pin',
          nodeId,
          id: pin.id,
          side,
          ...(typeChanged ? { pinType: pin.type } : {}),
          ...(pin.label ? { label: pin.label } : {}),
          ...(descriptionChanged ? { description: pin.description } : {}),
          ...(schemaChanged ? { schema: pin.schema } : {}),
        });
      }
      continue;
    }
    commands.push({
      action: side === 'input' ? 'add_input_pin' : 'add_output_pin',
      nodeId,
      id: pin.id,
      ...(pin.label ? { label: pin.label } : {}),
      pinType: pin.type,
      ...(pin.description ? { description: pin.description } : {}),
      ...(pin.schema ? { schema: pin.schema } : {}),
    });
  }
  for (const pin of baseDataPins) {
    if (docIds.has(pin.id)) continue;
    commands.push({ action: 'remove_pin', nodeId, id: pin.id, side });
  }
  return commands;
}

function switchCasesEqual(
  docCases: { id?: string; value: string }[],
  currentCases: { id: string; value: string }[]
): boolean {
  if (docCases.length !== currentCases.length) return false;
  return docCases.every((docCase, index) => {
    const current = currentCases[index];
    // Compare against the CLAMPED current value: the serializer emits canvas
    // content in full while the normalizer clamps the doc side, so a
    // byte-faithful re-emission of a long case value must read as equal —
    // not compile a set_switch_cases that clobbers the runtime value
    // (adversary P1: round-trip truncation asymmetry).
    if (docCase.value !== cleanText(current.value, 120)) return false;
    return !docCase.id || docCase.id === current.id;
  });
}

function eventConfigCommands(
  nodeId: string,
  docEvent: Record<string, JsonValue> | undefined,
  currentEvent: Record<string, unknown>
): unknown[] {
  if (!docEvent) return [];
  const changed: Record<string, JsonValue> = {};
  for (const key of ['name', 'scope', 'channel', 'agentFilter', 'schedule', 'recurrent', 'description'] as const) {
    const docValue = docEvent[key] ?? (key === 'agentFilter' ? docEvent.agent_filter : undefined);
    if (docValue === undefined) continue;
    if (isRedacted(docValue)) continue; // Round-tripped redaction; never write back.
    if (deepEqual(currentEvent[key], docValue)) continue;
    if (deepEqual(redactValue((currentEvent[key] ?? null) as JsonValue, key), docValue)) continue;
    changed[key] = docValue;
  }
  if (Object.keys(changed).length === 0) return [];
  return [{ action: 'set_event_config', nodeId, ...changed }];
}

function toolParametersEqual(node: AuthoringDocumentNode, data: FlowNodeData): boolean {
  const currentTool = data.toolParametersConfig?.tool || '';
  if ((node.tool || '') !== currentTool) return false;
  if (!node.tool_parameters) return true; // Parameters omitted: keep current pins.
  const currentPins = dataPins(data.inputs);
  const docNames = Object.keys(node.tool_parameters);
  if (docNames.length !== currentPins.length) return false;
  const currentById = new Map(currentPins.map((pin) => [pin.id, pin]));
  return docNames.every((name) => {
    const current = currentById.get(name);
    if (!current) return false;
    // Name-only compare made a documented parameter TYPE change compile to
    // zero commands (the same unimplementable-repair class fixed for dynamic
    // pins and break paths).
    const spec = asRecord(node.tool_parameters?.[name]);
    const docType = spec && typeof spec.type === 'string' ? spec.type : undefined;
    return docType === undefined || docType === current.type;
  });
}

function breakPathsFromSpecs(specs: AuthoringPinSpec[]): unknown[] {
  return specs.map((pin) => ({
    path: pin.id,
    ...(pin.label ? { label: pin.label } : {}),
    pinType: pin.type,
  }));
}

/** Commands that configure a node's type-specific structure (shared by create and update paths). */
function nodeStructureCommands(
  node: AuthoringDocumentNode,
  current: { data: FlowNodeData } | null,
  basePins: { inputs: Pin[]; outputs: Pin[] }
): unknown[] {
  const commands: unknown[] = [];
  if (node.type === 'break_object') {
    if (node.outputs !== undefined) {
      const currentDataPins = dataPins(basePins.outputs);
      const currentOutputs = currentDataPins.map((pin) => pin.id);
      const docOutputs = node.outputs.map((pin) => pin.id);
      // Type changes on same-id paths must also re-emit (the documented
      // "change the pin type" repair — an id-only compare made it a no-op).
      // Non-canonical doc spellings are not type changes (see dynamic pins).
      const typeChanged = node.outputs.some((spec) => {
        const current = currentDataPins.find((pin) => pin.id === spec.id);
        return current !== undefined && isCanonicalPinType(spec.type) && current.type !== spec.type;
      });
      if ((!deepEqual(docOutputs, currentOutputs) || typeChanged) && node.outputs.length > 0) {
        commands.push({ action: 'set_break_paths', nodeId: node.id, paths: breakPathsFromSpecs(node.outputs) });
      }
    }
  } else {
    if (DYNAMIC_INPUT_NODE_TYPES.has(node.type)) {
      commands.push(...dynamicPinCommands(node.id, 'input', node.inputs, basePins.inputs));
    }
    if (DYNAMIC_OUTPUT_NODE_TYPES.has(node.type)) {
      commands.push(...dynamicPinCommands(node.id, 'output', node.outputs, basePins.outputs));
    }
  }
  if (node.type === 'switch' && node.switch_cases !== undefined) {
    const currentCases = current?.data.switchConfig?.cases || [];
    if (!switchCasesEqual(node.switch_cases, currentCases) && node.switch_cases.length > 0) {
      commands.push({ action: 'set_switch_cases', nodeId: node.id, cases: node.switch_cases });
    }
  }
  if (BRANCH_COUNT_NODE_TYPES.has(node.type) && node.branch_count !== undefined && node.branch_count >= 1) {
    const currentCount = basePins.outputs.filter((pin) => /^then:\d+$/.test(pin.id)).length;
    if (node.branch_count !== currentCount) {
      commands.push({ action: 'set_branch_count', nodeId: node.id, count: node.branch_count });
    }
  }
  if (EVENT_CONFIG_NODE_TYPES.has(node.type)) {
    commands.push(...eventConfigCommands(node.id, node.event, asRecord(current?.data.eventConfig) || {}));
  }
  if (node.type === 'tool_parameters' && node.tool) {
    const equal = current ? toolParametersEqual(node, current.data) : false;
    if (!equal) {
      commands.push({
        action: 'set_tool_parameters',
        nodeId: node.id,
        tool: node.tool,
        ...(node.tool_parameters ? { parameters: node.tool_parameters } : {}),
        ...(node.pin_defaults ? { defaults: node.pin_defaults } : {}),
      });
    }
  }
  return commands;
}

/**
 * Deletion budget: a document omitting MANY existing nodes at once is far
 * more likely a truncated/partial emission than a deliberate teardown
 * (observed failure shape: output-cap truncation at scale). Deliberate mass
 * deletion stays expressible via explicit `confirm_deletions`.
 */
function deletionBudget(currentNodeCount: number): number {
  return Math.max(3, Math.ceil(currentNodeCount * 0.2));
}

/** Subflow ids referenced by a flow's subflow nodes. */
function referencedSubflowIds(flow: VisualFlow): string[] {
  const ids: string[] = [];
  for (const node of flow.nodes) {
    const data = node.data as { nodeType?: unknown; subflowId?: unknown };
    if (data?.nodeType === 'subflow' && typeof data.subflowId === 'string' && data.subflowId.trim()) {
      ids.push(data.subflowId.trim());
    }
  }
  return ids;
}

/**
 * Validate one subflow reference in the assistant lane. Returns an error
 * string (refusal) or null (acceptable). Self-reference and reference cycles
 * are refused HERE deliberately even though the runtime supports designed
 * recursion — an LLM asserting a base case is not evidence of one; the
 * manual Properties-panel path (which labels recursion explicitly) stays
 * available and is named in the refusal.
 */
export function validateSubflowReference(
  ref: string,
  context: AuthoringDiffContext
): string | null {
  const savedFlows = context.savedFlows;
  if (savedFlows && !savedFlows.some((flowSummary) => flowSummary.id === ref)) {
    const byName = savedFlows.find((flowSummary) => flowSummary.name.toLowerCase() === ref.toLowerCase());
    if (byName) {
      return (
        `subflow_ref "${ref}" matches a workflow NAME; reference workflows by their saved id — use "${byName.id}" (${byName.name}).`
      );
    }
    const available = savedFlows.slice(0, 15).map((flowSummary) => `${flowSummary.id} (${flowSummary.name})`).join(', ');
    return (
      `subflow_ref "${ref}" does not match any saved workflow. Available: ${available || 'none'}. ` +
      'Reference a saved workflow id from AVAILABLE WORKFLOWS — or, if the helper does not exist yet, CREATE it in this ' +
      'same emission: add it to the top-level "subflows" array and reference it as "ref:<handle>".'
    );
  }
  if (context.currentFlowId && ref === context.currentFlowId) {
    return (
      `subflow_ref "${ref}" is this workflow itself — a self-reference creates recursion, which needs a designed base ` +
      'case. Wire recursion manually in the Properties panel if intended.'
    );
  }
  // Cycle walk over the graphs we have. Unfetched children end the walk —
  // resolution is best-effort by construction, never a false refusal.
  const resolved = context.resolvedSubflows;
  if (resolved && context.currentFlowId) {
    const target = context.currentFlowId;
    const seen = new Set<string>();
    const path: string[] = [ref];
    const walk = (id: string): boolean => {
      if (id === target) return true;
      if (seen.has(id)) return false;
      seen.add(id);
      const child = resolved.get(id);
      if (!child) return false;
      for (const childRef of referencedSubflowIds(child)) {
        path.push(childRef);
        if (walk(childRef)) return true;
        path.pop();
      }
      return false;
    };
    if (walk(ref)) {
      return (
        `subflow_ref "${ref}" creates a reference cycle back to this workflow (${[target, ...path].join(' -> ')}). ` +
        'Recursive workflows need a designed base case; wire recursion manually in the Properties panel if intended.'
      );
    }
  }
  return null;
}

/**
 * Compile a model-emitted authoring document into the existing command batch.
 * Nodes/edges absent from the document are deleted (full document ownership);
 * pin defaults merge per key; positions of existing nodes are preserved.
 */
export function diffAuthoringDocument(
  flow: VisualFlow,
  rawDocument: unknown,
  context: AuthoringDiffContext = {}
): AuthoringDocumentDiff {
  const currentIds = new Set(flow.nodes.map((node) => node.id));
  const document = normalizeDocument(rawDocument, currentIds);
  const errors = [...document.errors];
  const commands: unknown[] = [];

  if (document.flowName && document.flowName !== flow.name) {
    commands.push({ action: 'set_flow_name', name: document.flowName });
  }

  const currentById = new Map(flow.nodes.map((node) => [node.id, node]));
  const docById = new Map(document.nodes.map((node) => [node.id, node]));

  // Deletions first (computed, emitted last via ordering rank): nodes absent
  // from the document are removed; their edges go with them. Mass deletions
  // beyond the budget require explicit confirmation.
  const deletedNodeIds = new Set<string>();
  const impliedDeletions: string[] = [];
  for (const node of flow.nodes) {
    if (!docById.has(node.id)) impliedDeletions.push(node.id);
  }
  const unconfirmed = impliedDeletions.filter((id) => !document.confirmDeletions.has(id));
  if (impliedDeletions.length > deletionBudget(flow.nodes.length) && unconfirmed.length > 0) {
    // A truncation-shaped document also carries a truncated EDGE list, so
    // applying any of it (deletes, disconnects, "new" duplicates) would
    // corrupt the graph. Refuse the whole batch with the repair instruction.
    return {
      commands: [],
      errors: [
        ...errors,
        `your document omits ${impliedDeletions.length} of ${flow.nodes.length} existing nodes (${impliedDeletions
          .slice(0, 12)
          .join(', ')}${impliedDeletions.length > 12 ? ', …' : ''}). If this mass deletion is intentional, re-emit the ` +
          `same document with "confirm_deletions": [${impliedDeletions.slice(0, 3).map((id) => JSON.stringify(id)).join(', ')}${
            impliedDeletions.length > 3 ? ', …' : ''
          }] listing every omitted node id. If it was accidental (e.g. a truncated document), re-emit the FULL document ` +
          'including those nodes. Nothing was applied.',
      ],
    };
  }
  for (const id of impliedDeletions) {
    deletedNodeIds.add(id);
    commands.push({ action: 'delete_node', nodeId: id });
  }

  // New + changed nodes.
  const newNodeIds = document.nodes.filter((node) => !currentById.has(node.id)).map((node) => node.id);
  const autoPositions = autoLayoutPositions(document, newNodeIds.filter((id) => !docById.get(id)?.position), flow.nodes);

  for (const node of document.nodes) {
    const current = currentById.get(node.id);
    if (!current) {
      const template = templateForDocNode(node);
      const position = node.position || autoPositions.get(node.id);
      const addCommand: Record<string, unknown> = {
        action: 'add_node',
        id: node.id,
        nodeType: node.type,
      };
      if (node.template) addCommand.templateLabel = node.template;
      if (node.label) addCommand.label = node.label;
      if (position) addCommand.position = position;
      if (node.pin_defaults) {
        const cleanDefaults = Object.fromEntries(
          Object.entries(node.pin_defaults).filter(([, value]) => !isRedacted(value))
        );
        if (Object.keys(cleanDefaults).length > 0) addCommand.pinDefaults = cleanDefaults;
      }
      if (node.literal !== undefined && !isRedacted(node.literal)) addCommand.literalValue = node.literal;
      if (node.code !== undefined) addCommand.codeBody = node.code;
      if (node.function_name) addCommand.functionName = node.function_name;
      if (node.concat_separator !== undefined) addCommand.concatSeparator = node.concat_separator;
      commands.push(addCommand);
      const basePins = { inputs: template?.inputs || [], outputs: template?.outputs || [] };
      commands.push(...nodeStructureCommands(node, null, basePins));
      if (node.type === 'subflow' && node.subflow_ref) {
        const refusal = validateSubflowReference(node.subflow_ref, context);
        if (refusal) errors.push(refusal);
        else commands.push({ action: 'set_subflow', nodeId: node.id, subflowId: node.subflow_ref });
      }
      continue;
    }

    const currentType = String(current.data.nodeType || current.type);
    if (node.type !== currentType) {
      errors.push(
        `Node ${node.id} cannot change type from ${currentType} to ${node.type}; node ids are identities — use a new id for the new node and omit the old one to delete it.`
      );
      continue;
    }
    // Clamped compare: the doc label was normalized to <=120 chars while the
    // serializer emits the canvas label in full — a faithful re-emission of a
    // long label must NOT compile a set_label that clobbers it.
    if (node.label && node.label !== cleanText(current.data.label, 120)) {
      commands.push({ action: 'set_label', nodeId: node.id, label: node.label });
    }
    commands.push(
      ...pinDefaultsCommands(node.id, node.pin_defaults, (current.data.pinDefaults || {}) as Record<string, JsonValue>)
    );
    if (node.literal !== undefined && !isRedacted(node.literal)) {
      const currentLiteral = redactValue(current.data.literalValue ?? null, 'literal');
      if (!deepEqual(node.literal, currentLiteral) && !deepEqual(node.literal, current.data.literalValue ?? null)) {
        commands.push({ action: 'set_literal', nodeId: node.id, value: node.literal });
      }
    }
    if (node.type === 'code' && node.code !== undefined && node.code !== (current.data.codeBody ?? '')) {
      commands.push({
        action: 'set_code_body',
        nodeId: node.id,
        codeBody: node.code,
        ...(node.function_name ? { functionName: node.function_name } : {}),
      });
    }
    if (
      node.type === 'concat' &&
      node.concat_separator !== undefined &&
      node.concat_separator !== (current.data.concatConfig?.separator ?? undefined)
    ) {
      commands.push({ action: 'set_concat_separator', nodeId: node.id, separator: node.concat_separator });
    }
    commands.push(
      ...nodeStructureCommands(node, { data: current.data }, {
        inputs: current.data.inputs || [],
        outputs: current.data.outputs || [],
      })
    );
    if (node.type === 'subflow' && node.subflow_ref && node.subflow_ref !== (current.data.subflowId || '')) {
      const refusal = validateSubflowReference(node.subflow_ref, context);
      if (refusal) errors.push(refusal);
      else commands.push({ action: 'set_subflow', nodeId: node.id, subflowId: node.subflow_ref });
    }
  }

  // Edge diff. Removed pins' edges are cleaned by remove_pin itself; deleted
  // nodes' edges are cleaned by delete_node; skip redundant disconnects.
  const removedPins = new Set<string>();
  for (const command of commands) {
    const record = asRecord(command);
    if (record?.action === 'remove_pin') removedPins.add(`${record.nodeId}.${record.id}`);
  }
  const docEdgeKeys = new Set(
    document.edges.map((edge) => `${edge.source}.${edge.sourceHandle}->${edge.target}.${edge.targetHandle}`)
  );
  const currentEdgeKeys = new Set<string>();
  const disconnects: unknown[] = [];
  for (const edge of flow.edges) {
    const key = `${edge.source}.${edge.sourceHandle}->${edge.target}.${edge.targetHandle}`;
    currentEdgeKeys.add(key);
    if (docEdgeKeys.has(key)) continue;
    if (deletedNodeIds.has(edge.source) || deletedNodeIds.has(edge.target)) continue;
    if (removedPins.has(`${edge.source}.${edge.sourceHandle}`) || removedPins.has(`${edge.target}.${edge.targetHandle}`)) continue;
    disconnects.push({
      action: 'disconnect',
      source: edge.source,
      sourceHandle: edge.sourceHandle,
      target: edge.target,
      targetHandle: edge.targetHandle,
    });
  }
  const connects: unknown[] = [];
  const seenDocEdges = new Set<string>();
  const docKnownIds = new Set([...currentIds, ...document.nodes.map((node) => node.id)]);
  for (const edge of document.edges) {
    const key = `${edge.source}.${edge.sourceHandle}->${edge.target}.${edge.targetHandle}`;
    if (seenDocEdges.has(key)) continue;
    seenDocEdges.add(key);
    if (currentEdgeKeys.has(key)) continue;
    if (!docKnownIds.has(edge.source) || !docKnownIds.has(edge.target)) {
      errors.push(`graph edge ${key} references an unknown node`);
      continue;
    }
    if (deletedNodeIds.has(edge.source) || deletedNodeIds.has(edge.target)) {
      errors.push(`graph edge ${key} references node(s) the document no longer contains`);
      continue;
    }
    connects.push({
      action: 'connect',
      source: edge.source,
      sourceHandle: edge.sourceHandle,
      target: edge.target,
      targetHandle: edge.targetHandle,
    });
  }
  // Disconnects must precede connects in emission order: connect/disconnect
  // share an application rank and apply in array order, and a freed data input
  // must release before its replacement edge arrives.
  commands.push(...disconnects, ...connects);

  return { commands, errors };
}
