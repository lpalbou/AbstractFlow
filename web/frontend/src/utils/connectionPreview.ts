import type { Connection, Edge, Node } from 'reactflow';
import type { ConnectionPreviewState, FlowNodeData, PinConnectionFeedback, PinType } from '../types/flow';
import { getConnectionError, validateConnection } from './validation';

export type ConnectionDragEndpoint = {
  nodeId: string;
  handleId: string;
  handleType: 'source' | 'target';
  pinType?: PinType;
};

function feedbackForConnection(nodes: Node<FlowNodeData>[], edges: Edge[], connection: Connection): PinConnectionFeedback {
  const valid = validateConnection(nodes, edges, connection);
  if (valid) return { status: 'valid', message: 'Compatible target' };
  return { status: 'invalid', message: getConnectionError(nodes, edges, connection) || 'Invalid connection' };
}

export function buildConnectionPreviewForNode(
  nodes: Node<FlowNodeData>[],
  edges: Edge[],
  active: ConnectionDragEndpoint,
  node: Node<FlowNodeData>
): ConnectionPreviewState {
  const preview: ConnectionPreviewState = {
    active: true,
    sourceType: active.pinType,
  };

  if (active.handleType === 'source') {
    const inputs: Record<string, PinConnectionFeedback> = {};
    for (const pin of node.data.inputs || []) {
      inputs[pin.id] = feedbackForConnection(nodes, edges, {
        source: active.nodeId,
        sourceHandle: active.handleId,
        target: node.id,
        targetHandle: pin.id,
      });
    }
    preview.inputs = inputs;
    return preview;
  }

  const outputs: Record<string, PinConnectionFeedback> = {};
  for (const pin of node.data.outputs || []) {
    outputs[pin.id] = feedbackForConnection(nodes, edges, {
      source: node.id,
      sourceHandle: pin.id,
      target: active.nodeId,
      targetHandle: active.handleId,
    });
  }
  preview.outputs = outputs;
  return preview;
}

export function connectionHintText(active: ConnectionDragEndpoint | null, hovered?: PinConnectionFeedback | null): string {
  if (!active) return '';
  if (hovered?.status === 'invalid' && hovered.message) return hovered.message;
  if (hovered?.status === 'valid') return hovered.message || 'Compatible target';
  return active.pinType ? `Dragging ${active.pinType}` : 'Dragging connection';
}
