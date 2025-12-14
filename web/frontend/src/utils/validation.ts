/**
 * Connection validation for Blueprint-style type checking.
 */

import type { Node, Connection } from 'reactflow';
import type { FlowNodeData, PinType } from '../types/flow';

/**
 * Validate a connection between two nodes.
 * Returns true if the connection is valid based on pin types.
 */
export function validateConnection(
  nodes: Node<FlowNodeData>[],
  connection: Connection
): boolean {
  if (!connection.source || !connection.target) return false;
  if (!connection.sourceHandle || !connection.targetHandle) return false;

  // Can't connect to self
  if (connection.source === connection.target) return false;

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

  // 'any' type accepts anything
  if (sourceType === 'any' || targetType === 'any') {
    return true;
  }

  // Object can connect to object (for JSON compatibility)
  if (sourceType === 'object' && targetType === 'object') {
    return true;
  }

  // Array can connect to object (objects can represent arrays)
  if (sourceType === 'array' && targetType === 'object') {
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

  // Exact type match
  return sourceType === targetType;
}

/**
 * Get a human-readable description of why a connection is invalid.
 */
export function getConnectionError(
  nodes: Node<FlowNodeData>[],
  connection: Connection
): string | null {
  if (!connection.source || !connection.target) {
    return 'Invalid connection endpoints';
  }

  if (connection.source === connection.target) {
    return 'Cannot connect a node to itself';
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

  if (!areTypesCompatible(sourcePin.type, targetPin.type)) {
    return `Type mismatch: cannot connect ${sourcePin.type} to ${targetPin.type}`;
  }

  return null;
}
