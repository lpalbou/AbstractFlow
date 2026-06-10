import type { FlowNodeData, Pin } from '../types/flow';
import {
  AGENT_META_SCHEMA,
  AGENT_RESULT_SCHEMA,
  AGENT_SCRATCHPAD_SCHEMA,
  CONTEXT_EXTRA_SCHEMA,
  CONTEXT_SCHEMA,
  EVENT_ENVELOPE_SCHEMA,
  LLM_META_SCHEMA,
  LLM_RESULT_SCHEMA,
} from '../schemas/known_json_schemas';
import { jsonSchemaRecord, structuredResponseSchemaFromNodeData } from './structuredOutputs';
import { addJsonSchemaFields } from './jsonSchemaEditor';

export type InferredJsonSchema = Record<string, unknown>;

type GraphNode = {
  id: string;
  data?: FlowNodeData | null;
};

type GraphEdge = {
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
};

function asSchema(value: unknown): InferredJsonSchema | undefined {
  return jsonSchemaRecord(value) as InferredJsonSchema | undefined;
}

export function schemaFromPin(pin: Pin | undefined): InferredJsonSchema | undefined {
  return asSchema(pin?.schema);
}

export function schemaFromOutputPin(node: GraphNode | undefined, handle: string): InferredJsonSchema | undefined {
  if (!node?.data?.outputs) return undefined;
  return schemaFromPin(node.data.outputs.find((pin) => pin.id === handle));
}

export function jsonSchemaFromSample(value: unknown): InferredJsonSchema | undefined {
  if (Array.isArray(value)) {
    const first = value.find((item) => item !== undefined && item !== null);
    return {
      type: 'array',
      items: first === undefined ? {} : jsonSchemaFromSample(first) ?? {},
    };
  }

  if (value && typeof value === 'object') {
    const properties: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      properties[key] = jsonSchemaFromSample(child) ?? {};
    }
    return { type: 'object', properties };
  }

  if (typeof value === 'string') return { type: 'string' };
  if (typeof value === 'number') return { type: Number.isInteger(value) ? 'integer' : 'number' };
  if (typeof value === 'boolean') return { type: 'boolean' };
  return undefined;
}

function isSchemaType(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(isSchemaType);
  return (
    value === 'object' ||
    value === 'array' ||
    value === 'string' ||
    value === 'number' ||
    value === 'integer' ||
    value === 'boolean' ||
    value === 'null'
  );
}

function looksLikeJsonSchema(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const obj = value as Record<string, unknown>;
  if ('$schema' in obj || '$id' in obj || '$ref' in obj || '$defs' in obj || 'definitions' in obj) return true;
  if ('properties' in obj || 'items' in obj || 'required' in obj || 'additionalProperties' in obj) return true;
  return 'type' in obj && isSchemaType(obj.type);
}

function schemaForPropertyValue(value: unknown): InferredJsonSchema {
  if (looksLikeJsonSchema(value)) return normalizeResponseSchemaValue(value) ?? {};
  return jsonSchemaFromSample(value) ?? {};
}

export function normalizeResponseSchemaValue(value: unknown): InferredJsonSchema | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const obj = value as Record<string, unknown>;

  if (obj.type === 'json_schema' && obj.json_schema && typeof obj.json_schema === 'object') {
    const wrapped = obj.json_schema as Record<string, unknown>;
    if (wrapped.schema && typeof wrapped.schema === 'object') return normalizeResponseSchemaValue(wrapped.schema);
  }

  if (obj.json_schema && typeof obj.json_schema === 'object') {
    const wrapped = obj.json_schema as Record<string, unknown>;
    if (wrapped.schema && typeof wrapped.schema === 'object') return normalizeResponseSchemaValue(wrapped.schema);
  }

  const innerSchema = obj['schema'];
  if (innerSchema && typeof innerSchema === 'object' && !looksLikeJsonSchema(obj)) {
    return normalizeResponseSchemaValue(innerSchema);
  }

  if (looksLikeJsonSchema(obj)) {
    if (obj.type === undefined && obj.properties && typeof obj.properties === 'object') {
      return { ...obj, type: 'object' };
    }
    return { ...obj };
  }

  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const [key, child] of Object.entries(obj)) {
    properties[key] = schemaForPropertyValue(child);
    required.push(key);
  }

  const schema: InferredJsonSchema = { type: 'object', properties };
  if (required.length > 0) schema.required = required;
  return schema;
}

