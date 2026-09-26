import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import type { VisualFlow } from '../types/flow';
import { listBundledFlows } from '../utils/bundledFlows';
import { loadEdgeNotice, useFlowStore } from './useFlow';

// A load -> save round trip must never lose an edge silently. Every stored
// edge is either saved again, or reported as dropped with a reason.

const FLOWS_DIR = resolve(__dirname, '../../examples/flows');

function corpus(): VisualFlow[] {
  const byId = new Map<string, VisualFlow>();
  for (const name of readdirSync(FLOWS_DIR).filter((n) => n.endsWith('.json'))) {
    const flow = JSON.parse(readFileSync(resolve(FLOWS_DIR, name), 'utf8')) as VisualFlow;
    if (Array.isArray(flow?.nodes) && Array.isArray(flow?.edges)) byId.set(`file:${name}`, flow);
  }
  for (const flow of listBundledFlows()) byId.set(`bundled:${flow.id}`, flow);
  return [...byId.values()];
}

describe('loadFlow edge round trip', () => {
  beforeEach(() => useFlowStore.getState().clearFlow());

  it('over the whole example + bundled corpus: every stored edge is saved again or reported dropped', () => {
    const flows = corpus();
    expect(flows.length).toBeGreaterThan(150);
    const silent: string[] = [];
    let edgesChecked = 0;
    for (const flow of flows) {
      useFlowStore.getState().loadFlow(flow);
      const { loadEdgeReport } = useFlowStore.getState();
      const saved = new Set(useFlowStore.getState().getFlow().edges.map((e) => e.id));
      const dropped = new Set(loadEdgeReport.dropped.map((n) => n.id));
      for (const edge of flow.edges) {
        edgesChecked += 1;
        if (!saved.has(edge.id) && !dropped.has(edge.id)) silent.push(`${flow.id}: ${edge.id}`);
      }
      for (const note of loadEdgeReport.dropped) expect(note.reason).toBeTruthy();
    }
    expect(edgesChecked).toBeGreaterThan(1000);
    expect(silent).toEqual([]);
  });

  it('the round trip is stable: re-loading the saved document keeps the same edges', () => {
    for (const flow of corpus()) {
      useFlowStore.getState().loadFlow(flow);
      const first = useFlowStore.getState().getFlow();
      useFlowStore.getState().loadFlow(first);
      const second = useFlowStore.getState().getFlow();
      expect(second.edges.map((e) => e.id).sort(), flow.id).toEqual(first.edges.map((e) => e.id).sort());
      expect(useFlowStore.getState().loadEdgeReport.dropped, flow.id).toEqual([]);
    }
  });

  it('entity-chat keeps all 22 connections; the 8 on undeclared pins are preserved and reported', () => {
    const flow = listBundledFlows().find((f) => f.id === 'entity-chat')!;
    expect(flow.edges).toHaveLength(22);
    const loaded = useFlowStore.getState().loadFlow(flow);
    const state = useFlowStore.getState();
    expect(state.loadEdgeReport.dropped).toEqual([]);
    expect(state.loadEdgeReport.preserved.map((n) => n.edge).sort()).toEqual([
      'chat_state.state -> visit_in.state',
      'degraded_fold.degraded -> end.degraded',
      'degraded_fold.moment_error -> end.moment_error',
      'visit.child_output -> visit_guard.child',
      'visit_guard.died -> degraded_fold.guard_died',
      'visit_guard.error -> degraded_fold.guard_error',
      'visit_guard.value -> end.answer',
      'visit_guard.value -> end.response',
    ]);
    expect(state.loadEdgeReport.preserved[0].reason).toMatch(/is not a declared output of/);
    // Saved = stored: same 22 edges, and the loaded baseline matches (no false dirty).
    const saved = state.getFlow();
    expect(saved.edges.map((e) => e.id).sort()).toEqual(flow.edges.map((e) => e.id).sort());
    expect(loaded.edges.map((e) => e.id).sort()).toEqual(saved.edges.map((e) => e.id).sort());
    expect(loadEdgeNotice(state.loadEdgeReport)).toMatch(/^8 connections use pins the node does not declare; kept and saved, but not drawn: /);
  });

  it('preserved edges follow their nodes: deleting an endpoint removes them from the save', () => {
    const flow = listBundledFlows().find((f) => f.id === 'entity-chat')!;
    useFlowStore.getState().loadFlow(flow);
    useFlowStore.getState().deleteNode('degraded_fold');
    const saved = useFlowStore.getState().getFlow();
    expect(saved.edges.some((e) => e.source === 'degraded_fold' || e.target === 'degraded_fold')).toBe(false);
    expect(saved.edges.some((e) => e.source === 'visit_guard' && e.sourceHandle === 'value')).toBe(true);
  });

  it('a truly invalid edge is dropped LOUDLY with its reason', () => {
    const flow = listBundledFlows().find((f) => f.id === 'entity-chat')!;
    const broken = {
      ...flow,
      edges: [...flow.edges, { id: 'ghost', source: 'nowhere', sourceHandle: 'x', target: 'end', targetHandle: 'answer' }],
    } as VisualFlow;
    useFlowStore.getState().loadFlow(broken);
    const report = useFlowStore.getState().loadEdgeReport;
    expect(report.dropped).toEqual([{ id: 'ghost', edge: 'nowhere.x -> end.answer', reason: "node 'nowhere' does not exist" }]);
    expect(loadEdgeNotice(report)).toMatch(/^1 connection was dropped and will not be saved: nowhere\.x -> end\.answer \(node 'nowhere' does not exist\)/);
    expect(loadEdgeNotice({ preserved: [], dropped: [] })).toBeNull();
  });
});
