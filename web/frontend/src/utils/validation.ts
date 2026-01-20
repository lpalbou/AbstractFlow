/**
 * Connection validation for Blueprint-style type checking.
 */

import type { Node, Connection, Edge } from 'reactflow';
import type { FlowNodeData, PinType } from '../types/flow';

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

  // Inputs accept at most one connection (Blueprint-style).
  const targetAlreadyConnected = edges.some(
    (e) => e.target === connection.target && e.targetHandle === connection.targetHandle
  );
  if (targetAlreadyConnected) return false;

  // Execution outputs are 1:1 (use Sequence nodes for fan-out).
  if (sourcePin.type === 'execution' && targetPin.type === 'execution') {
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

  // Provider/model are string-like (but we keep them as distinct types for UX).
  if (sourceType === 'provider' && (targetType === 'provider' || targetType === 'string')) return true;
  if (sourceType === 'model' && (targetType === 'model' || targetType === 'string')) return true;
  if (sourceType === 'string' && (targetType === 'provider' || targetType === 'model')) return true;

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

  const targetAlreadyConnected = edges.some(
    (e) => e.target === connection.target && e.targetHandle === connection.targetHandle
  );
  if (targetAlreadyConnected) {
    return `Input pin '${connection.targetHandle}' already connected`;
  }

  if (sourcePin.type === 'execution' && targetPin.type === 'execution') {
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
