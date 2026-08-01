import type { FlowNodeData, Pin, VisualFlow } from '../types/flow';
import { isEntryNodeType } from '../types/flow';
import { getNodeTemplate } from '../types/nodes';
import {
  inferSchemaForNodeInput,
  normalizeResponseSchemaValue,
  schemaFromPin,
} from './outputSchemaInference';

export interface SavedFlowSummary {
  id: string;
  name: string;
}

/** One boundary pin of a workflow's public contract. */
export interface WorkflowContractPin {
  id: string;
  type: string;
  description?: string;
  /** Inputs only: no pin default means the caller must supply a value. */
  required?: boolean;
  /** Inputs only: the entry pin's default value, when one exists. */
  defaultValue?: unknown;
}

/**
 * A saved workflow's pick-time contract: identity, purpose, and boundary
 * (On Flow Start outputs = inputs; On Flow End inputs = outputs). This is
 * what a composer needs BEFORE referencing a workflow — the post-reference
 * `subflow_interface` context arrives too late to drive the choice.
 */
export interface WorkflowContractSummary {
  id: string;
  name: string;
  description?: string;
  inputs: WorkflowContractPin[];
  outputs: WorkflowContractPin[];
}

export type SubflowLabelData = {
  nodeType?: unknown;
  label?: unknown;
  subflowId?: unknown;
  flowId?: unknown;
  workflowId?: unknown;
  workflow_id?: unknown;
};

export function savedFlowSummariesFromResponse(value: unknown): SavedFlowSummary[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((flow): flow is SavedFlowSummary => {
      if (!flow || typeof flow !== 'object') return false;
      const record = flow as Record<string, unknown>;
      return typeof record.id === 'string' && typeof record.name === 'string';
    })
    .map((flow) => ({ id: flow.id, name: flow.name }));
}

/** Derive a workflow's pick-time contract from its full graph. */
export function workflowContractSummary(flow: VisualFlow): WorkflowContractSummary {
  const start = findFlowStartNode(flow);
  const end = findFlowEndNode(flow);
  const startDefaults = (start?.data?.pinDefaults || {}) as Record<string, unknown>;
  const inputs: WorkflowContractPin[] = (start?.data?.outputs || [])
    .filter((pin) => pin.type !== 'execution')
    .map((pin) => {
      const hasDefault = Object.prototype.hasOwnProperty.call(startDefaults, pin.id);
      return {
        id: pin.id,
        type: pin.type,
        ...(pin.description ? { description: pin.description } : {}),
        required: !hasDefault,
        ...(hasDefault ? { defaultValue: startDefaults[pin.id] } : {}),
      };
    });
  const outputs: WorkflowContractPin[] = (end?.data?.inputs || [])
    .filter((pin) => pin.type !== 'execution')
    .map((pin) => ({
      id: pin.id,
      type: pin.type,
      ...(pin.description ? { description: pin.description } : {}),
    }));
  return {
    id: flow.id,
    name: flow.name,
    ...(typeof flow.description === 'string' && flow.description.trim()
      ? { description: flow.description.trim() }
      : {}),
    inputs,
    outputs,
  };
}

/**
 * Full saved workflows from the collection response (the endpoint returns
 * complete graphs; the summary helper above deliberately drops them).
 */
export function savedFlowGraphsFromResponse(value: unknown): VisualFlow[] {
  if (!Array.isArray(value)) return [];
  return value.filter((flow): flow is VisualFlow => {
    if (!flow || typeof flow !== 'object') return false;
    const record = flow as Record<string, unknown>;
    return typeof record.id === 'string' && typeof record.name === 'string' && Array.isArray(record.nodes);
  });
}

export function savedFlowOptions(flows: SavedFlowSummary[], currentFlowId: string | null | undefined) {
  return flows.map((flow) => ({
    value: flow.id,
    label: `${flow.name} (${flow.id})${currentFlowId && flow.id === currentFlowId ? ' - this flow (recursive)' : ''}`,
  }));
}

