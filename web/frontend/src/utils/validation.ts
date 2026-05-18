/**
 * Connection validation for Blueprint-style type checking.
 */

import type { Node, Connection, Edge } from 'reactflow';
import type { FlowNodeData, PinType } from '../types/flow';

function routeKey(sourceNodeId: string, sourceHandle: string): string {
  return `${sourceNodeId}::${sourceHandle || 'exec-out'}`;
}

function edgeData(edge: Edge): Record<string, unknown> {
  return edge.data && typeof edge.data === 'object' && !Array.isArray(edge.data) ? (edge.data as Record<string, unknown>) : {};
}

const PROVIDER_PIN_TYPES = new Set<PinType>(['provider', 'provider_text', 'provider_image', 'provider_voice']);
const MODEL_PIN_TYPES = new Set<PinType>(['model', 'model_text', 'model_image', 'model_voice']);

function providerScope(type: PinType): 'text' | 'image' | 'voice' | 'legacy' | null {
  if (type === 'provider') return 'legacy';
  if (type === 'provider_text') return 'text';
  if (type === 'provider_image') return 'image';
  if (type === 'provider_voice') return 'voice';
  return null;
}

export function inferRouteOverrideRouteKey(
  nodes: Node<FlowNodeData>[],
  edges: Edge[],
  connection: Connection
): string | null {
  if (!connection.source || !connection.target || !connection.sourceHandle || !connection.targetHandle) return null;

  const sourceNode = nodes.find((n) => n.id === connection.source);
  const targetNode = nodes.find((n) => n.id === connection.target);
  if (!sourceNode || !targetNode) return null;

  const sourcePin = sourceNode.data.outputs.find((p) => p.id === connection.sourceHandle);
  const targetPin = targetNode.data.inputs.find((p) => p.id === connection.targetHandle);
  if (!sourcePin || !targetPin) return null;
  if (sourcePin.type === 'execution' || targetPin.type === 'execution') return null;
  if (!areTypesCompatible(sourcePin.type, targetPin.type)) return null;

  const targetAlreadyConnected = edges.some(
    (e) => e.target === connection.target && e.targetHandle === connection.targetHandle && edgeData(e).routeOverride !== true
  );
  if (!targetAlreadyConnected) return null;

  const incomingExec = edges.filter((e) => e.target === connection.target && e.targetHandle === 'exec-in');
  if (incomingExec.length < 2) return null;

  const directRoutes = incomingExec.filter((e) => e.source === connection.source);
  if (directRoutes.length !== 1) return null;

  const direct = directRoutes[0];
  const key = routeKey(String(direct.source || '').trim(), String(direct.sourceHandle || 'exec-out').trim() || 'exec-out');
  if (!key || key === '::exec-out') return null;

  const routeAlreadyOverridden = edges.some((e) => {
    const data = edgeData(e);
    return (
      e.target === connection.target &&
      e.targetHandle === connection.targetHandle &&
      data.routeOverride === true &&
      data.routeKey === key
    );
  });
  return routeAlreadyOverridden ? null : key;
}

/**
 * Validate a connection between two nodes.
 * Returns true if the connection is valid based on pin types.
 */
export function validateConnection(
  nodes: Node<FlowNodeData>[],
  edges: Edge[],
  connection: Connection
): boolean {
  if (!connection.source || !connection.target) return false;
  if (!connection.sourceHandle || !connection.targetHandle) return false;

  const sourceNode = nodes.find((n) => n.id === connection.source);
  const targetNode = nodes.find((n) => n.id === connection.target);

  if (!sourceNode || !targetNode) return false;

  // Find the pins
  const sourcePin = sourceNode.data.outputs.find(
    (p) => p.id === connection.sourceHandle
  );
  const targetPin = targetNode.data.inputs.find(
    (p) => p.id === connection.targetHandle
  );

  if (!sourcePin || !targetPin) return false;

  const isExecutionConnection = sourcePin.type === 'execution' && targetPin.type === 'execution';

  // Self-loops are useful for explicit re-entry/recursive execution paths, but only
  // for exec-out -> exec-in. Data self-wiring stays rejected to avoid hidden cycles.
  if (connection.source === connection.target && !isExecutionConnection) return false;

  // Data inputs accept at most one connection. Execution inputs intentionally allow
  // fan-in; the runtime lowers that authoring graph into an internal join_exec node.
  if (!isExecutionConnection) {
    const targetAlreadyConnected = edges.some(
      (e) => e.target === connection.target && e.targetHandle === connection.targetHandle && edgeData(e).routeOverride !== true
    );
    if (targetAlreadyConnected && !inferRouteOverrideRouteKey(nodes, edges, connection)) return false;
  }

  // Execution outputs are 1:1 (use Sequence nodes for fan-out).
  if (isExecutionConnection) {
    const sourceAlreadyConnected = edges.some(
      (e) => e.source === connection.source && e.sourceHandle === connection.sourceHandle
    );
    if (sourceAlreadyConnected) return false;
  }

  return areTypesCompatible(sourcePin.type, targetPin.type);
}

/**
 * Check if two pin types are compatible for connection.
 */
