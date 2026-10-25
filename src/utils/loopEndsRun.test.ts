import type { Edge, Node } from 'reactflow';
import { beforeEach, describe, expect, it } from 'vitest';
import reported from './__fixtures__/loop_ends_run_flow.json';
import type { FlowNodeData, VisualFlow } from '../types/flow';
import { createNodeData, getNodeTemplate } from '../types/nodes';
import { applyFlowAuthoringCommands } from './flowAuthoringCommands';
import { flowSaveWarning, loopEndFix, loopEndsRunIssues, loopEndsRunMessage, loopEndsRunSaveWarning } from './loopEndsRun';
import { computeRunPreflightIssues } from './preflight';
import { useFlowStore } from '../hooks/useFlow';

const FOREACH_TEXT =
  "This loop stops after its first item: its body ends at On Flow End. Wire Done to On Flow End; the body's last node needs no wire out.";

const flow = reported as unknown as VisualFlow;
const nodes = flow.nodes as unknown as Node<FlowNodeData>[];
const edges = flow.edges as unknown as Edge[];

function node(id: string, type: Parameters<typeof getNodeTemplate>[0]): Node<FlowNodeData> {
  const template = getNodeTemplate(type);
  if (!template) throw new Error(`no template ${type}`);
  return { id, type: 'custom', position: { x: 0, y: 0 }, data: createNodeData(template) };
}
function wire(id: string, source: string, sourceHandle: string, target: string, targetHandle = 'exec-in'): Edge {
  return { id, source, sourceHandle, target, targetHandle };
}

describe('a loop whose body ends at On Flow End (the reported flow)', () => {
  it('finds ForEach -> Show Message -> Forward -> On Flow End, fixable (Done unwired)', () => {
    const forwardIntoEnd = edges.find((e) => e.source === 'node-7' && e.sourceHandle === 'exec-out' && e.target === 'node-2')!;
    expect(loopEndsRunIssues(nodes, edges)).toEqual([
      { loopId: 'node-3', endId: 'node-2', bodyEdgeIds: [forwardIntoEnd.id], fixable: true },
    ]);
  });

  it('words it plainly: ForEach stops after its first item, For / While after their first pass', () => {
    expect(loopEndsRunMessage('loop')).toBe(FOREACH_TEXT);
    expect(loopEndsRunMessage('for')).toContain('stops after its first pass');
    expect(loopEndsRunMessage('while')).toContain('stops after its first pass');
  });

  it('the fix removes the body wire into On Flow End and wires Done to it; data wires stay', () => {
    const result = applyFlowAuthoringCommands({
      flowName: 'x',
      flowInterfaces: [],
      nodes,
      edges,
      commands: [{ op: 'fix_loop_end', loop: 'node-3', end: 'node-2' }],
    });
    expect(result.errors).toEqual([]);
    expect(result.edges.some((e) => e.source === 'node-7' && e.sourceHandle === 'exec-out')).toBe(false);
    expect(result.edges.filter((e) => e.target === 'node-2' && e.targetHandle === 'exec-in')).toEqual([
      expect.objectContaining({ source: 'node-3', sourceHandle: 'done', target: 'node-2', targetHandle: 'exec-in' }),
    ]);
    // Forward's result / success still reach On Flow End (they hold the last item's values).
    expect(result.edges.filter((e) => e.target === 'node-2' && e.targetHandle !== 'exec-in').map((e) => e.targetHandle).sort()).toEqual(['notify', 'success']);
    expect(result.edges).toHaveLength(edges.length);
    expect(loopEndsRunIssues(result.nodes, result.edges)).toEqual([]);
  });

  it('save warning: the loop sentence after the automation check (this automation wires no response)', () => {
    expect(loopEndsRunSaveWarning(flow)).toBe(`ForEach: ${FOREACH_TEXT}`);
    expect(flowSaveWarning(flow)).toBe(
      `Saved. Each run’s result will be empty unless something is connected to On Flow End’s response. ForEach: ${FOREACH_TEXT}`
    );
    const plain = { ...flow, automation_defaults: undefined };
    expect(flowSaveWarning(plain)).toBe(`Saved. ForEach: ${FOREACH_TEXT}`);
  });

  it('run preflight: an advisory issue on the loop, carrying the fix', () => {
    const issues = computeRunPreflightIssues(nodes, edges).filter((i) => i.id.endsWith('loop-ends-run'));
    expect(issues).toEqual([
      {
        id: 'node-3:node-2:loop-ends-run',
        nodeId: 'node-3',
        nodeLabel: 'ForEach',
        message: FOREACH_TEXT,
        severity: 'warning',
        fix: { kind: 'loop_end', loopId: 'node-3', endId: 'node-2' },
      },
    ]);
  });
});

