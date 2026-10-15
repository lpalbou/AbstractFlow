import type { Edge, Node } from 'reactflow';
import type { FlowNodeData, Pin } from '../types/flow';
import { getNodeTemplate } from '../types/nodes';
import { displayDataPinTypeLabel } from './pinTypeOptions';
import { schemaTopFields } from './structuredOutput';
import { setVariableRows } from './setVariables';
import { loopLimitMax } from '../components/nodes/LoopLimitNode';

/**
 * What a node does, in a glimpse, for the execution view's hover card (operator 2026-10-14/15:
 * "the idea is just to focus here on the general flow and with tooltips to rapidly see the
 * parameters and input and output"). Sections of rows; a value says where it comes from: set on
 * the node, from a node's output (a Break Object is named by the field it reads, a relay by what
 * feeds it), or from a run variable. The Output section says what the node produces and where it
 * goes, through relays and Break Objects.
 */
export interface GlimpseRow {
  label: string;
  value: string;
  /** `text`: set on the node; `wire`: another node's output; `variable`: a run variable; `expression`: a pin expression; `empty`: nothing yet. */
  kind: 'text' | 'wire' | 'variable' | 'expression' | 'empty';
}

export interface GlimpseSection {
  title: string;
  rows: GlimpseRow[];
}

export interface Glimpse {
  title: string;
  subtitle: string;
  sections: GlimpseSection[];
  /** A longer text shown last (a system prompt, a template). */
  text?: { label: string; value: string };
}

const TEXT_MAX = 280;

function clip(text: string, max = TEXT_MAX): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function literal(value: unknown): string {
  if (value === undefined || value === null || value === '') return '';
  return typeof value === 'string' ? value : JSON.stringify(value);
}

type Graph = { nodes: Node<FlowNodeData>[]; edges: Edge[] };

function nodeOf(g: Graph, id: string): Node<FlowNodeData> | undefined {
  return g.nodes.find((n) => n.id === id);
}

function pinLabel(node: Node<FlowNodeData> | undefined, side: 'inputs' | 'outputs', pinId: string): string {
  const pin = node?.data[side]?.find((p) => p.id === pinId);
  return pin?.label || pinId;
}

/** Where a value comes from, named by what matters: the field a Break Object reads, the variable a getter reads, what feeds a relay. */
function describeSource(g: Graph, edge: Edge, hops = 0): { value: string; kind: GlimpseRow['kind'] } {
  const source = nodeOf(g, edge.source);
  if (!source || hops > 20) return { value: edge.source, kind: 'wire' };
  const handle = String(edge.sourceHandle || '');
  const d = source.data;
  if (d.nodeType === 'reroute') {
    const upstream = g.edges.find((e) => e.target === source.id);
    return upstream ? describeSource(g, upstream, hops + 1) : { value: 'an unfed relay', kind: 'empty' };
  }
  if (d.nodeType === 'get_var') {
    const name = str((d.pinDefaults as Record<string, unknown> | undefined)?.name);
    return { value: name || 'a variable', kind: 'variable' };
  }
  if (d.nodeType === 'get_vars') return { value: handle, kind: 'variable' };
  if (d.nodeType === 'break_object') {
    const objectEdge = g.edges.find((e) => e.target === source.id && e.targetHandle === 'object');
    const field = handle;
    if (objectEdge) {
      const inner = describeSource(g, objectEdge, hops + 1);
      return { value: `${inner.value}.${field}`, kind: inner.kind === 'variable' ? 'variable' : 'wire' };
    }
    return { value: `${d.label || 'Break Object'}.${field}`, kind: 'wire' };
  }
  if (d.nodeType === 'string_template') return { value: d.label || 'String Template', kind: 'wire' };
  if (d.nodeType === 'on_flow_start') return { value: `${pinLabel(source, 'outputs', handle)} (flow input)`, kind: 'wire' };
  return { value: `${d.label || d.nodeType} · ${pinLabel(source, 'outputs', handle)}`, kind: 'wire' };
}

