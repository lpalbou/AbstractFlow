import type { Edge, Node } from 'reactflow';
import type { FlowNodeData, JsonValue, NodeType, Pin, PinType } from '../types/flow';
import { createNodeData, getAllNodeTemplates, getNodeTemplate, type NodeTemplate } from '../types/nodes';
import { getConnectionError, validateConnection } from './validation';

export interface FlowAuthoringSnapshot {
  flowName: string;
  flowInterfaces: string[];
  nodes: Node<FlowNodeData>[];
  edges: Edge[];
}

export interface FlowAuthoringApplyInput {
  flowName: string;
  flowInterfaces: string[];
  nodes: Node<FlowNodeData>[];
  edges: Edge[];
  commands: unknown[];
  allowDestructive?: boolean;
}

export interface FlowAuthoringApplyResult {
  flowName: string;
  flowInterfaces: string[];
  nodes: Node<FlowNodeData>[];
  edges: Edge[];
  applied: string[];
  warnings: string[];
  errors: string[];
  touchedNodeIds: string[];
  snapshot: FlowAuthoringSnapshot;
}

const PIN_TYPES: readonly PinType[] = [
  'execution',
  'string',
  'number',
  'boolean',
  'object',
  'json_schema',
  'artifact',
  'artifact_image',
  'artifact_audio',
  'artifact_text',
  'artifact_video',
  'memory',
  'assertion',
  'assertions',
  'array',
  'tools',
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
  'agent',
  'any',
];

const DYNAMIC_INPUT_NODE_TYPES = new Set<NodeType>(['on_flow_end', 'concat', 'string_template', 'make_object']);
const DYNAMIC_OUTPUT_NODE_TYPES = new Set<NodeType>(['on_flow_start', 'break_object']);
const SECRET_KEY_PATTERN = /(api[_-]?key|token|password|secret|credential|bearer|authorization)/i;
const SECRET_VALUE_PATTERN = /(sk-[A-Za-z0-9_-]{16,}|agw_[A-Za-z0-9_-]{16,}|Bearer\s+[A-Za-z0-9._-]{16,})/i;

function clone<T>(value: T): T {
  try {
    const structured = (globalThis as { structuredClone?: (v: unknown) => unknown }).structuredClone;
    if (typeof structured === 'function') return structured(value) as T;
  } catch {
    // Fall through to JSON clone.
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function isJsonValue(value: unknown, depth = 0): value is JsonValue {
  if (depth > 24) return false;
  if (value === null) return true;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return Number.isFinite(value as number) || typeof value !== 'number';
  }
  if (Array.isArray(value)) return value.every((item) => isJsonValue(item, depth + 1));
  const record = asRecord(value);
  if (!record) return false;
  return Object.entries(record).every(([key, item]) => typeof key === 'string' && isJsonValue(item, depth + 1));
}

function toJsonValue(value: unknown): JsonValue | undefined {
  return isJsonValue(value) ? clone(value) : undefined;
}

function toolNamesFromValue(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const names: string[] = [];
  for (const item of value) {
    if (typeof item === 'string' && item.trim()) {
      names.push(item.trim());
      continue;
    }
    const record = asRecord(item);
    const name = typeof record?.name === 'string' ? record.name.trim() : '';
    if (name) names.push(name);
  }
  return Array.from(new Set(names));
}

function cleanText(value: unknown, maxLen: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLen) : '';
}

function cleanCodeBody(value: unknown): string | null {
  return typeof value === 'string' ? value.replace(/\r\n/g, '\n') : null;
}

function cleanFunctionName(value: unknown): string {
  const name = typeof value === 'string' ? value.trim() : '';
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ? name : 'transform';
}