export function subflowExecutionLabel(
  data: SubflowLabelData | null | undefined,
  flowNameById: Map<string, string>,
  fallbackNodeId: string
): string {
  if (!data || data.nodeType !== 'subflow') return fallbackNodeId;
  const subflowId =
    (typeof data.subflowId === 'string' && data.subflowId.trim()) ||
    (typeof data.flowId === 'string' && data.flowId.trim()) ||
    (typeof data.workflowId === 'string' && data.workflowId.trim()) ||
    (typeof data.workflow_id === 'string' && data.workflow_id.trim()) ||
    '';
  const flowName = subflowId ? flowNameById.get(subflowId)?.trim() || '' : '';
  if (flowName) return flowName;

  const label = typeof data.label === 'string' ? data.label.trim() : '';
  if (label && label.toLowerCase() !== 'subflow') return label;
  return subflowId || label || fallbackNodeId;
}

function findEntryNode(flow: VisualFlow) {
  const entryId = flow.entryNode;
  if (entryId) {
    const direct = flow.nodes.find((node) => node.id === entryId);
    if (direct) return direct;
  }

  const execTargets = new Set(
    flow.edges
      .filter((edge) => edge.targetHandle === 'exec-in')
      .map((edge) => edge.target)
  );

  return (
    flow.nodes.find((node) => isEntryNodeType(node.type) && !execTargets.has(node.id)) ||
    flow.nodes.find((node) => isEntryNodeType(node.type)) ||
    flow.nodes[0]
  );
}

function findFlowStartNode(flow: VisualFlow) {
  return flow.nodes.find((node) => node.type === 'on_flow_start') ?? findEntryNode(flow);
}

function findFlowEndNode(flow: VisualFlow) {
  return flow.nodes.find((node) => node.type === 'on_flow_end');
}

function samePins(a: Pin[], b: Pin[]): boolean {
  return (
    a.length === b.length &&
    a.every((pin, index) => {
      const other = b[index];
      return Boolean(
        other &&
          pin.id === other.id &&
          pin.label === other.label &&
          pin.type === other.type &&
          pin.description === other.description &&
          JSON.stringify(pin.schema ?? null) === JSON.stringify(other.schema ?? null)
      );
    })
  );
}

function firstPin(pins: Pin[] | undefined, predicate: (pin: Pin) => boolean, fallback: Pin): Pin {
  return pins?.find(predicate) ?? fallback;
}

function dataPins(pins: Pin[]): Pin[] {
  return pins.filter(
    (pin) =>
      pin.type !== 'execution' &&
      pin.id !== 'exec-in' &&
      pin.id !== 'exec-out' &&
      pin.id !== 'inherit_context' &&
      pin.id !== 'inheritContext'
  );
}

function schemaFromDefaultValue(data: FlowNodeData, pinId: string) {
  const defaults = data.pinDefaults;
  if (!defaults || typeof defaults !== 'object' || !(pinId in defaults)) return undefined;
  return normalizeResponseSchemaValue((defaults as Record<string, unknown>)[pinId]);
}

function entryPinForSubflowInput(data: FlowNodeData, pin: Pin): Pin {
  const schema = schemaFromPin(pin) ?? schemaFromDefaultValue(data, pin.id);
  return schema ? { ...pin, schema } : { ...pin };
}

function endPinForSubflowOutput(pin: Pin, endNode: ReturnType<typeof findFlowEndNode>, nodes: VisualFlow['nodes'], edges: VisualFlow['edges']): Pin {
  if (!endNode) return { ...pin };
  const schema = schemaFromPin(pin) ?? inferSchemaForNodeInput(endNode, pin.id, nodes, edges);
  return schema ? { ...pin, schema } : { ...pin };
}

export function defaultSubflowPinPatch(data: FlowNodeData): Pick<FlowNodeData, 'inputs' | 'outputs'> {
  const template = getNodeTemplate('subflow');
  return {
    inputs: (template?.inputs || data.inputs).map((pin) => ({ ...pin })),
    outputs: (template?.outputs || data.outputs).map((pin) => ({ ...pin })),
  };
}