/** What feeds one input: its wire (resolved), else a pin expression, else the value set on the node. */
function inputSource(g: Graph, node: Node<FlowNodeData>, pinId: string, valueMax = 90): { value: string; kind: GlimpseRow['kind'] } {
  const expression = (node.data.pinExpressions as Record<string, unknown> | undefined)?.[pinId];
  if (typeof expression === 'string' && expression.trim()) return { value: clip(expression, 60), kind: 'expression' };
  const edge = g.edges.find((e) => e.target === node.id && e.targetHandle === pinId);
  if (edge) return describeSource(g, edge);
  const value = literal((node.data.pinDefaults as Record<string, unknown> | undefined)?.[pinId]);
  return value ? { value: clip(value, valueMax), kind: 'text' } : { value: 'nothing yet', kind: 'empty' };
}

function row(g: Graph, node: Node<FlowNodeData>, label: string, pinId: string, options: { skipEmpty?: boolean; valueMax?: number } = {}): GlimpseRow | null {
  if (!(node.data.inputs || []).some((p) => p.id === pinId)) return null;
  const source = inputSource(g, node, pinId, options.valueMax);
  if (source.kind === 'empty' && options.skipEmpty) return null;
  return { label, value: source.value, kind: source.kind };
}

/** Where an output goes, through relays and Break Objects ("tasks → ForEach · items"). */
function consumers(g: Graph, nodeId: string, pinId: string, hops = 0): string[] {
  if (hops > 20) return [];
  const out: string[] = [];
  for (const edge of g.edges.filter((e) => e.source === nodeId && e.sourceHandle === pinId)) {
    const target = nodeOf(g, edge.target);
    if (!target) continue;
    const t = target.data;
    if (t.nodeType === 'reroute') {
      out.push(...consumers(g, target.id, 'out', hops + 1));
      continue;
    }
    if (t.nodeType === 'break_object') {
      for (const field of (t.outputs || []).filter((p) => p.type !== 'execution')) {
        const further = consumers(g, target.id, field.id, hops + 1);
        out.push(...(further.length ? further.map((c) => `${field.label || field.id} → ${c}`) : [`${field.label || field.id} (unused)`]));
      }
      continue;
    }
    const pin = pinLabel(target, 'inputs', String(edge.targetHandle || ''));
    out.push(t.nodeType === 'on_flow_end' ? `the flow's ${pin}` : `${t.label || t.nodeType} · ${pin}`);
  }
  return out;
}

/** Where an execution pin leads ("Reviewer", "Report Executor"). */
function execTargets(g: Graph, nodeId: string, pinId: string): string {
  return g.edges
    .filter((e) => e.source === nodeId && e.sourceHandle === pinId)
    .map((e) => nodeOf(g, e.target)?.data.label || e.target)
    .join(', ');
}

function outputRows(g: Graph, node: Node<FlowNodeData>, pins: Pin[]): GlimpseRow[] {
  return pins.map((pin) => {
    const to = consumers(g, node.id, pin.id);
    const type = displayDataPinTypeLabel(pin);
    return { label: `${pin.label || pin.id} · ${type}`, value: to.length ? `→ ${to.join(', ')}` : 'not used', kind: to.length ? 'wire' : 'empty' };
  });
}