export function getSchemaByPath(schema: unknown, path: string): InferredJsonSchema | undefined {
  if (!path || !schema || typeof schema !== 'object') return undefined;
  const parts = path.split('.');
  let current: unknown = schema;

  for (const part of parts) {
    if (!current || typeof current !== 'object') return undefined;
    const cur = current as Record<string, unknown>;

    if (cur.type === 'object') {
      const properties = cur.properties;
      if (!properties || typeof properties !== 'object') return undefined;
      current = (properties as Record<string, unknown>)[part];
      continue;
    }

    if (cur.type === 'array') {
      if (!/^\d+$/.test(part)) return undefined;
      current = cur.items;
      continue;
    }

    return undefined;
  }

  return asSchema(current);
}

function inferSchemaValueFromNodeOutput(
  node: GraphNode | undefined,
  handle: string,
  _nodes: readonly GraphNode[],
  _edges: readonly GraphEdge[]
): InferredJsonSchema | undefined {
  if (!node) return undefined;
  const nodeType = node.data?.nodeType;

  if (nodeType === 'json_schema' && (!handle || handle === 'value' || handle === 'schema')) {
    return normalizeResponseSchemaValue(node.data?.literalValue);
  }

  if (nodeType === 'edit_json_schema' && (!handle || handle === 'schema')) {
    const inputEdge = _edges.find((edge) => edge.target === node.id && edge.targetHandle === 'schema');
    const sourceNode = inputEdge ? _nodes.find((candidate) => candidate.id === inputEdge.source) : undefined;
    const sourceHandle = typeof inputEdge?.sourceHandle === 'string' ? inputEdge.sourceHandle : '';
    const base = inputEdge ? inferSchemaValueFromNodeOutput(sourceNode, sourceHandle, _nodes, _edges) : undefined;
    return normalizeResponseSchemaValue(addJsonSchemaFields(base, node.data?.literalValue));
  }

  if ((nodeType === 'literal_json' || nodeType === 'literal_array') && (!handle || handle === 'value')) {
    return normalizeResponseSchemaValue(node.data?.literalValue);
  }

  return schemaFromOutputPin(node, handle);
}

function structuredResponseSchemaForNode(
  node: GraphNode | undefined,
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[]
): InferredJsonSchema | undefined {
  if (!node) return undefined;
  const fromNode = structuredResponseSchemaFromNodeData(node.data) as InferredJsonSchema | undefined;
  if (fromNode) return fromNode;

  const schemaEdge = edges.find(
    (edge) =>
      edge.target === node.id &&
      (edge.targetHandle === 'resp_schema' || edge.targetHandle === 'response_schema')
  );
  if (!schemaEdge) return undefined;

  const sourceNode = nodes.find((candidate) => candidate.id === schemaEdge.source);
  const sourceHandle = typeof schemaEdge.sourceHandle === 'string' ? schemaEdge.sourceHandle : '';
  return inferSchemaValueFromNodeOutput(sourceNode, sourceHandle, nodes, edges);
}

export function inferSchemaForNodeInput(
  node: GraphNode | undefined,
  handle: string,
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
  depth = 0
): InferredJsonSchema | undefined {
  if (!node || depth > 8) return undefined;

  const inputSchema = schemaFromPin(node.data?.inputs?.find((pin) => pin.id === handle));
  if (inputSchema) return inputSchema;

  const inputEdge = edges.find((edge) => edge.target === node.id && edge.targetHandle === handle);
  if (!inputEdge) return undefined;

  const sourceNode = nodes.find((candidate) => candidate.id === inputEdge.source);
  const sourceHandle = typeof inputEdge.sourceHandle === 'string' ? inputEdge.sourceHandle : '';
  return inferSchemaForNodeOutput(sourceNode, sourceHandle, nodes, edges, depth + 1);
}