function normalizeId(raw: unknown, fallback: string): string {
  const value = cleanText(raw, 80) || fallback;
  const normalized = value
    .replace(/[^A-Za-z0-9_.:-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return normalized || fallback;
}

function uniqueId(base: string, used: Set<string>): string {
  if (!used.has(base)) return base;
  let idx = 2;
  while (used.has(`${base}-${idx}`)) idx += 1;
  return `${base}-${idx}`;
}

function resolveNodeId(raw: unknown, idMap: Map<string, string>): string {
  const clean = cleanText(raw, 120);
  return idMap.get(clean) || clean;
}

function pinType(raw: unknown, fallback: PinType): PinType {
  const value = cleanText(raw, 40) as PinType;
  return PIN_TYPES.includes(value) ? value : fallback;
}

function normalizeHandle(raw: unknown): string {
  let value = cleanText(raw, 120);
  if (!value) return '';
  if (value.includes('.')) {
    value = value.slice(value.lastIndexOf('.') + 1);
  }
  const colon = value.lastIndexOf(':');
  if (colon > 0) {
    const suffix = value.slice(colon + 1) as PinType;
    if (PIN_TYPES.includes(suffix)) {
      value = value.slice(0, colon);
    }
  }
  return value;
}

function inferredPinType(id: string, label: string, raw: unknown, fallback: PinType): PinType {
  const explicit = pinType(raw, '__invalid__' as PinType);
  if (explicit !== ('__invalid__' as PinType)) return explicit;
  const haystack = `${id} ${label}`.toLowerCase();
  if (/\b(sources?|citations?|references?|meta|metadata|json|data)\b/.test(haystack)) {
    return 'object';
  }
  if (/\b(trace|audit|summary)\b/.test(haystack)) return 'string';
  if (/\b(count|limit|iterations?|budget|number|score)\b/.test(haystack)) return 'number';
  if (/\b(enabled|disabled|flag|success|boolean)\b/.test(haystack)) return 'boolean';
  return fallback;
}

function normalizeNodeType(raw: unknown): { nodeType: NodeType; requested: string } {
  const requested = cleanText(raw, 80);
  const key = requested.toLowerCase().replace(/[\s-]+/g, '_');
  const aliases: Record<string, NodeType> = {
    build_json: 'make_object',
    build_object: 'make_object',
    json_builder: 'make_object',
    make_json: 'make_object',
    tool_allowlist: 'tools_allowlist',
    tool_allow_list: 'tools_allowlist',
    research_tools: 'tools_allowlist',
    prompt_template: 'string_template',
  };
  return { nodeType: (aliases[key] || requested) as NodeType, requested };
}

function nodeTemplateForCommand(
  nodeType: NodeType,
  command: Record<string, unknown>
): { template?: NodeTemplate; error?: string } {
  const candidates = getAllNodeTemplates().filter((template) => template.type === nodeType);
  const visibleCandidates = candidates.filter((template) => !template.hiddenInPalette && !template.deprecated);
  const fallback = getNodeTemplate(nodeType);

  const variant = cleanText(
    command.templateLabel || command.template_label || command.variant || command.paletteLabel || command.palette_label,
    120
  );

  if (visibleCandidates.length > 1) {
    if (!variant) {
      return {
        error: `add_node refused ambiguous node type '${nodeType}'; include templateLabel (${visibleCandidates.map((template) => template.label).join(', ')})`,
      };
    }
    const exact = visibleCandidates.find((template) => template.label.toLowerCase() === variant.toLowerCase());
    return exact
      ? { template: exact }
      : {
          error: `add_node refused unknown templateLabel '${variant}' for node type '${nodeType}'`,
        };
  }

  if (variant) {
    const exact = candidates.find((template) => template.label.toLowerCase() === variant.toLowerCase());
    return exact
      ? { template: exact }
      : {
          error: `add_node refused unknown templateLabel '${variant}' for node type '${nodeType}'`,
        };
  }

  return { template: fallback };
}

function switchCaseIdFromValue(value: string, used: Set<string>): string {
  const base = normalizeId(
    value
      .toLowerCase()
      .replace(/[^a-z0-9_.:-]+/g, '-')
      .replace(/^-+|-+$/g, ''),
    'case'
  );
  return uniqueId(base, used);
}

function pinTypeFromSchema(raw: unknown): PinType {
  const record = asRecord(raw);
  const type = typeof record?.type === 'string' ? record.type.trim().toLowerCase() : '';
  if (type === 'boolean') return 'boolean';
  if (type === 'integer' || type === 'number') return 'number';
  if (type === 'array') return 'array';
  if (type === 'object') return 'object';
  if (type === 'string') return 'string';
  return 'any';
}

function pinExists(node: Node<FlowNodeData>, id: string, side: 'input' | 'output' | 'any'): boolean {
  if (side === 'input' || side === 'any') {
    if ((node.data.inputs || []).some((pin) => pin.id === id)) return true;
  }
  if (side === 'output' || side === 'any') {
    if ((node.data.outputs || []).some((pin) => pin.id === id)) return true;
  }
  return false;
}

function pinById(node: Node<FlowNodeData>, id: string, side: 'input' | 'output'): Pin | undefined {
  return (side === 'input' ? node.data.inputs || [] : node.data.outputs || []).find((pin) => pin.id === id);
}

function appendPin(pins: Pin[], pin: Pin): Pin[] {
  if (pins.some((existing) => existing.id === pin.id)) return pins;
  return [...pins, pin];
}

function nodeById(nodes: Node<FlowNodeData>[], id: string): Node<FlowNodeData> | undefined {
  return nodes.find((node) => node.id === id);
}

function hasSecretLikeValue(key: string, value: JsonValue): boolean {
  if (SECRET_KEY_PATTERN.test(key)) return true;
  if (typeof value === 'string' && SECRET_VALUE_PATTERN.test(value)) return true;
  if (Array.isArray(value)) return value.some((item, index) => hasSecretLikeValue(`${key}.${index}`, item));
  if (value && typeof value === 'object') {
    return Object.entries(value).some(([childKey, childValue]) => hasSecretLikeValue(`${key}.${childKey}`, childValue));
  }
  return false;
}

function safePinDefaults(raw: unknown, errors: string[], context: string): Record<string, JsonValue> {
  const record = asRecord(raw);
  if (!record) return {};
  const out: Record<string, JsonValue> = {};
  for (const [key, value] of Object.entries(record)) {
    const json = toJsonValue(value);
    if (json === undefined) {
      errors.push(`${context}: pin default '${key}' is not JSON-serializable`);
      continue;
    }
    if (hasSecretLikeValue(key, json)) {
      errors.push(`${context}: refused secret-looking default '${key}'`);
      continue;
    }
    out[key] = json;
  }
  return out;
}

function validateInputPinDefaults(
  node: Node<FlowNodeData>,
  defaults: Record<string, JsonValue>,
  errors: string[],
  context: string
): Record<string, JsonValue> {
  const out: Record<string, JsonValue> = {};
  for (const [key, value] of Object.entries(defaults)) {
    const targetPin = pinById(node, key, 'input');
    if (!targetPin) {
      errors.push(`${context}: pin default '${key}' is not an input pin`);
      continue;
    }
    if (targetPin.type === 'execution') {
      errors.push(`${context}: refused execution pin default '${key}'`);
      continue;
    }
    out[key] = value;
  }
  return out;
}

function commandKind(command: Record<string, unknown>): string {
  return cleanText(command.action || command.op || command.type, 80).toLowerCase();
}

function edgeIdFor(edge: Pick<Edge, 'source' | 'sourceHandle' | 'target' | 'targetHandle'>, used: Set<string>): string {
  const base = normalizeId(
    `edge-${edge.source}-${edge.sourceHandle || 'out'}-${edge.target}-${edge.targetHandle || 'in'}`,
    'edge'
  );
  return uniqueId(base, used);
}

function splitEndpoint(rawNode: unknown, rawHandle: unknown, idMap: Map<string, string>): { node: string; handle: string } {
  const explicitHandle = normalizeHandle(rawHandle);
  const raw = cleanText(rawNode, 160);
  if (!raw.includes('.')) {
    return { node: resolveNodeId(raw, idMap), handle: explicitHandle };
  }
  const dot = raw.lastIndexOf('.');
  const node = raw.slice(0, dot);
  const handle = normalizeHandle(raw.slice(dot + 1));
  return { node: resolveNodeId(node, idMap), handle };
}

function syncSelected(nodes: Node<FlowNodeData>[], selectedNodeId: string | null): Node<FlowNodeData>[] {
  if (!selectedNodeId) return nodes.map((node) => (node.selected ? { ...node, selected: false } : node));
  return nodes.map((node) => ({ ...node, selected: node.id === selectedNodeId }));
}

function agentOutputForRequestedHandle(requested: string, targetHandle: string): string | null {
  const target = targetHandle.toLowerCase();
  const key = `${requested} ${targetHandle}`.toLowerCase();
  if (target.includes('scratchpad')) return 'scratchpad';
  if (target.includes('source') || target.includes('citation') || target.includes('data') || target.includes('json')) return 'data';
  if (target.includes('report') || target.includes('response') || target.includes('markdown')) return 'response';
  if (target.includes('trace') || target.includes('audit') || target.includes('metadata') || target.includes('meta')) return 'meta';
  if (key.includes('scratchpad')) return 'scratchpad';
  if (key.includes('source') || key.includes('citation') || key.includes('data') || key.includes('json')) return 'data';
  if (key.includes('trace') || key.includes('audit') || key.includes('metadata') || key.includes('meta')) return 'meta';
  if (key.includes('report') || key.includes('response') || key.includes('markdown') || key.includes('summary')) return 'response';
  return null;
}

export function makeFlowAuthoringSnapshot(
  flowName: string,
  flowInterfaces: string[],
  nodes: Node<FlowNodeData>[],
  edges: Edge[],
): FlowAuthoringSnapshot {
  return {
    flowName,
    flowInterfaces: [...flowInterfaces],
    nodes: clone(nodes),
    edges: clone(edges),
  };
}

export function applyFlowAuthoringCommands(input: FlowAuthoringApplyInput): FlowAuthoringApplyResult {
  let flowName = input.flowName;
  let flowInterfaces = [...input.flowInterfaces];
  let nodes = clone(input.nodes);
  let edges = clone(input.edges);
  const snapshot = makeFlowAuthoringSnapshot(input.flowName, input.flowInterfaces, input.nodes, input.edges);
  const applied: string[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];
  const touched = new Set<string>();
  const idMap = new Map<string, string>();
  const skippedPureExecutionLinks: Array<{ source: string; target: string }> = [];

  const usedNodeIds = () => new Set(nodes.map((node) => node.id));
  const usedEdgeIds = () => new Set(edges.map((edge) => edge.id));

  for (const rawCommand of input.commands || []) {
    const command = asRecord(rawCommand);
    if (!command) {
      errors.push('Ignored non-object command');
      continue;
    }
    const kind = commandKind(command);

    if (kind === 'set_flow_name') {
      const name = cleanText(command.name, 120);
      if (!name) {
        errors.push('set_flow_name requires a non-empty name');
        continue;
      }
      flowName = name;
      applied.push(`Set flow name to "${name}"`);
      continue;
    }

    if (kind === 'set_flow_interfaces') {
      const values = Array.isArray(command.interfaces)
        ? command.interfaces.map((item) => cleanText(item, 120)).filter(Boolean)
        : [];
      flowInterfaces = Array.from(new Set(values));
      applied.push('Updated flow interfaces');
      continue;
    }

    if (kind === 'add_node') {
      const { nodeType, requested } = normalizeNodeType(command.nodeType || command.node_type);
      const templateResolution = nodeTemplateForCommand(nodeType, command);
      if (templateResolution.error) {
        errors.push(templateResolution.error);
        continue;
      }
      const template = templateResolution.template;
      if (!template) {
        errors.push(`add_node refused unknown node type '${requested || 'unknown'}'`);
        continue;
      }
      if (requested && requested !== nodeType) {
        warnings.push(`Canonicalized node type ${requested} to ${nodeType}`);
      }
      if (template.hiddenInPalette || template.deprecated) {
        errors.push(`add_node refused hidden or deprecated node type '${nodeType}'`);
        continue;
      }
      const requestedId = normalizeId(command.id || command.tempId || command.temp_id, nodeType);
      const id = uniqueId(requestedId, usedNodeIds());
      const data = createNodeData(template);
      const label = cleanText(command.label, 120);
      if (label) data.label = label;
      const defaultsErrors: string[] = [];
      const defaults = safePinDefaults(command.pinDefaults || command.pin_defaults || command.defaults, defaultsErrors, `add_node ${id}`);
      if (defaultsErrors.length > 0) {
        errors.push(...defaultsErrors);
        continue;
      }
      let literal = toJsonValue(command.literalValue ?? command.literal_value);
      if (nodeType === 'tools_allowlist' && literal === undefined && 'tools' in defaults) {
        const toolNames = toolNamesFromValue(defaults.tools);
        if (toolNames) {
          literal = toolNames;
          delete defaults.tools;
        }
      }
      const defaultsValidationErrors: string[] = [];
      const nodeForDefaultValidation: Node<FlowNodeData> = {
        id,
        type: 'custom',
        position: { x: 0, y: 0 },
        data,
      };
      const validDefaults = validateInputPinDefaults(
        nodeForDefaultValidation,
        defaults,
        defaultsValidationErrors,
        `add_node ${id}`
      );
      if (defaultsValidationErrors.length > 0) {
        errors.push(...defaultsValidationErrors);
        continue;
      }
      if (Object.keys(validDefaults).length > 0) data.pinDefaults = { ...(data.pinDefaults || {}), ...validDefaults };
      if (literal !== undefined) {
        if (hasSecretLikeValue('literalValue', literal)) {
          errors.push(`add_node ${id}: refused secret-looking literal value`);
          continue;
        }
        data.literalValue = literal;
      }
      const separator = cleanText(command.concatSeparator || command.concat_separator, 40);
      if (separator && nodeType === 'concat') data.concatConfig = { separator };

      if (nodeType === 'code' && data.pinDefaults?.permissions === 'full_access') {
        errors.push(`add_node ${id}: refused Code full_access permissions`);
        continue;
      }
      if (nodeType === 'code') {
        const codeBody = cleanCodeBody(command.codeBody ?? command.code_body);
        if (codeBody !== null) {
          if (hasSecretLikeValue('codeBody', codeBody)) {
            errors.push(`add_node ${id}: refused secret-looking Code body`);
            continue;
          }
          data.codeBody = codeBody;
        }
        const functionName = cleanFunctionName(command.functionName ?? command.function_name);
        data.functionName = functionName;
      }
      if (
        nodeType === 'tool_calls' &&
        (!data.pinDefaults || !Array.isArray(data.pinDefaults.allowed_tools) || data.pinDefaults.allowed_tools.length === 0)
      ) {
        errors.push(`add_node ${id}: Tool Calls requires an explicit allowed_tools pin default`);
        continue;
      }

      const positionRecord = asRecord(command.position);
      const x = typeof positionRecord?.x === 'number' && Number.isFinite(positionRecord.x) ? positionRecord.x : nodes.length * 280;
      const y = typeof positionRecord?.y === 'number' && Number.isFinite(positionRecord.y) ? positionRecord.y : 0;
      nodes = syncSelected([...nodes, { id, type: 'custom', position: { x, y }, data, selected: true }], id);
      const aliases = [command.id, command.tempId, command.temp_id, requestedId].map((item) => cleanText(item, 120)).filter(Boolean);
      for (const alias of aliases) idMap.set(alias, id);
      touched.add(id);
      applied.push(`Added ${data.label || nodeType}`);
      continue;
    }

    if (kind === 'set_label') {
      const nodeId = resolveNodeId(command.nodeId || command.node_id || command.id, idMap);
      const label = cleanText(command.label, 120);
      const node = nodeById(nodes, nodeId);
      if (!node || !label) {
        errors.push(`set_label requires an existing node and non-empty label (${nodeId || 'missing'})`);
        continue;
      }
      nodes = nodes.map((item) => (item.id === nodeId ? { ...item, data: { ...item.data, label } } : item));
      touched.add(nodeId);
      applied.push(`Renamed ${nodeId} to "${label}"`);
      continue;
    }

    if (kind === 'set_pin_default') {
      const nodeId = resolveNodeId(command.nodeId || command.node_id, idMap);
      const pin = normalizeId(command.pin || command.pinId || command.pin_id, '');
      const node = nodeById(nodes, nodeId);
      const value = toJsonValue(command.value);
      if (!node || !pin || value === undefined) {
        errors.push(`set_pin_default requires node, pin, and JSON value (${nodeId || 'missing'}.${pin || 'missing'})`);
        continue;
      }
      if (node.data.nodeType === 'tools_allowlist' && pin === 'tools') {
        const toolNames = toolNamesFromValue(value);
        if (!toolNames) {
          errors.push(`set_pin_default requires a tools array for ${nodeId}.tools`);
          continue;
        }
        nodes = nodes.map((item) => (item.id === nodeId ? { ...item, data: { ...item.data, literalValue: toolNames } } : item));
        touched.add(nodeId);
        applied.push(`Set ${nodeId}.tools allowlist`);
        continue;
      }
      const targetPin = pinById(node, pin, 'input');
      if (!targetPin) {
        errors.push(`set_pin_default refused unknown input pin '${pin}' on ${nodeId}`);
        continue;
      }
      if (targetPin.type === 'execution') {
        errors.push(`set_pin_default refused execution input pin '${pin}' on ${nodeId}`);
        continue;
      }
      if (hasSecretLikeValue(pin, value)) {
        errors.push(`set_pin_default refused secret-looking value for ${nodeId}.${pin}`);
        continue;
      }
      if (node.data.nodeType === 'code' && pin === 'permissions' && value === 'full_access') {
        errors.push(`set_pin_default refused Code full_access permissions on ${nodeId}`);
        continue;
      }
      nodes = nodes.map((item) =>
        item.id === nodeId
          ? { ...item, data: { ...item.data, pinDefaults: { ...(item.data.pinDefaults || {}), [pin]: value } } }
          : item
      );
      touched.add(nodeId);
      applied.push(`Set ${nodeId}.${pin}`);
      continue;
    }

    if (kind === 'set_code_body') {
      const nodeId = resolveNodeId(command.nodeId || command.node_id, idMap);
      const node = nodeById(nodes, nodeId);
      const codeBody = cleanCodeBody(command.codeBody ?? command.code_body ?? command.body);
      if (!node || node.data.nodeType !== 'code' || codeBody === null) {
        errors.push(`set_code_body requires an existing Code node and codeBody (${nodeId || 'missing'})`);
        continue;
      }
      if (hasSecretLikeValue('codeBody', codeBody)) {
        errors.push(`set_code_body refused secret-looking Code body on ${nodeId}`);
        continue;
      }
      const functionName = cleanFunctionName(command.functionName ?? command.function_name);
      nodes = nodes.map((item) =>
        item.id === nodeId
          ? { ...item, data: { ...item.data, codeBody, functionName } }
          : item
      );
      touched.add(nodeId);
      applied.push(`Updated Code body on ${nodeId}`);
      continue;
    }

    if (kind === 'set_literal') {
      const nodeId = resolveNodeId(command.nodeId || command.node_id, idMap);
      const node = nodeById(nodes, nodeId);
      const value = toJsonValue(command.value);
      if (!node || value === undefined) {
        errors.push(`set_literal requires node and JSON value (${nodeId || 'missing'})`);
        continue;
      }
      if (node.data.nodeType === 'string_template') {
        if (typeof value !== 'string') {
          errors.push(`set_literal requires a string template value for ${nodeId}`);
          continue;
        }
        nodes = nodes.map((item) =>
          item.id === nodeId
            ? { ...item, data: { ...item.data, pinDefaults: { ...(item.data.pinDefaults || {}), template: value } } }
            : item
        );
        touched.add(nodeId);
        applied.push(`Set ${nodeId}.template`);
        continue;
      }
      if (node.data.nodeType === 'tools_allowlist') {
        const toolNames = toolNamesFromValue(value);
        if (!toolNames) {
          errors.push(`set_literal requires a tool-name array for ${nodeId}`);
          continue;
        }
        nodes = nodes.map((item) => (item.id === nodeId ? { ...item, data: { ...item.data, literalValue: toolNames } } : item));
        touched.add(nodeId);
        applied.push(`Set ${nodeId}.tools allowlist`);
        continue;
      }
      if (hasSecretLikeValue('literalValue', value)) {
        errors.push(`set_literal refused secret-looking value for ${nodeId}`);
        continue;
      }
      nodes = nodes.map((item) => (item.id === nodeId ? { ...item, data: { ...item.data, literalValue: value } } : item));
      touched.add(nodeId);
      applied.push(`Updated literal on ${nodeId}`);
      continue;
    }

    if (kind === 'set_concat_separator') {
      const nodeId = resolveNodeId(command.nodeId || command.node_id, idMap);
      const node = nodeById(nodes, nodeId);
      if (!node) {
        errors.push(`set_concat_separator requires an existing node (${nodeId || 'missing'})`);
        continue;
      }
      if (node.data.nodeType !== 'concat') {
        warnings.push(`Ignored concat separator on non-concat node ${nodeId}`);
        continue;
      }
      const separator = typeof command.separator === 'string' ? command.separator.slice(0, 40) : ' ';
      nodes = nodes.map((item) =>
        item.id === nodeId ? { ...item, data: { ...item.data, concatConfig: { separator } } } : item
      );
      touched.add(nodeId);
      applied.push(`Set concat separator on ${nodeId}`);
      continue;
    }

    if (kind === 'set_event_config') {
      const nodeId = resolveNodeId(command.nodeId || command.node_id, idMap);
      const node = nodeById(nodes, nodeId);
      if (!node || !['on_event', 'on_agent_message', 'on_schedule'].includes(node.data.nodeType)) {
        errors.push(`set_event_config requires an existing event node (${nodeId || 'missing'})`);
        continue;
      }
      const next: NonNullable<FlowNodeData['eventConfig']> = { ...(node.data.eventConfig || {}) };
      const localErrors: string[] = [];
      const assignString = (key: keyof NonNullable<FlowNodeData['eventConfig']>, raw: unknown, maxLen = 300) => {
        if (raw === undefined) return;
        const value = cleanText(raw, maxLen);
        if (!value) return;
        if (hasSecretLikeValue(String(key), value)) {
          localErrors.push(`set_event_config refused secret-looking value for ${nodeId}.${String(key)}`);
          return;
        }
        next[key] = value as never;
      };
      assignString('name', command.name);
      assignString('channel', command.channel);
      assignString('agentFilter', command.agentFilter ?? command.agent_filter);
      assignString('schedule', command.schedule);
      assignString('description', command.description, 1000);
      if (command.scope !== undefined) {
        const scope = cleanText(command.scope, 40);
        if (['session', 'workflow', 'run', 'global'].includes(scope)) {
          next.scope = scope as NonNullable<FlowNodeData['eventConfig']>['scope'];
        } else if (scope) {
          localErrors.push(`set_event_config refused invalid scope '${scope}' for ${nodeId}`);
        }
      }
      if (command.recurrent !== undefined) {
        if (typeof command.recurrent === 'boolean') next.recurrent = command.recurrent;
        else localErrors.push(`set_event_config requires boolean recurrent for ${nodeId}`);
      }
      if (localErrors.length > 0) {
        errors.push(...localErrors);
        continue;
      }
      nodes = nodes.map((item) => (item.id === nodeId ? { ...item, data: { ...item.data, eventConfig: next } } : item));
      touched.add(nodeId);
      applied.push(`Configured event settings on ${nodeId}`);
      continue;
    }

    if (kind === 'set_break_paths') {
      const nodeId = resolveNodeId(command.nodeId || command.node_id, idMap);
      const node = nodeById(nodes, nodeId);
      if (!node || node.data.nodeType !== 'break_object') {
        errors.push(`set_break_paths requires an existing Break Object node (${nodeId || 'missing'})`);
        continue;
      }
      const localErrors: string[] = [];
      const rawPaths = Array.isArray(command.paths) ? command.paths : [];
      const pins: Pin[] = [];
      for (const item of rawPaths) {
        const record = asRecord(item);
        const rawPath = record ? record.path ?? record.id ?? record.pin : item;
        const id = normalizeId(rawPath, '');
        if (!id || pins.some((pin) => pin.id === id)) continue;
        const explicitId = record ? normalizeId(record.id, '') : '';
        const explicitPath = record ? normalizeId(record.path, '') : '';
        if (explicitId && explicitPath && explicitId !== explicitPath) {
          localErrors.push(`set_break_paths does not support aliases; id must equal path for ${nodeId}.${explicitId}`);
          continue;
        }
        const label = cleanText(record?.label, 80) || id.split('.').slice(-1)[0] || id;
        const type = inferredPinType(id, label, record?.pinType ?? record?.pin_type ?? record?.type, 'any');
        if (type === 'execution') {
          localErrors.push(`set_break_paths refused execution output '${id}' on ${nodeId}`);
          continue;
        }
        pins.push({ id, label, type });
      }
      if (localErrors.length > 0) {
        errors.push(...localErrors);
        continue;
      }
      if (pins.length === 0) {
        errors.push(`set_break_paths requires at least one path for ${nodeId}`);
        continue;
      }
      nodes = nodes.map((item) =>
        item.id === nodeId
          ? { ...item, data: { ...item.data, breakConfig: { selectedPaths: pins.map((pin) => pin.id) }, outputs: pins } }
          : item
      );
      touched.add(nodeId);
      applied.push(`Configured Break Object paths on ${nodeId}`);
      continue;
    }

    if (kind === 'set_switch_cases') {
      const nodeId = resolveNodeId(command.nodeId || command.node_id, idMap);
      const node = nodeById(nodes, nodeId);
      if (!node || node.data.nodeType !== 'switch') {
        errors.push(`set_switch_cases requires an existing Switch node (${nodeId || 'missing'})`);
        continue;
      }
      const rawCases = Array.isArray(command.cases) ? command.cases : [];
      const used = new Set<string>();
      const cases: { id: string; value: string }[] = [];
      for (const item of rawCases) {
        const record = asRecord(item);
        const value = cleanText(record ? record.value ?? record.label ?? record.id : item, 120);
        if (!value) continue;
        const requestedId = cleanText(record?.id, 80);
        const id = requestedId ? uniqueId(normalizeId(requestedId, 'case'), used) : switchCaseIdFromValue(value, used);
        used.add(id);
        cases.push({ id, value });
      }
      if (cases.length === 0) {
        errors.push(`set_switch_cases requires at least one case for ${nodeId}`);
        continue;
      }
      const outputs: Pin[] = [
        ...cases.map((item) => ({ id: `case:${item.id}`, label: item.value, type: 'execution' as const })),
        { id: 'default', label: 'default', type: 'execution' },
      ];
      nodes = nodes.map((item) =>
        item.id === nodeId ? { ...item, data: { ...item.data, switchConfig: { cases }, outputs } } : item
      );
      touched.add(nodeId);
      applied.push(`Configured Switch cases on ${nodeId}`);
      continue;
    }

    if (kind === 'set_branch_count') {
      const nodeId = resolveNodeId(command.nodeId || command.node_id, idMap);
      const node = nodeById(nodes, nodeId);
      const count = typeof command.count === 'number' && Number.isFinite(command.count) ? Math.floor(command.count) : 0;
      if (!node || (node.data.nodeType !== 'sequence' && node.data.nodeType !== 'parallel') || count < 1) {
        errors.push(`set_branch_count requires an existing Sequence/Parallel node and count >= 1 (${nodeId || 'missing'})`);
        continue;
      }
      const thenPins: Pin[] = Array.from({ length: count }, (_, index) => ({
        id: `then:${index}`,
        label: `Then ${index}`,
        type: 'execution' as const,
      }));
      const outputs = node.data.nodeType === 'parallel'
        ? [...thenPins, { id: 'completed', label: 'Completed', type: 'execution' as const }]
        : thenPins;
      nodes = nodes.map((item) => (item.id === nodeId ? { ...item, data: { ...item.data, outputs } } : item));
      touched.add(nodeId);
      applied.push(`Configured ${node.data.nodeType} branch count on ${nodeId}`);
      continue;
    }

    if (kind === 'set_tool_parameters') {
      const nodeId = resolveNodeId(command.nodeId || command.node_id, idMap);
      const node = nodeById(nodes, nodeId);
      const tool = cleanText(command.tool || command.name, 160);
      if (!node || node.data.nodeType !== 'tool_parameters' || !tool) {
        errors.push(`set_tool_parameters requires an existing Tool Parameters node and tool name (${nodeId || 'missing'})`);
        continue;
      }
      const parameters = asRecord(command.parameters) || asRecord(command.schema) || {};
      const defaults = asRecord(command.defaults) || {};
      const localErrors: string[] = [];
      const inputs: Pin[] = [];
      const outputs: Pin[] = [
        {
          id: 'tool_call',
          label: 'tool_call',
          type: 'object',
          description: 'Single tool call request object: {name, arguments, call_id?}.',
        },
      ];
      const pinDefaults: Record<string, JsonValue> = {};
      for (const [rawName, meta] of Object.entries(parameters)) {
        const id = normalizeId(rawName, '');
        if (!id || inputs.some((pin) => pin.id === id)) continue;
        const record = asRecord(meta);
        const label = cleanText(record?.label ?? record?.title, 80) || id;
        const type = pinTypeFromSchema(meta);
        const pin: Pin = {
          id,
          label,
          type,
          ...(typeof record?.description === 'string' && record.description.trim() ? { description: record.description.trim() } : {}),
        };
        inputs.push(pin);
        outputs.push(pin);
        const defaultValue = toJsonValue(defaults[id] ?? record?.default);
        if (defaultValue !== undefined) {
          if (hasSecretLikeValue(id, defaultValue)) {
            localErrors.push(`set_tool_parameters refused secret-looking default for ${nodeId}.${id}`);
            continue;
          }
          pinDefaults[id] = defaultValue;
        }
      }
      if (localErrors.length > 0) {
        errors.push(...localErrors);
        continue;
      }
      nodes = nodes.map((item) =>
        item.id === nodeId
          ? {
              ...item,
              data: {
                ...item.data,
                toolParametersConfig: { tool },
                inputs,
                outputs,
                pinDefaults,
              },
            }
          : item
      );
      touched.add(nodeId);
      applied.push(`Configured Tool Parameters on ${nodeId}`);
      continue;
    }

    if (kind === 'add_input_pin' || kind === 'add_output_pin') {
      const nodeId = resolveNodeId(command.nodeId || command.node_id, idMap);
      const node = nodeById(nodes, nodeId);
      let isInput = kind === 'add_input_pin';
      if (!node) {
        errors.push(`${kind} requires an existing node (${nodeId || 'missing'})`);
        continue;
      }
      if (isInput && node.data.nodeType === 'on_flow_start') {
        isInput = false;
        warnings.push(`Canonicalized ${nodeId} dynamic pin to an On Flow Start output`);
      } else if (!isInput && node.data.nodeType === 'on_flow_end') {
        isInput = true;
        warnings.push(`Canonicalized ${nodeId} dynamic pin to an On Flow End input`);
      }
      if (isInput && !DYNAMIC_INPUT_NODE_TYPES.has(node.data.nodeType)) {
        const id = normalizeId(command.id || command.pin || command.pinId || command.pin_id, 'input');
        if (pinExists(node, id, 'input')) {
          warnings.push(`${nodeId}.${id} already exists`);
          continue;
        }
        warnings.push(`Ignored dynamic input ${nodeId}.${id}; ${node.data.nodeType} inputs are template-owned`);
        continue;
      }
      if (!isInput && !DYNAMIC_OUTPUT_NODE_TYPES.has(node.data.nodeType)) {
        const id = normalizeId(command.id || command.pin || command.pinId || command.pin_id, 'output');
        if (pinExists(node, id, 'output')) {
          warnings.push(`${nodeId}.${id} already exists`);
          continue;
        }
        warnings.push(`Ignored dynamic output ${nodeId}.${id}; ${node.data.nodeType} outputs are template-owned`);
        continue;
      }
      const id = normalizeId(command.id || command.pin || command.pinId || command.pin_id, isInput ? 'input' : 'output');
      const label = cleanText(command.label, 80) || id;
      const type = inferredPinType(id, label, command.pinType || command.pin_type || command.type, 'string');
      if (type === 'execution') {
        errors.push(`${kind} refused execution pin '${id}' on ${nodeId}`);
        continue;
      }
      if (pinExists(node, id, isInput ? 'input' : 'output')) {
        warnings.push(`${nodeId}.${id} already exists`);
        continue;
      }
      const pin: Pin = { id, label, type };
      nodes = nodes.map((item) => {
        if (item.id !== nodeId) return item;
        if (!isInput && item.data.nodeType === 'break_object') {
          const selectedPaths = Array.from(new Set([...(item.data.breakConfig?.selectedPaths || []), pin.id]));
          return {
            ...item,
            data: {
              ...item.data,
              breakConfig: { ...(item.data.breakConfig || {}), selectedPaths },
              outputs: appendPin(item.data.outputs || [], pin),
            },
          };
        }
        return isInput
          ? { ...item, data: { ...item.data, inputs: appendPin(item.data.inputs || [], pin) } }
          : { ...item, data: { ...item.data, outputs: appendPin(item.data.outputs || [], pin) } };
      });
      touched.add(nodeId);
      applied.push(`Added ${isInput ? 'input' : 'output'} ${nodeId}.${id}`);
      continue;
    }

    if (kind === 'connect') {
      const sourceEndpoint = splitEndpoint(command.source || command.sourceNodeId || command.source_node_id, command.sourceHandle || command.source_handle, idMap);
      const targetEndpoint = splitEndpoint(command.target || command.targetNodeId || command.target_node_id, command.targetHandle || command.target_handle, idMap);
      const source = sourceEndpoint.node;
      const target = targetEndpoint.node;
      let sourceHandle = sourceEndpoint.handle;
      let targetHandle = targetEndpoint.handle;
      if (!source || !target || !sourceHandle || !targetHandle) {
        errors.push('connect requires source/sourceHandle/target/targetHandle');
        continue;
      }
      const sourceNode = nodeById(nodes, source);
      const targetNode = nodeById(nodes, target);
      if (sourceNode?.data.nodeType === 'agent' && targetNode?.data.nodeType === 'agent_trace_report' && targetHandle === 'scratchpad' && sourceHandle !== 'scratchpad') {
        warnings.push(`Canonicalized Agent trace input ${source}.${sourceHandle} to ${source}.scratchpad`);
        sourceHandle = 'scratchpad';
      } else if (sourceNode?.data.nodeType === 'agent' && !pinExists(sourceNode, sourceHandle, 'output')) {
        const mapped = agentOutputForRequestedHandle(sourceHandle, targetHandle);
        if (mapped && mapped !== sourceHandle && pinExists(sourceNode, mapped, 'output')) {
          warnings.push(`Canonicalized Agent output ${source}.${sourceHandle} to ${source}.${mapped}`);
          sourceHandle = mapped;
        }
      }
      if (
        targetNode?.data.nodeType === 'make_object' &&
        targetHandle === 'value' &&
        sourceHandle !== 'exec-out' &&
        sourceHandle !== 'exec-in'
      ) {
        const dynamicTargetHandle = normalizeId(sourceHandle, 'value');
        if (dynamicTargetHandle && dynamicTargetHandle !== targetHandle) {
          targetHandle = dynamicTargetHandle;
          warnings.push(`Canonicalized Build JSON value input ${target}.value to dynamic input ${target}.${targetHandle}`);
        }
      }
      if (
        targetNode &&
        !pinExists(targetNode, targetHandle, 'input') &&
        DYNAMIC_INPUT_NODE_TYPES.has(targetNode.data.nodeType) &&
        sourceHandle !== 'exec-out' &&
        targetHandle !== 'exec-in'
      ) {
        const sourcePin = sourceNode ? pinById(sourceNode, sourceHandle, 'output') : undefined;
        const type = sourcePin?.type && sourcePin.type !== 'execution' ? sourcePin.type : 'string';
        const pin: Pin = { id: targetHandle, label: targetHandle, type };
        nodes = nodes.map((item) =>
          item.id === target ? { ...item, data: { ...item.data, inputs: appendPin(item.data.inputs || [], pin) } } : item
        );
        touched.add(target);
        applied.push(`Added input ${target}.${targetHandle}`);
        warnings.push(`Canonicalized missing dynamic input ${target}.${targetHandle} from connection`);
      }
      const normalizedConnection = { source, sourceHandle, target, targetHandle };
      const duplicate = edges.some(
        (edge) =>
          edge.source === source &&
          edge.sourceHandle === normalizedConnection.sourceHandle &&
          edge.target === target &&
          edge.targetHandle === targetHandle
      );
      if (duplicate) {
        warnings.push(`Connection ${source}.${normalizedConnection.sourceHandle} -> ${target}.${targetHandle} already exists`);
        continue;
      }
      if (!validateConnection(nodes, edges, normalizedConnection)) {
        const currentSourceNode = nodeById(nodes, source);
        const currentTargetNode = nodeById(nodes, target);
        const sourcePin = currentSourceNode ? pinById(currentSourceNode, sourceHandle, 'output') : undefined;
        const targetPin = currentTargetNode ? pinById(currentTargetNode, targetHandle, 'input') : undefined;
        const isTerminalAuditSummaryObjectEdge =
          currentSourceNode?.data.nodeType === 'agent' &&
          sourceHandle === 'meta' &&
          currentTargetNode?.data.nodeType === 'on_flow_end' &&
          sourcePin?.type === 'object' &&
          targetPin?.type === 'string' &&
          /audit|trace|summary|metadata|meta/i.test(targetHandle);
        if (isTerminalAuditSummaryObjectEdge) {
          warnings.push(`Skipped incompatible terminal audit summary edge ${source}.${sourceHandle} -> ${target}.${targetHandle}`);
          continue;
        }
        const missingExecEndpoint =
          (sourceHandle === 'exec-out' || targetHandle === 'exec-in') &&
          (!currentSourceNode ||
            !currentTargetNode ||
            !pinExists(currentSourceNode, sourceHandle, 'output') ||
            !pinExists(currentTargetNode, targetHandle, 'input'));
        if (missingExecEndpoint) {
          skippedPureExecutionLinks.push({ source, target });
          warnings.push(`Skipped pure-node execution bridge ${source}.${sourceHandle} -> ${target}.${targetHandle}`);
          continue;
        }
        const reason = getConnectionError(nodes, edges, normalizedConnection);
        errors.push(
          `connect refused invalid edge ${source}.${sourceHandle} -> ${target}.${targetHandle}${reason ? ` (${reason})` : ''}`
        );
        continue;
      }
      const sourcePin = sourceNode?.data.outputs.find((pin) => pin.id === normalizedConnection.sourceHandle);
      const edge: Edge = {
        ...normalizedConnection,
        id: edgeIdFor(normalizedConnection, usedEdgeIds()),
        animated: sourcePin?.type === 'execution',
      };
      edges = [...edges, edge];
      touched.add(source);
      touched.add(target);
      applied.push(`Connected ${source}.${sourceHandle} -> ${target}.${targetHandle}`);
      continue;
    }

    if (kind === 'delete_node' || kind === 'delete_edge') {
      if (!input.allowDestructive) {
        errors.push(`${kind} requires destructive edits to be explicitly enabled`);
        continue;
      }
      if (kind === 'delete_node') {
        const nodeId = resolveNodeId(command.nodeId || command.node_id || command.id, idMap);
        if (!nodeById(nodes, nodeId)) {
          errors.push(`delete_node missing node ${nodeId || 'unknown'}`);
          continue;
        }
        nodes = nodes.filter((node) => node.id !== nodeId);
        edges = edges.filter((edge) => edge.source !== nodeId && edge.target !== nodeId);
        applied.push(`Deleted node ${nodeId}`);
      } else {
        const edgeId = cleanText(command.edgeId || command.edge_id || command.id, 160);
        if (!edges.some((edge) => edge.id === edgeId)) {
          errors.push(`delete_edge missing edge ${edgeId || 'unknown'}`);
          continue;
        }
        edges = edges.filter((edge) => edge.id !== edgeId);
        applied.push(`Deleted edge ${edgeId}`);
      }
      continue;
    }

    errors.push(`Unknown command '${kind || 'missing'}'`);
  }

  if (errors.length === 0 && skippedPureExecutionLinks.length > 0) {
    const start = nodes.find((node) => node.data.nodeType === 'on_flow_start');
    const agent = nodes.find((node) => node.data.nodeType === 'agent');
    const end = nodes.find((node) => node.data.nodeType === 'on_flow_end');
    if (
      start &&
      agent &&
      !edges.some((edge) => edge.target === agent.id && edge.targetHandle === 'exec-in') &&
      validateConnection(nodes, edges, {
        source: start.id,
        sourceHandle: 'exec-out',
        target: agent.id,
        targetHandle: 'exec-in',
      })
    ) {
      const connection = {
        source: start.id,
        sourceHandle: 'exec-out',
        target: agent.id,
        targetHandle: 'exec-in',
      };
      edges = [...edges, { ...connection, id: edgeIdFor(connection, usedEdgeIds()), animated: true }];
      touched.add(start.id);
      touched.add(agent.id);
      applied.push(`Connected ${start.id}.exec-out -> ${agent.id}.exec-in`);
      warnings.push('Canonicalized pure-node execution chain to On Flow Start -> Agent');
    }
    if (
      agent &&
      end &&
      !edges.some((edge) => edge.source === agent.id && edge.sourceHandle === 'exec-out' && edge.target === end.id) &&
      validateConnection(nodes, edges, {
        source: agent.id,
        sourceHandle: 'exec-out',
        target: end.id,
        targetHandle: 'exec-in',
      })
    ) {
      const connection = {
        source: agent.id,
        sourceHandle: 'exec-out',
        target: end.id,
        targetHandle: 'exec-in',
      };
      edges = [...edges, { ...connection, id: edgeIdFor(connection, usedEdgeIds()), animated: true }];
      touched.add(agent.id);
      touched.add(end.id);
      applied.push(`Connected ${agent.id}.exec-out -> ${end.id}.exec-in`);
      warnings.push('Canonicalized terminal execution edge Agent -> On Flow End');
    }
  }

  return {
    flowName,
    flowInterfaces,
    nodes,
    edges,
    applied,
    warnings,
    errors,
    touchedNodeIds: Array.from(touched),
    snapshot,
  };
}
