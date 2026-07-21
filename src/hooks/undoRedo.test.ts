import { beforeEach, describe, expect, it } from 'vitest';
import { useFlowStore } from './useFlow';
import { getNodeTemplate } from '../types/nodes';

// Canvas undo/redo (backlog abstractflow-0127). These tests pin the store
// contract: discrete structural ops each push one entry, rapid same-gesture
// pushes coalesce into one baseline, undo/redo move between stacks without
// aliasing, a new edit forks the timeline (clears redo), load/clear reset
// history, and the stack is bounded.

function reset(): void {
  useFlowStore.getState().clearFlow();
}

function addCodeNode(): string {
  const template = getNodeTemplate('code');
  if (!template) throw new Error('code template missing');
  const before = new Set(useFlowStore.getState().nodes.map((n) => n.id));
  useFlowStore.getState().addNode(template, { x: 0, y: 0 });
  const added = useFlowStore.getState().nodes.find((n) => !before.has(n.id));
  if (!added) throw new Error('addNode did not add a node');
  return added.id;
}

describe('canvas undo/redo', () => {
  beforeEach(reset);

  it('starts with empty history and no-op undo/redo', () => {
    const s = useFlowStore.getState();
    expect(s.past).toEqual([]);
    expect(s.future).toEqual([]);
    s.undo();
    s.redo();
    expect(useFlowStore.getState().nodes).toEqual([]);
  });

  it('undoes and redoes a node add', () => {
    addCodeNode();
    expect(useFlowStore.getState().nodes).toHaveLength(1);
    expect(useFlowStore.getState().past).toHaveLength(1);

    useFlowStore.getState().undo();
    expect(useFlowStore.getState().nodes).toHaveLength(0);
    expect(useFlowStore.getState().future).toHaveLength(1);

    useFlowStore.getState().redo();
    expect(useFlowStore.getState().nodes).toHaveLength(1);
    expect(useFlowStore.getState().future).toHaveLength(0);
  });

  it('undoes a destructive delete (the unrecoverable-edit case)', () => {
    const id = addCodeNode();
    useFlowStore.getState().updateNodeData(id, { label: 'Configured agent with a long prompt' });
    // Two edits: add + config. Delete removes it.
    useFlowStore.getState().deleteNode(id);
    expect(useFlowStore.getState().nodes).toHaveLength(0);

    useFlowStore.getState().undo();
    const restored = useFlowStore.getState().nodes;
    expect(restored).toHaveLength(1);
    expect(restored[0].id).toBe(id);
    expect(restored[0].data.label).toBe('Configured agent with a long prompt');
  });

  it('coalesces rapid config edits on one node into a single undo step', () => {
    const id = addCodeNode();
    const pastAfterAdd = useFlowStore.getState().past.length;
    // Rapid keystrokes on the same node within the coalesce window.
    useFlowStore.getState().updateNodeData(id, { label: 'a' });
    useFlowStore.getState().updateNodeData(id, { label: 'ab' });
    useFlowStore.getState().updateNodeData(id, { label: 'abc' });
    // Only ONE baseline pushed for the whole burst.
    expect(useFlowStore.getState().past.length).toBe(pastAfterAdd + 1);

    // One undo returns to the pre-edit label (empty from the template), not
    // through each keystroke.
    useFlowStore.getState().undo();
    const node = useFlowStore.getState().nodes.find((n) => n.id === id);
    expect(node?.data.label).not.toBe('abc');
  });

  it('does NOT coalesce edits to different nodes', () => {
    const a = addCodeNode();
    const b = addCodeNode();
    const base = useFlowStore.getState().past.length;
    useFlowStore.getState().updateNodeData(a, { label: 'a1' });
    useFlowStore.getState().updateNodeData(b, { label: 'b1' });
    // Different coalesce keys → two discrete baselines.
    expect(useFlowStore.getState().past.length).toBe(base + 2);
  });

  it('coalesces a drag gesture into one baseline', () => {
    const id = addCodeNode();
    const base = useFlowStore.getState().past.length;
    const drag = (x: number, dragging: boolean) =>
      useFlowStore.getState().onNodesChange([
        { id, type: 'position', position: { x, y: 0 }, dragging } as never,
      ]);
    drag(10, true);
    drag(20, true);
    drag(30, true);
    drag(30, false);
    // The whole gesture is one undo step.
    expect(useFlowStore.getState().past.length).toBe(base + 1);
  });

  it('a new edit after undo forks the timeline (clears redo)', () => {
    addCodeNode();
    useFlowStore.getState().undo();
    expect(useFlowStore.getState().future).toHaveLength(1);
    addCodeNode();
    expect(useFlowStore.getState().future).toHaveLength(0);
  });

  it('restore does not alias the history entry (undo→redo→undo is stable)', () => {
    const id = addCodeNode();
    useFlowStore.getState().updateNodeData(id, { label: 'X' });
    useFlowStore.getState().undo(); // back to just-added (label from template)
    const afterFirstUndo = useFlowStore.getState().nodes[0]?.data.label;
    useFlowStore.getState().redo(); // label X again
    expect(useFlowStore.getState().nodes[0]?.data.label).toBe('X');
    useFlowStore.getState().undo(); // back again — must match the first undo exactly
    expect(useFlowStore.getState().nodes[0]?.data.label).toBe(afterFirstUndo);
  });

  it('bounds the undo stack at 50 entries', () => {
    for (let i = 0; i < 60; i++) addCodeNode();
    expect(useFlowStore.getState().past.length).toBeLessThanOrEqual(50);
  });

  it('resets history on loadFlow (no undo into the previous document)', () => {
    addCodeNode();
    expect(useFlowStore.getState().past.length).toBeGreaterThan(0);
    useFlowStore.getState().loadFlow({
      id: 'f2',
      name: 'Other',
      interfaces: [],
      nodes: [],
      edges: [],
    } as never);
    expect(useFlowStore.getState().past).toEqual([]);
    expect(useFlowStore.getState().future).toEqual([]);
  });
});