export function subflowPinPatchForSelectedFlow(
  data: FlowNodeData,
  flow: VisualFlow,
  opts?: {
    nodeId?: string;
    edges?: Array<{
      source: string;
      sourceHandle?: string | null;
      target: string;
      targetHandle?: string | null;
    }>;
  }
): Pick<FlowNodeData, 'inputs' | 'outputs'> | null {
  // AN IN-USE SUBFLOW NODE IS NEVER REWRITTEN, in either convention.
  //
  // Rewriting an attached node to the child's interface pins orphans every
  // wire that does not survive the rename (persistence adversary P1-2: a
  // family copy rendered 60 of its 69 persisted edges after the sync fired).
  // That was first fixed for the ONE-OBJECT convention (a single `input`
  // object pin plus an `output` pin collecting the end fields), but the
  // hazard was never about the convention — it was about the WIRES.
  //
  // PER-FIELD nodes need the same protection, and more of it: an authored
  // node declares the child fields it actually sets (the caller may own six
  // of the child's twelve — see `wf_common.subflow_node`, where declaring a
  // field it does not own would push a None across the boundary and shadow
  // the child's own start-pin default), and it keeps the runtime-provided
  // `output` / `child_output` handles that carry the dead-child channel.
  // A blind sync would add the six it deliberately omits and DROP the death
  // channel, silently breaking a wired graph on load.
  //
  // A template-fresh node (nothing attached) still syncs — that is the
  // palette flow the interface sync exists for.
  const exprs = data.pinExpressions;
  const inputExpression =
    exprs && typeof exprs === 'object' ? (exprs as Record<string, unknown>).input : undefined;
  const hasInputExpression = typeof inputExpression === 'string' && inputExpression.trim().length > 0;
  const nid = opts?.nodeId;
  const isDataHandle = (handle?: string | null) =>
    Boolean(handle) && handle !== 'exec-in' && handle !== 'exec-out';
  const carriesEdge = Boolean(
    nid &&
      (opts?.edges || []).some(
        (e) =>
          (e.target === nid && isDataHandle(e.targetHandle)) ||
          (e.source === nid && isDataHandle(e.sourceHandle))
      )
  );
  if (hasInputExpression || carriesEdge) return null;

  const start = findFlowStartNode(flow);
  const end = findFlowEndNode(flow);

  const entryPins = start?.data?.outputs?.filter((pin) => pin.type !== 'execution') ?? [];
  const endPins = end?.data?.inputs?.filter((pin) => pin.type !== 'execution') ?? [];

  const template = getNodeTemplate('subflow');
  const templateInputs = template?.inputs || [];
  const templateOutputs = template?.outputs || [];

  const execIn = firstPin(data.inputs, (pin) => pin.type === 'execution', {
    id: 'exec-in',
    label: '',
    type: 'execution',
  });
  const inheritContext = firstPin(
    data.inputs,
    (pin) => pin.id === 'inherit_context' || pin.id === 'inheritContext',
    templateInputs.find((pin) => pin.id === 'inherit_context') ?? {
      id: 'inherit_context',
      label: 'inherit_context',
      type: 'boolean',
    }
  );
  const execOut = firstPin(data.outputs, (pin) => pin.type === 'execution', {
    id: 'exec-out',
    label: '',
    type: 'execution',
  });

  const childNodes = flow.nodes.map((node) => {
    if (start && node.id === start.id) {
      return {
        ...node,
        data: {
          ...node.data,
          outputs: (node.data.outputs || []).map((pin) => entryPinForSubflowInput(data, pin)),
        },
      };
    }
    return node;
  });

  const derivedEntryPins = start
    ? childNodes.find((node) => node.id === start.id)?.data.outputs?.filter((pin) => pin.type !== 'execution') ?? []
    : entryPins;
  const derivedEnd = end ? childNodes.find((node) => node.id === end.id) ?? end : end;
  const childEndPins = dataPins(endPins);

  const nextInputs: Pin[] = [execIn, inheritContext, ...dataPins(derivedEntryPins).map((pin) => ({ ...pin }))];
  const nextOutputs: Pin[] = [
    execOut,
    ...(childEndPins.length > 0
      ? childEndPins.map((pin) => endPinForSubflowOutput(pin, derivedEnd, childNodes, flow.edges))
      : dataPins(templateOutputs).map((pin) => ({ ...pin }))),
  ];

  if (samePins(data.inputs, nextInputs) && samePins(data.outputs, nextOutputs)) return null;
  return { inputs: nextInputs, outputs: nextOutputs };
}
