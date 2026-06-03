import type { Edge, Node } from 'reactflow';
import type { FlowNodeData, Pin } from '../types/flow';
import { isEntryNodeType } from '../types/flow';
import type { GatewayFlowEditorReadiness } from './gatewayClient';
import { gatewayAuthoringCapabilityStatus } from './gatewayClient';
import { getArtifactConnectionError, getConfiguredArtifactInputError } from './mediaArtifacts';
import { gatewayCapabilityForNodeType } from './nodeCapabilities';

export type RunPreflightIssue = {
  id: string;
  nodeId: string;
  nodeLabel: string;
  message: string;
};

export type RunPreflightOptions = {
  gatewayReadiness?: GatewayFlowEditorReadiness | null;
  gatewayCapabilitiesLoading?: boolean;
  gatewayCapabilitiesKnown?: boolean;
};

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isNonEmptyObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length > 0);
}

function inputConnected(edges: Edge[], nodeId: string, handleId: string): boolean {
  return edges.some((e) => e.target === nodeId && e.targetHandle === handleId);
}

function configValue(node: Node<FlowNodeData>, key: string): unknown {
  const effect = node.data.effectConfig as Record<string, unknown> | undefined;
  const defaults = node.data.pinDefaults as Record<string, unknown> | undefined;
  return effect?.[key] ?? defaults?.[key];
}

function stringInputPresent(edges: Edge[], node: Node<FlowNodeData>, ...handles: string[]): boolean {
  for (const handle of handles) {
    if (inputConnected(edges, node.id, handle)) return true;
    if (isNonEmptyString(configValue(node, handle))) return true;
  }
  return false;
}

function artifactInputPresent(edges: Edge[], node: Node<FlowNodeData>, ...handles: string[]): boolean {
  for (const handle of handles) {
    if (inputConnected(edges, node.id, handle)) return true;
    const value = configValue(node, handle);
    if (isNonEmptyString(value)) return true;
    if (isNonEmptyObject(value)) {
      if (isNonEmptyString(value.$artifact) || isNonEmptyString(value.artifact_id) || isNonEmptyString(value.id)) {
        return true;
      }
    }
  }
  return false;
}

function pinTypeOf(node: Node<FlowNodeData>, handleId: string, isInput: boolean): string | null {
  const pins = isInput ? node.data.inputs : node.data.outputs;
  const p = pins?.find((x) => x.id === handleId);
  return p ? String(p.type || '') : null;
}

function isExecutionEdge(nodesById: Map<string, Node<FlowNodeData>>, edge: Edge): boolean {
  const src = nodesById.get(edge.source);
  const tgt = nodesById.get(edge.target);
  if (!src || !tgt) return false;
  const st = pinTypeOf(src, edge.sourceHandle || '', false);
  const tt = pinTypeOf(tgt, edge.targetHandle || '', true);
  return st === 'execution' || tt === 'execution';
}

function inputPin(node: Node<FlowNodeData>, handleId: string | null | undefined): Pin | null {
  if (!handleId) return null;
  return node.data.inputs?.find((p) => p.id === handleId) || null;
}

function outputPin(node: Node<FlowNodeData>, handleId: string | null | undefined): Pin | null {
  if (!handleId) return null;
  return node.data.outputs?.find((p) => p.id === handleId) || null;
}

function reachableExecNodes(nodes: Node<FlowNodeData>[], edges: Edge[]): Set<string> {
  if (!nodes.length) return new Set<string>();
  const nodesById = new Map(nodes.map((n) => [n.id, n]));
  const entry =
    nodes.find((n) => isEntryNodeType(n.data.nodeType)) ||
    nodesById.get(nodes[0].id) ||
    null;
  if (!entry) return new Set<string>();

  const reachable = new Set<string>([entry.id]);
  const q: string[] = [entry.id];
  while (q.length) {
    const cur = q.shift() as string;
    for (const e of edges) {
      if (e.source !== cur) continue;
      if (!isExecutionEdge(nodesById, e)) continue;
      const nxt = e.target;
      if (!nxt || reachable.has(nxt)) continue;
      reachable.add(nxt);
      q.push(nxt);
    }
  }
  return reachable;
}

