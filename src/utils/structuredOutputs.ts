import type { Edge, Node } from 'reactflow';
import type { FlowNodeData, Pin } from '../types/flow';
import { addJsonSchemaFields } from './jsonSchemaEditor';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

export function jsonSchemaRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) && Object.keys(value).length > 0 ? value : undefined;
}

export function structuredResponseSchemaFromNodeData(nodeData: FlowNodeData | undefined | null): Record<string, unknown> | undefined {
  if (!nodeData) return undefined;
  const pinDefaults = isRecord(nodeData.pinDefaults) ? nodeData.pinDefaults : undefined;
  const fromPin = jsonSchemaRecord(pinDefaults?.resp_schema) ?? jsonSchemaRecord(pinDefaults?.response_schema);
  if (fromPin) return fromPin;

  const outputSchema = nodeData.agentConfig?.outputSchema;
  if (outputSchema?.enabled && isRecord(outputSchema.jsonSchema)) return outputSchema.jsonSchema;
  return undefined;
}

function schemaFromNodeOutput(
  node: Node<FlowNodeData> | undefined,
  sourceHandle: string,
  nodes: readonly Node<FlowNodeData>[],
  edges: readonly Edge[],
  depth = 0
): Record<string, unknown> | undefined {
  if (!node) return undefined;
  if (depth > 8) return undefined;
  if (node.data.nodeType === 'json_schema') {
    if (sourceHandle && sourceHandle !== 'value' && sourceHandle !== 'schema') return undefined;
    return jsonSchemaRecord(node.data.literalValue);
  }
  if (node.data.nodeType === 'edit_json_schema') {
    if (sourceHandle && sourceHandle !== 'schema') return undefined;
    const inputEdge = edges.find((edge) => edge.target === node.id && edge.targetHandle === 'schema');
    const source = inputEdge ? nodes.find((candidate) => candidate.id === inputEdge.source) : undefined;
    const sourceHandle2 = typeof inputEdge?.sourceHandle === 'string' ? inputEdge.sourceHandle : '';
    const base = inputEdge ? schemaFromNodeOutput(source, sourceHandle2, nodes, edges, depth + 1) : undefined;
    return jsonSchemaRecord(addJsonSchemaFields(base, node.data.literalValue));
  }
  return undefined;
}

export function structuredResponseSchemaFromGraph(
  node: Node<FlowNodeData> | undefined,
  nodes: readonly Node<FlowNodeData>[],
  edges: readonly Edge[]
): Record<string, unknown> | undefined {
  if (!node) return undefined;
  const fromNode = structuredResponseSchemaFromNodeData(node.data);
  if (fromNode) return fromNode;

  const schemaEdge = edges.find(
    (edge) =>
      edge.target === node.id &&
      (edge.targetHandle === 'resp_schema' || edge.targetHandle === 'response_schema')
  );
  if (!schemaEdge) return undefined;
  const source = nodes.find((candidate) => candidate.id === schemaEdge.source);
  return schemaFromNodeOutput(source, typeof schemaEdge.sourceHandle === 'string' ? schemaEdge.sourceHandle : '', nodes, edges);
}

export function hasStructuredResponseSchema(nodeData: FlowNodeData | undefined | null): boolean {
  return Boolean(structuredResponseSchemaFromNodeData(nodeData));
}

export function isStructuredResponseDataPin(pin: Pin | { id: string }, nodeType: string | undefined): boolean {
  return pin.id === 'data' && (nodeType === 'llm_call' || nodeType === 'agent');
}
