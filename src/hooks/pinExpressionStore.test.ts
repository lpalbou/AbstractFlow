import { beforeEach, describe, expect, it } from 'vitest';
import { useFlowStore } from './useFlow';
import { getNodeTemplate } from '../types/nodes';
import { exportFlowToJson, toVisualFlow } from '../utils/serialization';
import { hasSecretLikeValue } from '../utils/flowAuthoringCommands';

// Inline pin expressions (tier 1, 2026-07-25) — store + wire contract.
//
// Two clauses the UI depends on but nothing pinned (cycle-1 review):
//
// 1. REMOVAL: BaseNode removes the last expression via
//    `updateNodeData(id, { pinExpressions: undefined })`. The store merges
//    with object spread (`{ ...node.data, ...data }`), where an explicit
//    `undefined` OVERRIDES the previous map (spread copies own keys
//    regardless of value) and JSON serialization then DROPS the key. If the
//    store ever switches to a merge that skips undefined values (deepmerge,
//    key-filtered assign), stale expressions would silently linger in saved
//    flows — this test turns that regression loud.
//
// 2. WIRE SPELLING: the persisted field name `pinExpressions` is read
//    literally by the runtime compiler (abstractruntime pin_expressions.py
//    reads data["pinExpressions"]; its tests pin that half). A rename on the
//    editor side would degrade skew-safe but SILENT — every expression
//    ignored, pins falling back to defaults. Each repo pins its half of the
//    shared JSON spelling; this is the editor half.

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

function exportedNodeData(nodeId: string): Record<string, unknown> {
  const s = useFlowStore.getState();
  const json = exportFlowToJson(toVisualFlow('f', 'f', s.nodes, s.edges));
  const parsed = JSON.parse(json) as { nodes: Array<{ id: string; data: Record<string, unknown> }> };
  const node = parsed.nodes.find((n) => n.id === nodeId);
  if (!node) throw new Error('node missing from export');
  return node.data;
}

describe('pin expression store + wire contract', () => {
  beforeEach(reset);

  it('persists an expression under the literal pinExpressions key', () => {
    const id = addCodeNode();
    useFlowStore.getState().updateNodeData(id, { pinExpressions: { n: 'vars.count * 2' } });
    const data = exportedNodeData(id);
    // The literal spelling IS the runtime contract — assert the key name,
    // not just reachability of the value.
    expect(Object.keys(data)).toContain('pinExpressions');
    expect(data.pinExpressions).toEqual({ n: 'vars.count * 2' });
  });

  it('updateNodeData with pinExpressions: undefined removes the key from persisted JSON', () => {
    const id = addCodeNode();
    useFlowStore.getState().updateNodeData(id, { pinExpressions: { n: 'vars.count * 2' } });
    // The BaseNode removal path: last expression deleted -> whole field undefined.
    useFlowStore.getState().updateNodeData(id, { pinExpressions: undefined });

    const live = useFlowStore.getState().nodes.find((n) => n.id === id);
    expect(live?.data.pinExpressions).toBeUndefined();

    const data = exportedNodeData(id);
    expect(Object.keys(data)).not.toContain('pinExpressions');
  });

  it('removing one of two expressions keeps the other', () => {
    const id = addCodeNode();
    useFlowStore.getState().updateNodeData(id, { pinExpressions: { a: 'vars.x', b: 'vars.y' } });
    // BaseNode setPinExpression(pin, undefined) with one entry left rewrites
    // the map minus the removed pin.
    useFlowStore.getState().updateNodeData(id, { pinExpressions: { b: 'vars.y' } });
    const data = exportedNodeData(id);
    expect(data.pinExpressions).toEqual({ b: 'vars.y' });
  });

  // Secret-gate PARITY (cycle 2): BaseNode.setPinExpression and the assistant
  // lane's set_pin_expression both call the SAME exported hasSecretLikeValue.
  // Pinning the shared predicate keeps the two save paths from drifting — a
  // popover Save that refused nothing while the assistant refused secrets was
  // the asymmetry cycle 2 closed.
  it('the shared secret predicate flags credential-shaped expressions and pins', () => {
    expect(hasSecretLikeValue('answer', '"sk-abcdefghijklmnopqrstuvwxyz"')).toBe(true);
    expect(hasSecretLikeValue('answer', 'Bearer abcdefghijklmnopqrstuvwxyz')).toBe(true);
    expect(hasSecretLikeValue('api_key', 'vars.token')).toBe(true); // key-name pattern
    // A normal expression referencing a variable is allowed through.
    expect(hasSecretLikeValue('answer', 'vars.count * 2')).toBe(false);
  });
});