export function areTypesCompatible(
  sourceType: PinType,
  targetType: PinType
): boolean {
  // Execution pins only connect to execution pins
  if (sourceType === 'execution' || targetType === 'execution') {
    return sourceType === 'execution' && targetType === 'execution';
  }

  // Tools is a specialized array of tool names (string[]).
  // Treat it as compatible with `array` (and keep the explicit `tools` type for UX).
  if (
    (sourceType === 'tools' && targetType === 'array') ||
    (sourceType === 'array' && targetType === 'tools')
  ) {
    return true;
  }

  // Assertions is a specialized array of KG assertions (assertion[]).
  // Treat it as compatible with `array` (and keep the explicit type for UX).
  if (
    (sourceType === 'assertions' && targetType === 'array') ||
    (sourceType === 'array' && targetType === 'assertions')
  ) {
    return true;
  }

  // 'any' type accepts anything
  if (sourceType === 'any' || targetType === 'any') {
    return true;
  }

  // Object can connect to object (for JSON compatibility)
  if (sourceType === 'object' && targetType === 'object') {
    return true;
  }

  // Assertion is an object-like type; allow assertion <-> object.
  if (
    (sourceType === 'assertion' && targetType === 'object') ||
    (sourceType === 'object' && targetType === 'assertion') ||
    (sourceType === 'assertion' && targetType === 'assertion')
  ) {
    return true;
  }

  // Memory is an object-like type; allow memory <-> object.
  if (
    (sourceType === 'memory' && targetType === 'object') ||
    (sourceType === 'object' && targetType === 'memory') ||
    (sourceType === 'memory' && targetType === 'memory')
  ) {
    return true;
  }

  // Assertions is array-like; allow assertions -> object for the same reason as array -> object.
  if (sourceType === 'assertions' && targetType === 'object') {
    return true;
  }
  if (sourceType === 'object' && targetType === 'assertions') {
    return true;
  }

  // Array can connect to object (objects can represent arrays)
  if (sourceType === 'array' && targetType === 'object') {
    return true;
  }

  // Tools is array-like; allow tools -> object for the same reason as array -> object.
  if (sourceType === 'tools' && targetType === 'object') {
    return true;
  }

  // Number can connect to string (implicit conversion)
  if (sourceType === 'number' && targetType === 'string') {
    return true;
  }

  // Boolean can connect to string (implicit conversion)
  if (sourceType === 'boolean' && targetType === 'string') {
    return true;
  }

  // Providers are modality-scoped for UX and safety. Legacy `provider` may bridge
  // into scoped pins for older saved flows. New scoped provider pins do not cross
  // modalities.
  if (PROVIDER_PIN_TYPES.has(sourceType) || PROVIDER_PIN_TYPES.has(targetType)) {
    const sourceScope = providerScope(sourceType);
    const targetScope = providerScope(targetType);
    if (sourceType === 'string' || targetType === 'string') return true;
    if (sourceScope && targetScope) return sourceScope === targetScope || sourceScope === 'legacy' || targetScope === 'legacy';
  }

  // Models are deliberately generic. The selected provider pin determines which
  // catalog a model value comes from; model_* aliases remain accepted only for
  // compatibility with old saved flows.
  if (MODEL_PIN_TYPES.has(sourceType) || MODEL_PIN_TYPES.has(targetType)) {
    if (sourceType === 'string' || targetType === 'string') return true;
    if (MODEL_PIN_TYPES.has(sourceType) && MODEL_PIN_TYPES.has(targetType)) return true;
  }

  // Exact type match
  return sourceType === targetType;
}

/**
 * Get a human-readable description of why a connection is invalid.
 */
export function getConnectionError(
  nodes: Node<FlowNodeData>[],
  edges: Edge[],
  connection: Connection
): string | null {
  if (!connection.source || !connection.target) {
    return 'Invalid connection endpoints';
  }

  const sourceNode = nodes.find((n) => n.id === connection.source);
  const targetNode = nodes.find((n) => n.id === connection.target);

  if (!sourceNode || !targetNode) {
    return 'Source or target node not found';
  }

  const sourcePin = sourceNode.data.outputs.find(
    (p) => p.id === connection.sourceHandle
  );
  const targetPin = targetNode.data.inputs.find(
    (p) => p.id === connection.targetHandle
  );

  if (!sourcePin) {
    return `Output pin '${connection.sourceHandle}' not found`;
  }

  if (!targetPin) {
    return `Input pin '${connection.targetHandle}' not found`;
  }

  const isExecutionConnection = sourcePin.type === 'execution' && targetPin.type === 'execution';

  if (connection.source === connection.target && !isExecutionConnection) {
    return 'Only execution self-loops are allowed';
  }

  if (!isExecutionConnection) {
    const targetAlreadyConnected = edges.some(
      (e) => e.target === connection.target && e.targetHandle === connection.targetHandle && edgeData(e).routeOverride !== true
    );
    if (targetAlreadyConnected) {
      if (inferRouteOverrideRouteKey(nodes, edges, connection)) return null;
      const incomingExecCount = edges.filter((e) => e.target === connection.target && e.targetHandle === 'exec-in').length;
      if (incomingExecCount > 1) {
        return `Input pin '${connection.targetHandle}' already has a default value. For multi-entry nodes, connect from a direct execution predecessor or use route overrides for per-path values.`;
      }
      return `Input pin '${connection.targetHandle}' already connected`;
    }
  }

  if (isExecutionConnection) {
    const sourceAlreadyConnected = edges.some(
      (e) => e.source === connection.source && e.sourceHandle === connection.sourceHandle
    );
    if (sourceAlreadyConnected) {
      return `Execution output pin '${connection.sourceHandle}' already connected`;
    }
  }

  if (!areTypesCompatible(sourcePin.type, targetPin.type)) {
    return `Type mismatch: cannot connect ${sourcePin.type} to ${targetPin.type}`;
  }

  return null;
}
