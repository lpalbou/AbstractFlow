// Typed pin literals (root ADR 0049): a value typed on an unwired input takes the
// input's type, a type variable resolves from the wires, nothing to resolve from is text.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Edge, Node } from 'reactflow';
import { beforeEach, describe, expect, it } from 'vitest';

import type { FlowNodeData, JsonValue, NodeType, VisualFlow } from '../types/flow';
import { createNodeData, getNodeTemplate } from '../types/nodes';
import { useFlowStore } from '../hooks/useFlow';
import { computeRunPreflightIssues } from './preflight';
import {
  convertLiteral,
  parseLiteralText,
  pinLiteralProblem,
  pinLiteralType,
  retypedLiteralsNotice,
  typePinLiterals,
  withTypedPinLiterals,
} from './pinLiterals';

function node(id: string, type: NodeType, patch: Partial<FlowNodeData> = {}): Node<FlowNodeData> {
  const template = getNodeTemplate(type);
  if (!template) throw new Error(`no template for ${type}`);
  return { id, type: 'custom', position: { x: 0, y: 0 }, data: { ...createNodeData(template), ...patch } };
}

function wire(source: string, sourceHandle: string, target: string, targetHandle: string): Edge {
  return { id: `${source}.${sourceHandle}->${target}.${targetHandle}`, source, sourceHandle, target, targetHandle };
}

const defaults = (nodes: Node<FlowNodeData>[], id: string) => nodes.find((n) => n.id === id)!.data.pinDefaults || {};

/** Compare with `a` wired from `source.handle` and `b` holding `b`. */
function compareFed(source: Node<FlowNodeData>, handle: string, b: JsonValue) {
  const cmp = node('cmp', 'compare', { pinDefaults: { b } });
  return { nodes: [source, cmp], edges: [wire(source.id, handle, 'cmp', 'a')] };
}

