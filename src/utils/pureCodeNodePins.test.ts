import { describe, expect, it } from 'vitest';
import type { VisualFlow } from '../types/flow';
import { fromVisualFlow, toVisualFlow } from './serialization';

// Operator incident 2026-07-20 (laurent DM seq 29): generator-built flows
// (co-scientist, deep-research, meta-*) author PURE code nodes — no
// execution pins — so the runtime compiler classifies them as lazily
// evaluated data nodes. The editor's template merge appended the code
// template's exec-in/exec-out to every such node, which (a) rendered dead
// exec triangles ("a lot of nodes with empty execution pins, which I
// believe are therefore never reached") and (b) persisted on the next
// save, flipping the runtime classification to exec-node-unreachable so
// the node silently never ran and downstream inputs resolved to nothing.
// These tests pin the fix: execution pins are never invented for pure code
// nodes, while exec-authored code nodes keep theirs and every node still
// gets template doc/permissions backfill.

function pureCodeFlow(): VisualFlow {
  return {
    id: 'flow-pure',
    name: 'pure-code',
    nodes: [
      {
        id: 'start',
        type: 'on_flow_start',
        position: { x: 0, y: 0 },
        data: {
          nodeType: 'on_flow_start',
          label: 'On Flow Start',
          inputs: [],
          outputs: [
            { id: 'exec-out', label: '', type: 'execution' },
            { id: 'goal', label: 'goal', type: 'string' },
          ],
        },
      },
      {
        id: 'lit_base',
        type: 'code',
        position: { x: 200, y: 0 },
        data: {
          nodeType: 'code',
          label: 'Build literature base',
          functionName: 'transform',
          codeBody: 'return {"ok": True}',
          inputs: [
            { id: 'investigation', label: 'investigation', type: 'object' },
            { id: 'permissions', label: 'permissions', type: 'string' },
          ],
          outputs: [
            { id: 'output', label: 'output', type: 'object' },
            { id: 'success', label: 'success', type: 'boolean' },
            { id: 'execution', label: 'execution', type: 'object' },
          ],
          pinDefaults: { permissions: 'sandbox' },
        },
      },
    ],
    edges: [
      {
        id: 'e-data',
        source: 'start',
        sourceHandle: 'goal',
        target: 'lit_base',
        targetHandle: 'investigation',
      },
    ],
  } as unknown as VisualFlow;
}

function execCodeFlow(): VisualFlow {
  const flow = pureCodeFlow();
  const code = flow.nodes.find((n) => n.id === 'lit_base')!;
  code.data = {
    ...code.data,
    inputs: [{ id: 'exec-in', label: '', type: 'execution' }, ...(code.data.inputs || [])],
    outputs: [{ id: 'exec-out', label: '', type: 'execution' }, ...(code.data.outputs || [])],
  };
  flow.edges = [
    ...flow.edges,
    {
      id: 'e-exec',
      source: 'start',
      sourceHandle: 'exec-out',
      target: 'lit_base',
      targetHandle: 'exec-in',
    },
  ];
  return flow;
}

function pinIds(pins: Array<{ id: string; type: string }> | undefined, type?: string): string[] {
  return (pins || []).filter((p) => (type ? p.type === type : true)).map((p) => p.id);
}

describe('pure code node pin preservation', () => {
  it('does not invent execution pins for a pure code node on load', () => {
    const { nodes } = fromVisualFlow(pureCodeFlow());
    const code = nodes.find((n) => n.id === 'lit_base')!;
    expect(pinIds(code.data.inputs, 'execution')).toEqual([]);
    expect(pinIds(code.data.outputs, 'execution')).toEqual([]);
  });

  it('round-trips a pure code node without gaining execution pins (save-path corruption guard)', () => {
    const loaded = fromVisualFlow(pureCodeFlow());
    const saved = toVisualFlow('flow-pure', 'pure-code', loaded.nodes, loaded.edges);
    const code = saved.nodes.find((n) => n.id === 'lit_base')!;
    const data = code.data as { inputs?: Array<{ id: string; type: string }>; outputs?: Array<{ id: string; type: string }> };
    expect(pinIds(data.inputs, 'execution')).toEqual([]);
    expect(pinIds(data.outputs, 'execution')).toEqual([]);
    // The authored data pins survive intact.
    expect(pinIds(data.inputs)).toContain('investigation');
    expect(pinIds(data.outputs)).toContain('output');
  });

  it('keeps execution pins on an exec-authored code node', () => {
    const { nodes } = fromVisualFlow(execCodeFlow());
    const code = nodes.find((n) => n.id === 'lit_base')!;
    expect(pinIds(code.data.inputs, 'execution')).toEqual(['exec-in']);
    expect(pinIds(code.data.outputs, 'execution')).toEqual(['exec-out']);
  });

  it('still backfills the sandbox permissions default for pure code nodes', () => {
    const flow = pureCodeFlow();
    const code = flow.nodes.find((n) => n.id === 'lit_base')!;
    delete (code.data as { pinDefaults?: unknown }).pinDefaults;
    const { nodes } = fromVisualFlow(flow);
    const loaded = nodes.find((n) => n.id === 'lit_base')!;
    expect(loaded.data.pinDefaults?.permissions).toBe('sandbox');
  });
});
