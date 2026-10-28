// Operator 2026-10-11: operator nodes fold into a small round node (sign, pins,
// wires) and unfold on a double click; the choice is saved with the flow.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { foldedShape, isCollapsedOperator, isCollapsibleOperator, operatorInputSources, operatorOutputRows, operatorSymbol, operatorTitle } from './operatorNodes';
import { useFlowStore } from '../hooks/useFlow';
import { getNodeTemplate } from '../types/nodes';
import type { FlowNodeData } from '../types/flow';

describe('collapsible operator nodes', () => {
  it('knows the operators and their signs; other nodes never collapse', () => {
    for (const [type, sign] of [['add', '+'], ['concat', '++'], ['array_append', '+[ ]'], ['make_array', '[ ]'], ['break_object', '{ }→'], ['and', '&&'], ['divide', '÷']] as const) {
      expect(isCollapsibleOperator(type)).toBe(true);
      expect(operatorSymbol({ nodeType: type, pinDefaults: {} } as unknown as FlowNodeData)).toBe(sign);
    }
    expect(isCollapsibleOperator('llm_call')).toBe(false);
    expect(isCollapsedOperator({ nodeType: 'llm_call', collapsed: true } as unknown as FlowNodeData)).toBe(false);
    expect(operatorSymbol({ nodeType: 'compare', pinDefaults: { op: '>=' } } as unknown as FlowNodeData)).toBe('>=');
    // No operator set: the runtime compares with ==, and the folded node says so (QA 2026-10-28).
    expect(operatorSymbol({ nodeType: 'compare', pinDefaults: {} } as unknown as FlowNodeData)).toBe('==');
    expect(operatorSymbol({ nodeType: 'compare' } as unknown as FlowNodeData)).toBe('==');
  });

  it('the folded state is saved with the flow and comes back on load', () => {
    const store = useFlowStore.getState();
    store.clearFlow();
    store.addNode(getNodeTemplate('concat')!, { x: 0, y: 0 });
    const id = useFlowStore.getState().nodes[0].id;
    useFlowStore.getState().updateNodeData(id, { collapsed: true });
    const saved = useFlowStore.getState().getFlow();
    expect(saved.nodes[0].data.collapsed).toBe(true);
    useFlowStore.getState().clearFlow();
    useFlowStore.getState().loadFlow({ ...saved, id: 'f1' });
    expect(isCollapsedOperator(useFlowStore.getState().nodes[0].data)).toBe(true);
  });

  it('the hover card says what the operator is and what feeds each input; the output only by type', () => {
    expect(operatorTitle('concat')).toBe('String concat');
    expect(operatorTitle('array_concat')).toBe('Array concat');
    const pins = (ids: string[]) => ids.map((id) => ({ id, label: id, type: 'string' as const }));
    const nodes = [
      { id: 'v', data: { nodeType: 'get_var', label: 'Get Variable', outputs: pins(['value']), pinDefaults: { name: 'task_title' } } },
      { id: 's', data: { nodeType: 'on_flow_start', label: 'On Flow Start', outputs: pins(['prompt']), pinDefaults: {} } },
    ];
    const edges = [
      { source: 'v', sourceHandle: 'value', target: 'cat', targetHandle: 'b' },
      { source: 's', sourceHandle: 'prompt', target: 'cat', targetHandle: 'c' },
    ];
    const sources = operatorInputSources('cat', { inputs: pins(['a', 'b', 'c', 'd']), pinDefaults: { a: 'Global Context:' } }, nodes as never, edges);
    expect(sources).toEqual([
      { pin: 'a', kind: 'literal', text: '"Global Context:"' },
      { pin: 'b', kind: 'variable', text: 'task_title' },
      { pin: 'c', kind: 'wire', text: 'On Flow Start · prompt' },
      { pin: 'd', kind: 'empty', text: 'empty' },
    ]);
  });

  it('on touch: the fold button folds, a tap unfolds without opening properties, a double-tap never folds', () => {
    const canvas = readFileSync(new URL('../components/Canvas.tsx', import.meta.url), 'utf8');
    // A finger tap on a folded operator unfolds it and returns before selecting (no drawer).
    expect(canvas).toMatch(/e\.pointerType === 'touch' && node && isCollapsedOperator\(node\.data\)[^\n]*\)\s*\{[\s\S]{0,200}updateNodeData\(tapped, \{ collapsed: false \}\);\s*return;/);
    // The double click folds with a mouse or trackpad only, and never on a locked canvas.
    expect(canvas).toContain("if (lastPointerType.current === 'touch' || !reactFlowStore.getState().elementsSelectable) return;");
    const card = readFileSync(new URL('../components/nodes/BaseNode.tsx', import.meta.url), 'utf8');
    expect(card).toMatch(/isCollapsibleOperator\(data\.nodeType\) \?[\s\S]{0,300}className="node-fold-button nodrag"/);
  });

  it('outputs: a generic result by type only; named fields with their path, type and schema detail', () => {
    expect(operatorOutputRows({ outputs: [{ id: 'result', label: 'result', type: 'string' }] })).toEqual([
      { name: '', path: '', type: 'string', detail: '' },
    ]);
    const rows = operatorOutputRows({
      outputs: [
        { id: 'tasks', label: 'tasks', type: 'array', schema: { type: 'array', items: { type: 'object', properties: { id: {}, title: {}, done: {} } } } },
        { id: 'meta.score', label: 'score', type: 'number' },
        { id: 'meta.owner', label: 'owner', type: 'object', schema: { type: 'object', properties: { name: {}, email: {} } } },
      ],
    });
    expect(rows).toEqual([
      { name: 'tasks', path: '', type: 'array', detail: 'of object {id, title, done}' },
      { name: 'score', path: 'meta.score', type: 'number', detail: '' },
      { name: 'owner', path: 'meta.owner', type: 'object', detail: '{name, email}' },
    ]);
    // A single named output (Break Object with one field) keeps its name.
    expect(operatorOutputRows({ outputs: [{ id: 'tasks', label: 'tasks', type: 'array' }] })[0].name).toBe('tasks');
  });

  it('a pin expression is what runs, so the card shows it first (over a wire or a literal)', () => {
    const pins = [{ id: 'a', label: 'a', type: 'number' as const }, { id: 'b', label: 'b', type: 'number' as const }];
    const edges = [{ source: 's', sourceHandle: 'n', target: 'add', targetHandle: 'b' }];
    const nodes = [{ id: 's', data: { nodeType: 'literal_number', label: 'Number', outputs: [{ id: 'n', label: 'n', type: 'number' as const }], pinDefaults: {} } }];
    const sources = operatorInputSources('add', { inputs: pins, pinDefaults: { a: 3 }, pinExpressions: { a: 'vars.n * 2', b: 'value + 1' } }, nodes as never, edges);
    expect(sources.map((s) => [s.kind, s.text])).toEqual([
      ['expression', 'vars.n * 2'],
      ['expression', 'value + 1'],
    ]);
  });

  it('Compare shows its operator only when the node sets it: a wire or an expression on op wins', () => {
    const data = { nodeType: 'compare', pinDefaults: { op: '==' } } as unknown as FlowNodeData;
    expect(operatorSymbol(data)).toBe('==');
    expect(operatorSymbol(data, true)).toBe('=?');
    expect(operatorSymbol({ ...data, pinExpressions: { op: 'vars.op' } } as FlowNodeData)).toBe('=?');
  });

  it('a variable getter folds into a rounded rectangle showing its variable name', () => {
    expect(isCollapsibleOperator('get_var')).toBe(true);
    expect(foldedShape('get_var')).toBe('rounded');
    expect(foldedShape('add')).toBe('circle');
    const getter = { nodeType: 'get_var', pinDefaults: { name: 'history' } } as unknown as FlowNodeData;
    expect(operatorSymbol(getter)).toBe('history');
    expect(operatorSymbol(getter, true)).toBe('(x)'); // the name comes from a wire
    expect(operatorTitle('get_var')).toBe('Read variable');
  });
});