export function execGlimpse(node: Node<FlowNodeData>, nodes: Node<FlowNodeData>[], edges: Edge[]): Glimpse {
  const g: Graph = { nodes, edges };
  const data = node.data;
  const template = getNodeTemplate(data.nodeType);
  const typeLabel = template?.label || data.nodeType;
  const title = data.label || typeLabel;
  const subtitle = data.label && data.label !== typeLabel ? typeLabel : '';
  const defaults = (data.pinDefaults || {}) as Record<string, unknown>;
  const dataOutputs = (data.outputs || []).filter((p) => p.type !== 'execution');
  const sections: GlimpseSection[] = [];
  let text: Glimpse['text'];
  const section = (name: string, rows: Array<GlimpseRow | null>) => {
    const kept = rows.filter((r): r is GlimpseRow => Boolean(r));
    if (kept.length) sections.push({ title: name, rows: kept });
  };
  const R = (label: string, pinId: string, options?: { skipEmpty?: boolean; valueMax?: number }) => row(g, node, label, pinId, options);

  switch (data.nodeType) {
    case 'llm_call':
    case 'agent': {
      const cfg = ((data.nodeType === 'agent' ? data.agentConfig : data.effectConfig) || {}) as Record<string, unknown>;
      const fixed = (pinId: string, key: string) => str(cfg[key]) || str(defaults[pinId]);
      const modelRow = (label: string, pinId: string) => {
        const viaPin = R(label, pinId, { skipEmpty: true });
        if (viaPin && viaPin.kind !== 'text') return viaPin;
        const value = fixed(pinId, pinId);
        return value ? { label, value, kind: 'text' as const } : viaPin;
      };
      section('Model', [modelRow('Provider', 'provider'), modelRow('Model', 'model')]);
      const inputs: Array<GlimpseRow | null> = [R('Prompt', 'prompt')];
      if (data.nodeType === 'agent') {
        const tools = Array.isArray(defaults.tools) ? defaults.tools : Array.isArray(cfg.tools) ? cfg.tools : null;
        const toolsWired = R('Tools', 'tools', { skipEmpty: true });
        if (tools) inputs.push({ label: 'Tools', value: tools.length === 0 ? 'none' : `${tools.length}: ${clip(tools.join(', '), 120)}`, kind: 'text' });
        else if (toolsWired && toolsWired.kind !== 'text') inputs.push(toolsWired);
        const maxIter = defaults.max_iterations ?? cfg.max_iterations;
        if (typeof maxIter === 'number') inputs.push({ label: 'Cycles at most', value: String(maxIter), kind: 'text' });
        if (defaults.use_context === true) inputs.push({ label: 'Context', value: 'shares the run conversation', kind: 'text' });
      }
      section('Inputs', inputs);
      const fields = schemaTopFields(defaults.resp_schema);
      const schemaWired = R('Shape', 'resp_schema', { skipEmpty: true });
      const outputs: GlimpseRow[] = [];
      if (fields) outputs.push({ label: 'Structured', value: fields.map((f) => `${f.name}: ${f.type}`).join(', '), kind: 'text' });
      else if (schemaWired && schemaWired.kind !== 'text') outputs.push({ ...schemaWired, label: 'Structured' });
      else outputs.push({ label: 'Free text', value: 'no structured response', kind: 'text' });
      const used = outputRows(g, node, dataOutputs).filter((r) => r.kind === 'wire');
      section('Output', [...outputs, ...used]);
      const system = str(cfg.system) || str(defaults.system);
      const systemWired = R('System', 'system', { skipEmpty: true });
      if (system) text = { label: 'System prompt', value: clip(system) };
      else if (systemWired && systemWired.kind !== 'text') section('System', [systemWired]);
      break;
    }
    case 'set_vars':
      section(
        'Sets',
        setVariableRows(data.inputs || []).map((pin) => {
          const source = inputSource(g, node, pin.id, 60);
          return { label: pin.id, value: source.kind === 'empty' ? 'empty' : source.value, kind: source.kind === 'empty' ? 'text' : source.kind };
        })
      );
      break;
    case 'add_to_list':
      section('Adds to', [R('List', 'name'), R('Item', 'item', { skipEmpty: true }), R('Each of', 'items', { skipEmpty: true })]);
      section('Output', outputRows(g, node, dataOutputs).filter((r) => r.kind === 'wire'));
      break;
    case 'set_var':
      section('Sets', [R('Variable', 'name'), R('Value', 'value')]);
      break;
    case 'get_vars':
      section('Reads', outputRows(g, node, dataOutputs));
      break;
    case 'string_template':
      text = { label: 'Text', value: clip(str(defaults.template)) };
      section('Output', outputRows(g, node, dataOutputs));
      break;
    case 'if':
      section('Branches on', [R('Condition', 'condition')]);
      break;
    case 'while':
      section('Repeats while', [R('Condition', 'condition')]);
      break;
    case 'loop':
      section('Loops over', [R('Items', 'items')]);
      section('Each pass', outputRows(g, node, dataOutputs));
      break;
    case 'for':
      section('Counts', [R('From', 'start'), R('To', 'end'), R('Step', 'step', { skipEmpty: true })]);
      break;
    case 'loop_limit': {
      const maxRow = R('Passes at most', 'max', { skipEmpty: true });
      section('Limit', [maxRow && maxRow.kind !== 'text' ? maxRow : { label: 'Passes at most', value: String(loopLimitMax(data)), kind: 'text' }]);
      section('Then', [
        { label: 'Again', value: execTargets(g, node.id, 'again') || 'nothing', kind: execTargets(g, node.id, 'again') ? 'wire' : 'empty' },
        { label: 'Limit reached', value: execTargets(g, node.id, 'limit_reached') || 'the path ends here', kind: execTargets(g, node.id, 'limit_reached') ? 'wire' : 'empty' },
      ]);
      section('Output', outputRows(g, node, dataOutputs).filter((r) => r.kind === 'wire'));
      break;
    }
    case 'switch': {
      const cases = data.switchConfig?.cases || [];
      section('Switches on', [R('Value', 'value'), cases.length ? { label: 'Cases', value: clip(cases.map((c) => c.value).join(', '), 90), kind: 'text' } : null]);
      break;
    }
    case 'answer_user':
      section('Shows', [R('Message', 'message'), R('Level', 'level', { skipEmpty: true })]);
      break;
    case 'ask_user':
      section('Asks', [R('Question', 'prompt')]);
      section('Output', outputRows(g, node, dataOutputs).filter((r) => r.kind === 'wire'));
      break;
    case 'on_flow_start':
      section('Flow inputs', outputRows(g, node, dataOutputs));
      break;
    case 'on_flow_end':
      section('Flow outputs', (data.inputs || []).filter((p) => p.type !== 'execution').map((p) => R(p.label || p.id, p.id)));
      break;
    default: {
      section('Inputs', (data.inputs || []).filter((p) => p.type !== 'execution').slice(0, 8).map((p) => R(p.label || p.id, p.id, { skipEmpty: true })));
      section('Output', outputRows(g, node, dataOutputs).filter((r) => r.kind === 'wire'));
    }
  }
  return { title, subtitle, sections, text };
}