describe('resolution', () => {
  it('Compare: b takes the type wired to a (5 typed next to a wired number is the number 5)', () => {
    const { nodes, edges } = compareFed(node('five', 'literal_number', { literalValue: 5 }), 'value', '5');
    expect(pinLiteralType('cmp', 'b', nodes, edges)).toEqual({ kind: 'number', from: 'wire' });
    const typed = withTypedPinLiterals(nodes, edges);
    expect(defaults(typed, 'cmp').b).toBe(5);
  });

  it('nothing wired to the type variable: typed text is text ("5" stays "5")', () => {
    const nodes = [node('cmp', 'compare', { pinDefaults: { a: '5', b: '5' } })];
    expect(pinLiteralType('cmp', 'b', nodes, [])).toEqual({ kind: 'string', from: 'default' });
    expect(withTypedPinLiterals(nodes, [])).toBe(nodes);
    expect(pinLiteralProblem('cmp', 'b', nodes, [])).toBeNull();
  });

  it('a value stored with its own JSON type keeps it when nothing resolves the variable', () => {
    // A generator's Get Property default [] (deep-research.json) is a list, not a wrong text.
    const nodes = [node('get', 'get', { pinDefaults: { default: [] } })];
    expect(pinLiteralProblem('get', 'default', nodes, [])).toBeNull();
    expect(withTypedPinLiterals(nodes, [])).toBe(nodes);
  });

  it('an any pin with no type variable takes anything: Make Array keeps "5" as text and 5 as a number', () => {
    const nodes = [node('arr', 'make_array', { pinDefaults: { a: '5' } }), node('arr2', 'make_array', { pinDefaults: { a: 5 } })];
    expect(pinLiteralType('arr', 'a', nodes, [])).toBeNull();
    expect(withTypedPinLiterals(nodes, [])).toBe(nodes);
  });

  it("an output's consumer resolves the variable: Coalesce result into Add makes b a number", () => {
    const co = node('co', 'coalesce', { pinDefaults: { b: '2' } });
    const add = node('add', 'add');
    const nodes = [co, add];
    const edges = [wire('co', 'result', 'add', 'a')];
    expect(pinLiteralType('co', 'b', nodes, edges)).toEqual({ kind: 'number', from: 'wire' });
    expect(defaults(withTypedPinLiterals(nodes, edges), 'co').b).toBe(2);
  });

  it('through generic nodes: a Coalesce fed a number feeds Compare a, so Compare b is a number', () => {
    const five = node('five', 'literal_number', { literalValue: 5 });
    const co = node('co', 'coalesce');
    const cmp = node('cmp', 'compare', { pinDefaults: { b: '5' } });
    const nodes = [five, co, cmp];
    const edges = [wire('five', 'value', 'co', 'a'), wire('co', 'result', 'cmp', 'a')];
    expect(defaults(withTypedPinLiterals(nodes, edges), 'cmp').b).toBe(5);
  });

  it('Get Variable: the default takes the type of the variable the getter reads', () => {
    const getter = node('g', 'get_var', { pinDefaults: { name: 'count', default: '3' } });
    getter.data = { ...getter.data, outputs: getter.data.outputs.map((p) => (p.id === 'value' ? { ...p, type: 'number' } : p)) };
    expect(defaults(withTypedPinLiterals([getter], []), 'g').default).toBe(3);
  });

  it('wires that disagree leave the variable unresolved (text)', () => {
    const five = node('five', 'literal_number', { literalValue: 5 });
    const word = node('word', 'literal_string', { literalValue: 'x' });
    const co = node('co', 'coalesce', { inputs: [...node('c', 'coalesce').data.inputs, { id: 'c', label: 'c', type: 'any' }] });
    const nodes = [five, word, co];
    const edges = [wire('five', 'value', 'co', 'a'), wire('word', 'value', 'co', 'b')];
    // `c` is a saved pin with no template type variable: it takes anything.
    expect(pinLiteralType('co', 'c', nodes, edges)).toBeNull();
    const cmp = node('cmp', 'compare', { pinDefaults: { b: '5' } });
    const all = [...nodes, cmp];
    const allEdges = [...edges, wire('co', 'result', 'cmp', 'a')];
    expect(pinLiteralType('cmp', 'b', all, allEdges)).toEqual({ kind: 'string', from: 'default' });
  });

  it('a cycle of generic nodes resolves to nothing instead of looping', () => {
    const a = node('ca', 'coalesce', { pinDefaults: { b: '1' } });
    const b = node('cb', 'coalesce');
    const nodes = [a, b];
    const edges = [wire('ca', 'result', 'cb', 'a'), wire('cb', 'result', 'ca', 'a')];
    expect(pinLiteralType('ca', 'b', nodes, edges)).toEqual({ kind: 'string', from: 'default' });
  });

  it('a wired input is not typed or flagged (its value comes from the wire)', () => {
    const add = node('add', 'add', { pinDefaults: { a: 'abc' } });
    const five = node('five', 'literal_number', { literalValue: 5 });
    const nodes = [five, add];
    const edges = [wire('five', 'value', 'add', 'a')];
    expect(pinLiteralProblem('add', 'a', nodes, edges)).toBeNull();
    expect(withTypedPinLiterals(nodes, edges)).toBe(nodes);
  });
});

