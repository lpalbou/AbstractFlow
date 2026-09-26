import { describe, expect, it } from 'vitest';
import { savedBaselineSnapshot, shouldRebaselineOnIdentityChange } from './saveBaseline';
import type { VisualFlow } from '../types/flow';

function sent(overrides: Partial<VisualFlow> = {}): VisualFlow {
  return {
    id: 'flow-1785440497713',
    name: 'improved-answer',
    interfaces: [],
    nodes: [{ id: 'node-1', type: 'on_flow_start', position: { x: 0, y: 0 }, data: {} }],
    edges: [],
    entryNode: 'node-1',
    ...overrides,
  } as VisualFlow;
}

describe('savedBaselineSnapshot', () => {
  it('adopts the gateway id', () => {
    expect(savedBaselineSnapshot(sent(), '0795e76f').id).toBe('0795e76f');
  });

  it('keeps the client id when the gateway returned none', () => {
    expect(savedBaselineSnapshot(sent(), null).id).toBe('flow-1785440497713');
  });

  // The regression: the baseline used to absorb the server's description, which
  // getFlow() can never reproduce (the store has no description field). Result:
  // a successful save left the flow permanently dirty and permanently un-runnable.
  it('does not absorb server fields the editor cannot reproduce', () => {
    const baseline = savedBaselineSnapshot(sent(), 'abc');
    expect(baseline.description).toBeUndefined();
    expect(baseline.name).toBe('improved-answer');
  });

  it('preserves everything that was actually sent', () => {
    const flow = sent({ interfaces: ['abstractcode.agent.v1'], entryNode: 'node-7' });
    const baseline = savedBaselineSnapshot(flow, 'abc');
    expect(baseline.interfaces).toEqual(['abstractcode.agent.v1']);
    expect(baseline.entryNode).toBe('node-7');
    expect(baseline.nodes).toBe(flow.nodes);
  });
});

describe('shouldRebaselineOnIdentityChange', () => {
  it('re-baselines when a flow is loaded', () => {
    expect(
      shouldRebaselineOnIdentityChange({ nextFlowId: 'abc', isEmptyFlow: false, saveJustSucceeded: false })
    ).toBe(true);
  });

  it('re-baselines when the canvas is cleared', () => {
    expect(
      shouldRebaselineOnIdentityChange({ nextFlowId: null, isEmptyFlow: true, saveJustSucceeded: false })
    ).toBe(true);
  });

  it('leaves an unsaved non-empty document alone', () => {
    expect(
      shouldRebaselineOnIdentityChange({ nextFlowId: null, isEmptyFlow: false, saveJustSucceeded: false })
    ).toBe(false);
  });

  // The regression: after a create, flowId transitions null -> id. Re-baselining
  // there would mark edits made DURING the request as already-saved and drop
  // them from the dirty dot, the unload guard and the local draft alike.
  it('never overwrites the baseline a completed save just published', () => {
    expect(
      shouldRebaselineOnIdentityChange({ nextFlowId: 'abc', isEmptyFlow: false, saveJustSucceeded: true })
    ).toBe(false);
    expect(
      shouldRebaselineOnIdentityChange({ nextFlowId: 'abc', isEmptyFlow: true, saveJustSucceeded: true })
    ).toBe(false);
  });
});

// End-to-end statement of the invariant the two functions exist to protect.
describe('in-flight edits survive a first save', () => {
  const signature = (flow: VisualFlow) => JSON.stringify({ nodes: flow.nodes.length, name: flow.name });

  it('stays dirty when the graph changed while the request was in flight', () => {
    const s0 = sent(); // snapshot handed to mutate()
    const s1 = sent({ nodes: [...s0.nodes, { id: 'node-2', type: 'llm_call', position: { x: 1, y: 1 }, data: {} }] } as Partial<VisualFlow>);

    // The save completes and publishes its baseline from what was SENT.
    const baseline = signature(savedBaselineSnapshot(s0, 'abc'));
    // The identity effect then declines to re-baseline to the current graph.
    expect(
      shouldRebaselineOnIdentityChange({ nextFlowId: 'abc', isEmptyFlow: false, saveJustSucceeded: true })
    ).toBe(false);

    expect(signature(s1)).not.toBe(baseline); // still dirty -> still saveable
  });

  it('goes clean when nothing changed during the request', () => {
    const s0 = sent();
    expect(signature(s0)).toBe(signature(savedBaselineSnapshot(s0, 'abc')));
  });
});

describe('shouldRebaselineOnIdentityChange after a load', () => {
  it('keeps the baseline a load published for this flow (pins added on open stay unsaved)', () => {
    expect(
      shouldRebaselineOnIdentityChange({
        nextFlowId: 'abc',
        isEmptyFlow: false,
        saveJustSucceeded: false,
        loadBaselineFlowId: 'abc',
      })
    ).toBe(false);
  });

  it('a load baseline for another flow does not block re-baselining', () => {
    expect(
      shouldRebaselineOnIdentityChange({
        nextFlowId: 'xyz',
        isEmptyFlow: false,
        saveJustSucceeded: false,
        loadBaselineFlowId: 'abc',
      })
    ).toBe(true);
    expect(
      shouldRebaselineOnIdentityChange({ nextFlowId: null, isEmptyFlow: true, saveJustSucceeded: false, loadBaselineFlowId: null })
    ).toBe(true);
  });
});
