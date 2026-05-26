import type { Edge, Node } from 'reactflow';
import type { FlowNodeData } from '../types/flow';
import { createNodeData, getNodeTemplate } from '../types/nodes';
import type { GatewayContracts } from './gatewayClient';

export type ModelResidencyOperation = 'load' | 'unload';

export interface ModelResidencyTarget {
  task: string;
  provider: string;
  model: string;
}

export interface InsertModelResidencyStepArgs {
  nodes: Node<FlowNodeData>[];
  edges: Edge[];
  selectedNode: Node<FlowNodeData>;
  operation: ModelResidencyOperation;
  target: ModelResidencyTarget;
}

export interface InsertModelResidencyStepResult {
  nodes: Node<FlowNodeData>[];
  edges: Edge[];
  nodeId: string;
}

export function modelResidencyTaskLabel(task: string): string {
  if (task === 'text_generation') return 'Text generation';
  if (task === 'image_generation') return 'Image generation';
  if (task === 'tts') return 'Speech';
  if (task === 'stt') return 'Transcription';
  if (task === 'music_generation') return 'Music generation';
  return task.replace(/_/g, ' ');
}

export function modelResidencyTaskUnsupportedReason(
  contracts: GatewayContracts | null | undefined,
  task: string
): string {
  const cleanTask = String(task || '').trim();
  if (!cleanTask) return '';
  const residency =
    contracts?.common?.model_residency ||
    ((contracts?.flow_editor as Record<string, unknown> | undefined)?.model_residency as
      | Record<string, unknown>
      | undefined) ||
    ((contracts?.assistant as Record<string, unknown> | undefined)?.model_residency as
      | Record<string, unknown>
      | undefined);
  if (!residency || typeof residency !== 'object') return '';

  const routeAvailable = (residency as Record<string, unknown>).route_available;
  if (routeAvailable === false) {
    return 'Model residency controls are not available on this Gateway runtime.';
  }

  // Task support can be stale or deployment-specific; Gateway remains the control
  // boundary, so authoring should not disable load/unload controls when the
  // Gateway model-residency route itself is available.
  return '';
}

export function insertModelResidencyStep({
  nodes,
  edges,
  selectedNode,
  operation,
  target,
}: InsertModelResidencyStepArgs): InsertModelResidencyStepResult {
  const template = getNodeTemplate('model_residency');
  if (!template) {
    throw new Error('Model Residency node template is unavailable.');
  }

  const provider = target.provider.trim();
  const model = target.model.trim();

  const now = Date.now();
  const id = `node-residency-${operation}-${now}-${Math.random().toString(16).slice(2, 7)}`;
  const baseData = createNodeData(template);
  const effectConfig = {
    ...(baseData.effectConfig || {}),
    operation,
    task: target.task,
    ...(provider ? { provider } : {}),
    ...(model ? { model } : {}),
  };
  const pinDefaults = {
    ...(baseData.pinDefaults || {}),
    operation,
    task: target.task,
    ...(provider ? { provider } : {}),
    ...(model ? { model } : {}),
  };

  const newNode: Node<FlowNodeData> = {
    id,
    type: 'custom',
    position: {
      x: selectedNode.position.x + (operation === 'load' ? -360 : 360),
      y: selectedNode.position.y,
    },
    data: {
      ...baseData,
      label: operation === 'load' ? 'Load Model' : 'Unload Model',
      effectConfig,
      pinDefaults,
    },
  };

  const execEdge = (source: string, targetNode: string, idx: number): Edge => ({
    id: `edge-residency-${operation}-${now}-${idx}`,
    source,
    target: targetNode,
    sourceHandle: 'exec-out',
    targetHandle: 'exec-in',
    animated: true,
  });

  const selectedNodeId = selectedNode.id;
  let nextEdges: Edge[] = [];
  if (operation === 'load') {
    const inbound = edges.filter((e) => e.target === selectedNodeId && e.targetHandle === 'exec-in');
    const inboundIds = new Set(inbound.map((e) => e.id));
    nextEdges = edges.filter((e) => !inboundIds.has(e.id));
    inbound.forEach((edge, idx) => {
      nextEdges.push({
        ...edge,
        id: `edge-residency-in-${now}-${idx}`,
        target: id,
        targetHandle: 'exec-in',
      });
    });
    nextEdges.push(execEdge(id, selectedNodeId, 0));
  } else {
    const outbound = edges.filter((e) => e.source === selectedNodeId && e.sourceHandle === 'exec-out');
    const outboundIds = new Set(outbound.map((e) => e.id));
    nextEdges = edges.filter((e) => !outboundIds.has(e.id));
    nextEdges.push(execEdge(selectedNodeId, id, 0));
    outbound.forEach((edge, idx) => {
      nextEdges.push({
        ...edge,
        id: `edge-residency-out-${now}-${idx}`,
        source: id,
        sourceHandle: 'exec-out',
      });
    });
  }

  return {
    nodes: [...nodes, newNode],
    edges: nextEdges,
    nodeId: id,
  };
}