describe('declared pin types', () => {
  it('a number pin holding "abc" is flagged on the node and refused by the run checks', () => {
    const nodes = [node('add', 'add', { pinDefaults: { a: 'abc', b: '2' } })];
    expect(pinLiteralProblem('add', 'a', nodes, [])).toBe('“abc” is not a number');
    const typed = withTypedPinLiterals(nodes, []);
    expect(defaults(typed, 'add')).toEqual({ a: 'abc', b: 2 });
    const issues = computeRunPreflightIssues(typed, []);
    const issue = issues.find((i) => i.nodeId === 'add');
    expect(issue?.message).toBe('a: “abc” is not a number');
    expect(issue?.severity).toBeUndefined(); // blocking
  });

  it('a boolean pin converts "true"/"false" exactly and flags anything else', () => {
    const nodes = [node('and', 'and', { pinDefaults: { a: 'true', b: 'yes' } })];
    const typed = withTypedPinLiterals(nodes, []);
    expect(defaults(typed, 'and').a).toBe(true);
    expect(pinLiteralProblem('and', 'b', typed, [])).toBe('“yes” is not true or false');
  });

  it("Wait Until's duration is the timestamp text when the node waits for a timestamp", () => {
    const at = '2026-11-03T09:00:00Z';
    const timestamp = node('w', 'wait_until', { pinDefaults: { duration: at }, effectConfig: { durationType: 'timestamp' } });
    expect(pinLiteralProblem('w', 'duration', [timestamp], [])).toBeNull();
    const seconds = node('s', 'wait_until', { pinDefaults: { duration: at } });
    expect(pinLiteralProblem('s', 'duration', [seconds], [])).toBe('“2026-11-03T09:00:00Z” is not a number');
  });

  it('object and list pins keep their own editors: a stored value is left as it is', () => {
    const nodes = [node('m', 'merge', { pinDefaults: { a: '{"x":1}' } })];
    expect(pinLiteralType('m', 'a', nodes, [])).toBeNull();
    expect(withTypedPinLiterals(nodes, [])).toBe(nodes);
  });
});

describe('rewiring changes the type', () => {
  beforeEach(() => useFlowStore.getState().clearFlow());

  it('the store converts b when a is wired, rewired to text, and flags what does not convert', () => {
    const five = node('five', 'literal_number', { literalValue: 5 });
    const word = node('word', 'literal_string', { literalValue: 'five' });
    const flag = node('flag', 'literal_boolean', { literalValue: true });
    const cmp = node('cmp', 'compare', { pinDefaults: { b: '5' } });
    useFlowStore.setState({ nodes: [five, word, flag, cmp], edges: [] });
    const b = () => defaults(useFlowStore.getState().nodes, 'cmp').b;
    expect(b()).toBe('5');

    useFlowStore.getState().onConnect({ source: 'five', sourceHandle: 'value', target: 'cmp', targetHandle: 'a' });
    expect(b()).toBe(5);

    // Unwired: nothing says otherwise, the number stays a number.
    const edgeId = useFlowStore.getState().edges[0].id;
    useFlowStore.getState().deleteEdge(edgeId);
    expect(b()).toBe(5);

    useFlowStore.getState().onConnect({ source: 'word', sourceHandle: 'value', target: 'cmp', targetHandle: 'a' });
    expect(b()).toBe('5');

    useFlowStore.getState().deleteEdge(useFlowStore.getState().edges[0].id);
    useFlowStore.getState().onConnect({ source: 'flag', sourceHandle: 'value', target: 'cmp', targetHandle: 'a' });
    const { nodes, edges } = useFlowStore.getState();
    expect(b()).toBe('5');
    expect(pinLiteralProblem('cmp', 'b', nodes, edges)).toBe('“5” is not true or false');
  });
});