export function inferSchemaForNodeOutput(
  node: GraphNode | undefined,
  handle: string,
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
  depth = 0
): InferredJsonSchema | undefined {
  if (!node || depth > 8) return undefined;

  const pinSchema = schemaFromOutputPin(node, handle);
  if (pinSchema) return pinSchema;

  const nodeType = node.data?.nodeType;
  if (handle === 'context') return CONTEXT_SCHEMA as InferredJsonSchema;
  if (handle === 'context_extra') return CONTEXT_EXTRA_SCHEMA as InferredJsonSchema;
  if (nodeType === 'make_context' && handle === 'context') return CONTEXT_SCHEMA as InferredJsonSchema;
  if (nodeType === 'make_meta' && handle === 'meta') return AGENT_META_SCHEMA as InferredJsonSchema;
  if (nodeType === 'make_scratchpad' && handle === 'scratchpad') return AGENT_SCRATCHPAD_SCHEMA as InferredJsonSchema;
  if (nodeType === 'on_event' && handle === 'event') return EVENT_ENVELOPE_SCHEMA as InferredJsonSchema;

  if (nodeType === 'json_schema' && (!handle || handle === 'value' || handle === 'schema')) {
    return asSchema(node.data?.literalValue);
  }

  if (nodeType === 'edit_json_schema' && (!handle || handle === 'schema')) {
    const base = inferSchemaForNodeInput(node, 'schema', nodes, edges, depth + 1);
    return asSchema(addJsonSchemaFields(base, node.data?.literalValue));
  }

  if (nodeType === 'literal_json' && (!handle || handle === 'value')) {
    return jsonSchemaFromSample(node.data?.literalValue);
  }

  if (nodeType === 'literal_array' && (!handle || handle === 'value')) {
    return jsonSchemaFromSample(node.data?.literalValue);
  }

  if (nodeType === 'parse_json' && (!handle || handle === 'result')) {
    return inferSchemaForNodeInput(node, 'text', nodes, edges, depth + 1);
  }

  if (nodeType === 'agent') {
    if (handle === 'scratchpad') return AGENT_SCRATCHPAD_SCHEMA as InferredJsonSchema;
    if (handle === 'meta') return AGENT_META_SCHEMA as InferredJsonSchema;
    const responseSchema = structuredResponseSchemaForNode(node, nodes, edges);
    if (responseSchema && (handle === 'data' || handle === 'response')) return responseSchema as InferredJsonSchema;
    if (!handle || handle === 'data' || handle === 'response') return AGENT_RESULT_SCHEMA as InferredJsonSchema;
    return undefined;
  }

  if (nodeType === 'llm_call') {
    if (handle === 'meta') return LLM_META_SCHEMA as InferredJsonSchema;
    const responseSchema = structuredResponseSchemaForNode(node, nodes, edges);
    if (responseSchema && (handle === 'data' || handle === 'response')) return responseSchema as InferredJsonSchema;
    if (!handle || handle === 'data' || handle === 'response') return LLM_RESULT_SCHEMA as InferredJsonSchema;
    return undefined;
  }

  if (nodeType === 'break_object') {
    const inputEdge = edges.find((edge) => edge.target === node.id && edge.targetHandle === 'object');
    if (!inputEdge) return undefined;
    const sourceNode = nodes.find((candidate) => candidate.id === inputEdge.source);
    const sourceHandle = typeof inputEdge.sourceHandle === 'string' ? inputEdge.sourceHandle : '';
    const base = inferSchemaForNodeOutput(sourceNode, sourceHandle, nodes, edges, depth + 1);
    return getSchemaByPath(base, handle);
  }

  return undefined;
}