export function computeRunPreflightIssues(
  nodes: Node<FlowNodeData>[],
  edges: Edge[],
  options: RunPreflightOptions = {},
): RunPreflightIssue[] {
  const reachable = reachableExecNodes(nodes, edges);
  const nodesById = new Map(nodes.map((n) => [n.id, n]));
  const issues: RunPreflightIssue[] = [];

  const push = (node: Node<FlowNodeData>, message: string) => {
    const label = isNonEmptyString(node.data.label) ? node.data.label.trim() : node.id;
    issues.push({
      id: `${node.id}:${message}`,
      nodeId: node.id,
      nodeLabel: label,
      message,
    });
  };

  for (const edge of edges) {
    const target = nodesById.get(edge.target);
    if (!target || !reachable.has(target.id)) continue;
    const source = nodesById.get(edge.source);
    if (!source) continue;
    const sourcePin = outputPin(source, edge.sourceHandle);
    const targetPin = inputPin(target, edge.targetHandle);
    if (!sourcePin || !targetPin) continue;
    if (sourcePin.type === 'execution' || targetPin.type === 'execution') continue;
    const artifactError = getArtifactConnectionError(source.data, sourcePin, target.data, targetPin);
    if (artifactError) push(target, `${targetPin.label || targetPin.id}: ${artifactError}`);
  }

  for (const n of nodes) {
    if (!reachable.has(n.id)) continue;

    const capabilityStatus = gatewayAuthoringCapabilityStatus(
      options.gatewayReadiness,
      gatewayCapabilityForNodeType(n.data.nodeType),
      {
        loading: options.gatewayCapabilitiesLoading,
        known: options.gatewayCapabilitiesKnown,
      }
    );
    if (capabilityStatus && !capabilityStatus.checking && !capabilityStatus.available) {
      push(n, capabilityStatus.reason);
    }

    for (const pin of n.data.inputs || []) {
      if (inputConnected(edges, n.id, pin.id)) continue;
      const value = configValue(n, pin.id);
      const artifactError = getConfiguredArtifactInputError(n.data, pin, value);
      if (artifactError) push(n, `${pin.label || pin.id}: ${artifactError}`);
    }

    const t = n.data.nodeType;
    if (t === 'llm_call') {
      const providerExplicit =
        inputConnected(edges, n.id, 'provider') || isNonEmptyString(n.data.effectConfig?.provider);
      const modelExplicit =
        inputConnected(edges, n.id, 'model') || isNonEmptyString(n.data.effectConfig?.model);
      if (providerExplicit !== modelExplicit) {
        push(n, 'Set both provider and model, or leave both blank for Gateway defaults');
      }
    }

    if (t === 'agent') {
      const providerExplicit =
        inputConnected(edges, n.id, 'provider') || isNonEmptyString(n.data.agentConfig?.provider);
      const modelExplicit =
        inputConnected(edges, n.id, 'model') || isNonEmptyString(n.data.agentConfig?.model);
      if (providerExplicit !== modelExplicit) {
        push(n, 'Set both provider and model, or leave both blank for Gateway defaults');
      }
    }

    if (t === 'generate_image') {
      if (!stringInputPresent(edges, n, 'prompt')) push(n, 'Missing required input: prompt');
    }

    if (t === 'generate_video' || t === 'text_to_video') {
      if (!stringInputPresent(edges, n, 'prompt')) push(n, 'Missing required input: prompt');
    }

    if (t === 'image_to_video') {
      if (!stringInputPresent(edges, n, 'prompt')) push(n, 'Missing required input: prompt');
      if (!artifactInputPresent(edges, n, 'source_image', 'image_artifact')) {
        push(n, 'Missing required input: source_image');
      }
    }

    if (t === 'edit_image' || t === 'image_to_image') {
      if (!stringInputPresent(edges, n, 'prompt')) push(n, 'Missing required input: prompt');
      if (!artifactInputPresent(edges, n, 'image_artifact', 'source_image')) {
        push(n, 'Missing required input: image_artifact');
      }
    }

    if (t === 'generate_voice') {
      if (!stringInputPresent(edges, n, 'text')) push(n, 'Missing required input: text');
    }

    if (t === 'generate_music') {
      if (!stringInputPresent(edges, n, 'prompt')) push(n, 'Missing required input: prompt');
    }

    if (t === 'transcribe_audio') {
      if (!artifactInputPresent(edges, n, 'audio_artifact')) push(n, 'Missing required input: audio_artifact');
    }
  }

  // Stable ordering: node label then message (keeps UX consistent).
  issues.sort((a, b) => {
    const la = a.nodeLabel.toLowerCase();
    const lb = b.nodeLabel.toLowerCase();
    if (la !== lb) return la.localeCompare(lb);
    return a.message.localeCompare(b.message);
  });
  return issues;
}
