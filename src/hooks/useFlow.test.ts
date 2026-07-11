import { describe, expect, it } from 'vitest';
import { useFlowStore } from './useFlow';
import { listBundledFlows } from '../utils/bundledFlows';
import type { VisualFlow } from '../types/flow';

function toolbarSignature(flow: Partial<VisualFlow> | null | undefined): string {
  const value = flow || {};
  const normalizeNode = (node: any) => {
    if (!node || typeof node !== 'object') return node;
    return {
      id: node.id,
      type: node.type,
      position: node.position || null,
      data: node.data || null,
      parentNode: node.parentNode,
      parentId: node.parentId,
      extent: node.extent,
    };
  };
  const normalizeEdge = (edge: any) => {
    if (!edge || typeof edge !== 'object') return edge;
    return {
      id: edge.id,
      source: edge.source,
      sourceHandle: edge.sourceHandle,
      target: edge.target,
      targetHandle: edge.targetHandle,
      type: edge.type,
      data: edge.data || null,
      label: edge.label,
    };
  };
  return JSON.stringify({
    name: String(value.name || '').trim(),
    description: String(value.description || ''),
    interfaces: Array.isArray(value.interfaces) ? value.interfaces : [],
    nodes: Array.isArray(value.nodes) ? value.nodes.map(normalizeNode) : [],
    edges: Array.isArray(value.edges) ? value.edges.map(normalizeEdge) : [],
    entryNode: value.entryNode || null,
  });
}

describe('useFlowStore.loadFlow', () => {
  it('returns the canonical loaded flow so bundled workflows are clean after load', () => {
    const bundled = listBundledFlows().find((flow) => flow.id === 'dp-research');
    expect(bundled).toBeTruthy();

    const store = useFlowStore.getState();
    store.clearFlow();

    const loaded = store.loadFlow(bundled as VisualFlow);
    // Bundled workflow families are loaded read-only and run through their bundle target,
    // so Toolbar clears flowId after load. That must not create a dirty signature.
    useFlowStore.getState().setFlowId(null);

    const current = useFlowStore.getState().getFlow();
    expect(toolbarSignature(current)).toEqual(toolbarSignature(loaded));
  });
});