/** The glimpse of a wire that makes execution repeat: its path, its limit, what happens at the limit. */
export function wireLoopGlimpse(
  edge: Edge,
  nodes: Node<FlowNodeData>[],
  edges: Edge[],
  state: 'limitable' | 'limited' | 'node-limited' | 'unsupported',
  max: number | null
): Glimpse {
  const g: Graph = { nodes, edges };
  const source = nodeOf(g, edge.source);
  const target = nodeOf(g, edge.target);
  const fromPin = pinLabel(source, 'outputs', String(edge.sourceHandle || ''));
  const sections: GlimpseSection[] = [
    {
      title: 'Repeats',
      rows: [
        { label: 'From', value: `${source?.data.label || edge.source} · ${fromPin}`, kind: 'wire' },
        { label: 'Back to', value: target?.data.label || edge.target, kind: 'wire' },
      ],
    },
  ];
  if (state === 'limited' && max !== null) {
    const rows: GlimpseRow[] = [{ label: 'At most', value: `${max} times`, kind: 'text' }];
    if (source?.data.nodeType === 'if') {
      const other = edge.sourceHandle === 'false' ? 'true' : 'false';
      const goesOn = execTargets(g, source.id, other);
      rows.push({ label: 'Then', value: goesOn ? `goes on to ${goesOn} (the ${other} branch)` : `the ${other} branch is not wired: the path ends`, kind: goesOn ? 'wire' : 'empty' });
    } else {
      rows.push({ label: 'Then', value: 'the path ends here (only an If/Else goes on through its other branch)', kind: 'empty' });
    }
    sections.push({ title: 'Limit', rows });
  } else if (state === 'limitable') {
    sections.push({ title: 'Limit', rows: [{ label: 'At most', value: 'no limit yet · click to set one', kind: 'empty' }] });
  } else if (state === 'node-limited') {
    sections.push({ title: 'Limit', rows: [{ label: 'At most', value: 'capped elsewhere on the loop · click to cap this wire too', kind: 'empty' }] });
  } else {
    sections.push({
      title: 'Limit',
      rows: [
        {
          label: 'At most',
          value:
            "cannot be set here: this wire goes back out of a loop body and the run would never end. A path inside a loop body can only repeat within the body; to repeat the whole loop, wire the loop-back after the loop's done.",
          kind: 'empty',
        },
      ],
    });
  }
  return { title: state === 'limited' ? `Repeats ${max}×` : 'Repeating path', subtitle: 'wire', sections };
}