describe('loopEndsRunIssues', () => {
  const start = node('s', 'on_flow_start');
  const end = node('e', 'on_flow_end');
  const loop = node('l', 'loop');
  const a = node('a', 'answer_user');

  it('is silent for the right shape: body ends free, Done -> On Flow End', () => {
    const g = [wire('1', 's', 'exec-out', 'l'), wire('2', 'l', 'loop', 'a'), wire('3', 'l', 'done', 'e')];
    expect(loopEndsRunIssues([start, end, loop, a], g)).toEqual([]);
  });

  it('fires when the body wire goes straight into On Flow End', () => {
    const g = [wire('1', 's', 'exec-out', 'l'), wire('2', 'l', 'loop', 'e')];
    expect(loopEndsRunIssues([start, end, loop], g)).toEqual([{ loopId: 'l', endId: 'e', bodyEdgeIds: ['2'], fixable: true }]);
  });

  it('through either branch of an If/Else, both body wires are what the fix removes', () => {
    const iff = node('i', 'if');
    const b = node('b', 'answer_user');
    const g = [wire('1', 'l', 'loop', 'i'), wire('2', 'i', 'true', 'a'), wire('3', 'i', 'false', 'b'), wire('4', 'a', 'exec-out', 'e'), wire('5', 'b', 'exec-out', 'e')];
    expect(loopEndsRunIssues([end, loop, a, b, iff], g)).toEqual([{ loopId: 'l', endId: 'e', bodyEdgeIds: ['4', '5'], fixable: true }]);
  });

  it('applies to For and While (they have done)', () => {
    for (const type of ['for', 'while'] as const) {
      const l2 = node('l2', type);
      expect(loopEndsRunIssues([end, l2, a], [wire('1', 'l2', 'loop', 'a'), wire('2', 'a', 'exec-out', 'e')])).toEqual([
        { loopId: 'l2', endId: 'e', bodyEdgeIds: ['2'], fixable: true },
      ]);
    }
  });

  it('an inner loop body that ends the run is the inner loop’s case, not the outer one’s', () => {
    const inner = node('in', 'loop');
    const g = [wire('1', 'l', 'loop', 'in'), wire('2', 'in', 'loop', 'a'), wire('3', 'a', 'exec-out', 'e')];
    expect(loopEndsRunIssues([end, loop, inner, a], g).map((i) => i.loopId)).toEqual(['in']);
    // After the inner loop is done, still inside the outer body: the outer loop's case.
    const g2 = [wire('1', 'l', 'loop', 'in'), wire('2', 'in', 'done', 'a'), wire('3', 'a', 'exec-out', 'e')];
    expect(loopEndsRunIssues([end, loop, inner, a], g2).map((i) => i.loopId)).toEqual(['l']);
  });

  it('a body that loops back to the loop never counts the loop’s own Done', () => {
    const g = [wire('1', 'l', 'loop', 'a'), wire('2', 'a', 'exec-out', 'l'), wire('3', 'l', 'done', 'e')];
    expect(loopEndsRunIssues([end, loop, a], g)).toEqual([]);
  });

  it('with Done already leading elsewhere the fix does not guess', () => {
    const b = node('b', 'answer_user');
    const g = [wire('1', 'l', 'loop', 'a'), wire('2', 'a', 'exec-out', 'e'), wire('3', 'l', 'done', 'b')];
    expect(loopEndsRunIssues([end, loop, a, b], g)).toEqual([{ loopId: 'l', endId: 'e', bodyEdgeIds: ['2'], fixable: false }]);
    expect(loopEndFix([end, loop, a, b], g, 'l', 'e')).toBeNull();
    const result = applyFlowAuthoringCommands({ flowName: 'x', flowInterfaces: [], nodes: [end, loop, a, b], edges: g, commands: [{ op: 'fix_loop_end', loop: 'l', end: 'e' }] });
    expect(result.applied).toEqual([]);
    expect(result.errors[0]).toMatch(/fix_loop_end/);
  });
});

describe('Fix the loop on the canvas', () => {
  beforeEach(() => useFlowStore.getState().clearFlow());

  it('is one undo step', () => {
    useFlowStore.getState().setNodes(nodes);
    useFlowStore.getState().setEdges(edges);
    const before = useFlowStore.getState().edges;
    expect(useFlowStore.getState().fixLoopEnd('node-3', 'node-2')).toBe(true);
    expect(loopEndsRunIssues(useFlowStore.getState().nodes, useFlowStore.getState().edges)).toEqual([]);
    useFlowStore.getState().undo();
    expect(useFlowStore.getState().edges).toEqual(before);
    expect(loopEndsRunIssues(useFlowStore.getState().nodes, useFlowStore.getState().edges)).toHaveLength(1);
    useFlowStore.getState().redo();
    expect(loopEndsRunIssues(useFlowStore.getState().nodes, useFlowStore.getState().edges)).toEqual([]);
  });

});
