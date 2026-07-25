import { describe, it, expect } from 'vitest';
import { computeRequiredTools, PURPOSE_BUILT_NODE_VERBS } from './flowRequiredTools';
import type { VisualFlow, VisualNode } from '../types/flow';

function node(id: string, nodeType: string, extra: Record<string, unknown> = {}): VisualNode {
  return {
    id,
    type: nodeType,
    position: { x: 0, y: 0 },
    data: { nodeType, label: id, icon: '', headerColor: '', inputs: [], outputs: [], ...extra },
  } as unknown as VisualNode;
}

function flow(id: string, nodes: VisualNode[]): VisualFlow {
  return { id, name: id, nodes, edges: [] } as unknown as VisualFlow;
}

describe('computeRequiredTools', () => {
  it('collects an agent allowlist from agentConfig.tools', () => {
    const f = flow('root', [node('a', 'agent', { agentConfig: { tools: ['web_search', 'fetch_url'] } })]);
    const r = computeRequiredTools('root', new Map([['root', f]]));
    expect(r.tools).toEqual(['fetch_url', 'web_search']);
    expect(r.staticallyClosed).toBe(true);
  });

  it('collects a tool_calls allowlist from effectConfig.allowed_tools', () => {
    const f = flow('root', [node('t', 'tool_calls', { effectConfig: { allowed_tools: ['write_file'] } })]);
    const r = computeRequiredTools('root', new Map([['root', f]]));
    expect(r.tools).toEqual(['write_file']);
    expect(r.staticallyClosed).toBe(true);
  });

  it('collects an agent allowlist from pinDefaults.tools (co-scientist shape)', () => {
    const f = flow('root', [node('a', 'agent', { pinDefaults: { tools: ['web_search', 'skim_url'] } })]);
    const r = computeRequiredTools('root', new Map([['root', f]]));
    expect(r.tools).toEqual(['skim_url', 'web_search']);
  });

  it('maps deterministic camera nodes to their baked verbs (analyze_media, not the node type)', () => {
    const f = flow('root', [
      node('open', 'camera_open'),
      node('shot', 'camera_capture_photo'),
      node('look', 'camera_analyze_media'),
      node('close', 'camera_close'),
    ]);
    const r = computeRequiredTools('root', new Map([['root', f]]));
    expect(r.tools).toEqual(['analyze_media', 'camera_capture_photo', 'camera_close', 'camera_open']);
    expect(r.staticallyClosed).toBe(true);
  });

  it('flattens subflow references into the required set', () => {
    const child = flow('child', [node('t', 'tool_calls', { effectConfig: { allowed_tools: ['read_file'] } })]);
    const root = flow('root', [
      node('a', 'agent', { agentConfig: { tools: ['web_search'] } }),
      node('s', 'subflow', { subflowId: 'child' }),
    ]);
    const r = computeRequiredTools('root', new Map([['root', root], ['child', child]]));
    expect(r.tools).toEqual(['read_file', 'web_search']);
    expect(r.staticallyClosed).toBe(true);
  });

  it('marks not-closed when a subflow reference is unresolved (superset honesty)', () => {
    const root = flow('root', [node('s', 'subflow', { subflowId: 'missing' })]);
    const r = computeRequiredTools('root', new Map([['root', root]]));
    expect(r.staticallyClosed).toBe(false);
    expect(r.openReasons.join(' ')).toMatch(/missing/);
  });

  it('marks not-closed when an agent has no explicit allowlist (may use any granted tool)', () => {
    const root = flow('root', [node('a', 'agent', {})]);
    const r = computeRequiredTools('root', new Map([['root', root]]));
    expect(r.staticallyClosed).toBe(false);
    expect(r.openReasons.join(' ')).toMatch(/no explicit tool allowlist/);
  });

  it('handles subflow cycles without infinite recursion', () => {
    const a = flow('a', [node('sa', 'subflow', { subflowId: 'b' }), node('t', 'tool_calls', { effectConfig: { allowed_tools: ['list_files'] } })]);
    const b = flow('b', [node('sb', 'subflow', { subflowId: 'a' })]);
    const r = computeRequiredTools('a', new Map([['a', a], ['b', b]]));
    expect(r.tools).toEqual(['list_files']);
    expect(r.staticallyClosed).toBe(true);
  });

  it('de-duplicates a tool required by multiple nodes', () => {
    const f = flow('root', [
      node('a1', 'agent', { agentConfig: { tools: ['web_search'] } }),
      node('a2', 'agent', { agentConfig: { tools: ['web_search', 'fetch_url'] } }),
    ]);
    const r = computeRequiredTools('root', new Map([['root', f]]));
    expect(r.tools).toEqual(['fetch_url', 'web_search']);
  });

  it('camera verb map covers exactly the five deterministic node types', () => {
    expect(Object.keys(PURPOSE_BUILT_NODE_VERBS).sort()).toEqual([
      'camera_analyze_media',
      'camera_capture_photo',
      'camera_capture_video',
      'camera_close',
      'camera_open',
    ]);
  });
});