describe('conversion', () => {
  it('parses typed text by kind, never by its look', () => {
    expect(parseLiteralText('5', 'number')).toEqual({ ok: true, value: 5 });
    expect(parseLiteralText(' -2.5 ', 'number')).toEqual({ ok: true, value: -2.5 });
    expect(parseLiteralText('.5', 'number')).toEqual({ ok: true, value: 0.5 });
    expect(parseLiteralText('1e3', 'number')).toEqual({ ok: true, value: 1000 });
    expect(parseLiteralText('0x10', 'number').ok).toBe(false);
    expect(parseLiteralText('Infinity', 'number').ok).toBe(false);
    expect(parseLiteralText('1e999', 'number')).toEqual({ ok: false, problem: '“1e999” is too large a number' });
    expect(parseLiteralText('9007199254740991', 'number')).toEqual({ ok: true, value: 9007199254740991 });
    expect(parseLiteralText('9007199254740993', 'number')).toEqual({
      ok: false,
      problem: '“9007199254740993” is too large a number to store exactly',
    });
    expect(parseLiteralText('-12345678901234567890', 'number').ok).toBe(false);
    expect(parseLiteralText('1e21', 'number')).toEqual({ ok: true, value: 1e21 });
    expect(parseLiteralText('', 'number')).toEqual({ ok: true, value: undefined });
    expect(parseLiteralText('TRUE', 'boolean')).toEqual({ ok: true, value: true });
    expect(parseLiteralText('5', 'string')).toEqual({ ok: true, value: '5' });
    expect(parseLiteralText('{"a":1}', 'object')).toEqual({ ok: true, value: { a: 1 } });
    expect(parseLiteralText('[1]', 'object').ok).toBe(false);
    expect(parseLiteralText('[1, 2]', 'array')).toEqual({ ok: true, value: [1, 2] });
    expect(parseLiteralText('{', 'array')).toEqual({ ok: false, problem: '“{” is not valid JSON' });
  });

  it('converts stored values exactly or says why not', () => {
    expect(convertLiteral(5, 'string')).toEqual({ ok: true, value: '5' });
    expect(convertLiteral(true, 'string')).toEqual({ ok: true, value: 'true' });
    expect(convertLiteral(1e21, 'string')).toEqual({ ok: true, value: '1e+21' });
    // A stored text beyond 2^53 is never stored rounded: it stays text and is flagged.
    expect(convertLiteral('9007199254740993', 'number').ok).toBe(false);
    expect(convertLiteral(5, 'boolean')).toEqual({ ok: false, problem: '5 is a number, not true or false' });
    expect(convertLiteral({ a: 1 }, 'string')).toEqual({ ok: false, problem: '{"a":1} is a JSON object, not text' });
    expect(convertLiteral(null, 'number')).toEqual({ ok: true, value: null });
  });
});

describe('flows saved by Flow 0.13.0 (text on an any input)', () => {
  const fixture = (name: string) =>
    JSON.parse(readFileSync(resolve(__dirname, '__fixtures__', name), 'utf8')) as VisualFlow;

  beforeEach(() => useFlowStore.getState().clearFlow());

  it('opening one converts the values to their wired types, says so, and keeps the stored document as the baseline', () => {
    const legacy = fixture('typed_literals_flow.legacy.json');
    const typed = fixture('typed_literals_flow.json');
    const returned = useFlowStore.getState().loadFlow(legacy);

    // The returned document (the saved baseline) is the flow AS STORED: the flow opens with unsaved changes.
    const storedB = (doc: VisualFlow, id: string) => doc.nodes.find((n) => n.id === id)!.data.pinDefaults?.b;
    expect(storedB(returned, 'same')).toBe('5');

    const state = useFlowStore.getState();
    expect(state.literalsRetypedOnLoad).toEqual([
      { nodeId: 'same', pinId: 'b', kind: 'number' },
      { nodeId: 'above', pinId: 'b', kind: 'number' },
    ]);
    expect(retypedLiteralsNotice(state.literalsRetypedOnLoad, state.nodes)).toBe(
      '2 typed values now take the type of their input (Is five b → number; Above nine b → number). Save to keep them.'
    );

    // Saving gives exactly the values of the typed fixture, which the runtime smoke executes
    // (scripts/typed_literals_smoke.py: 5 == 5 and 10 > 9 are true).
    const saved = state.getFlow();
    for (const id of ['same', 'above']) {
      expect(saved.nodes.find((n) => n.id === id)!.data.pinDefaults).toEqual(
        typed.nodes.find((n) => n.id === id)!.data.pinDefaults
      );
    }
  });

  it('opening the typed flow changes nothing', () => {
    useFlowStore.getState().loadFlow(fixture('typed_literals_flow.json'));
    expect(useFlowStore.getState().literalsRetypedOnLoad).toEqual([]);
  });

  it('typePinLiterals reports every conversion it made', () => {
    const { nodes, edges } = compareFed(node('five', 'literal_number', { literalValue: 5 }), 'value', '5');
    expect(typePinLiterals(nodes, edges).retyped).toEqual([{ nodeId: 'cmp', pinId: 'b', kind: 'number' }]);
  });
});
