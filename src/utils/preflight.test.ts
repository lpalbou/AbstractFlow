import { describe, expect, it } from 'vitest';
import type { Edge, Node } from 'reactflow';
import type { FlowNodeData } from '../types/flow';
import { collectDeclaredVarNames, computeRunPreflightIssues } from './preflight';

// Inline pin expressions (tier 1, cycle 2) — preflight readiness checks.
// The load-bearing new behavior: an expression on a pin id that no longer
// exists (dynamic-pin rename/delete) is caught BEFORE any run.

function startNode(): Node<FlowNodeData> {
  return {
    id: 'start',
    type: 'default',
    position: { x: 0, y: 0 },
    data: {
      nodeType: 'on_flow_start',
      label: 'Start',
      icon: '',
      headerColor: '',
      inputs: [],
      outputs: [{ id: 'exec-out', label: '', type: 'execution' }],
    } as FlowNodeData,
  };
}

function endNode(data: Partial<FlowNodeData>): Node<FlowNodeData> {
  return {
    id: 'end',
    type: 'default',
    position: { x: 300, y: 0 },
    data: {
      nodeType: 'on_flow_end',
      label: 'End',
      icon: '',
      headerColor: '',
      inputs: [
        { id: 'exec-in', label: '', type: 'execution' },
        { id: 'answer', label: 'answer', type: 'number' },
      ],
      outputs: [],
      ...data,
    } as FlowNodeData,
  };
}

const execEdge: Edge = {
  id: 'e1',
  source: 'start',
  target: 'end',
  sourceHandle: 'exec-out',
  targetHandle: 'exec-in',
};

describe('preflight — pin expressions', () => {
  it('warns when an expression targets a pin that does not exist (stale rename/delete)', () => {
    const nodes = [startNode(), endNode({ pinExpressions: { ghost: 'vars.count' } })];
    const issues = computeRunPreflightIssues(nodes, [execEdge]);
    expect(issues.some((i) => i.message.includes("unknown pin 'ghost'"))).toBe(true);
  });

  it('does not warn when the expression targets a real input pin', () => {
    const nodes = [startNode(), endNode({ pinExpressions: { answer: 'vars.count * 2' } })];
    const issues = computeRunPreflightIssues(nodes, [execEdge]);
    expect(issues.some((i) => i.message.includes('unknown pin'))).toBe(false);
  });

  it('flags an empty expression string as an authoring mistake', () => {
    const nodes = [startNode(), endNode({ pinExpressions: { answer: '   ' } })];
    const issues = computeRunPreflightIssues(nodes, [execEdge]);
    expect(issues.some((i) => i.message.includes("Expression on 'answer' is empty"))).toBe(true);
  });

  it('catches a vars.<name> typo before any run when the graph declares vars', () => {
    // THE acceptance mechanism: set_var declares `fix_cycles`, the expression
    // reads the typo `vars.fix_cycle` — preflight must warn BEFORE a run.
    const setVar: Node<FlowNodeData> = {
      id: 'sv',
      type: 'default',
      position: { x: 150, y: 0 },
      data: {
        nodeType: 'set_var',
        label: 'set fix_cycles',
        icon: '',
        headerColor: '',
        inputs: [],
        outputs: [],
        pinDefaults: { name: 'fix_cycles' },
      } as FlowNodeData,
    };
    const nodes = [startNode(), setVar, endNode({ pinExpressions: { answer: 'vars.fix_cycle < 3' } })];
    const issues = computeRunPreflightIssues(nodes, [execEdge]);
    expect(issues.some((i) => i.message.includes("reads vars.fix_cycle "))).toBe(true);
    // The correctly spelled read stays silent.
    const okNodes = [startNode(), setVar, endNode({ pinExpressions: { answer: 'vars.fix_cycles < 3' } })];
    const okIssues = computeRunPreflightIssues(okNodes, [execEdge]);
    expect(okIssues.some((i) => i.message.includes('reads vars.'))).toBe(false);
  });

  it('abstains from the unknown-var warning when the graph declares no vars', () => {
    // Conservative-detector rule: vars can be born at run time (input_data,
    // subflow outputs) — with nothing collected, an unknown name is not
    // evidence of a typo and must not warn.
    const nodes = [startNode(), endNode({ pinExpressions: { answer: 'vars.anything < 3' } })];
    const issues = computeRunPreflightIssues(nodes, [execEdge]);
    expect(issues.some((i) => i.message.includes('reads vars.'))).toBe(false);
  });

  it('P0-2: does NOT flag Python keywords before "(" as unknown calls', () => {
    // `in (...)`, `and (...)`, `not (...)`, `else (...)` are everyday boolean/
    // grouping syntax — treating them as calls hard-blocked the Run button
    // (the 2026-06-10 unsatisfiable-preflight incident class). None may warn.
    const exprs = [
      'vars.mode in ("a", "b")',
      'vars.a and (vars.b or vars.c)',
      'vars.x if vars.y else (vars.z)',
      'not (vars.done)',
    ];
    for (const expr of exprs) {
      const nodes = [startNode(), endNode({ pinExpressions: { answer: expr } })];
      const issues = computeRunPreflightIssues(nodes, [execEdge], {
        flowFunctions: [{ name: 'noop', code: 'def noop():\n    return 1\n' }],
      });
      expect(
        issues.some((i) => i.message.includes('not a flow function or sandbox builtin')),
        `keyword false-positive on: ${expr}`
      ).toBe(false);
    }
  });

  it('still flags a genuinely unknown call when a library is present', () => {
    const nodes = [startNode(), endNode({ pinExpressions: { answer: 'no_such_fn(vars.x)' } })];
    const issues = computeRunPreflightIssues(nodes, [execEdge], {
      flowFunctions: [{ name: 'noop', code: 'def noop():\n    return 1\n' }],
    });
    expect(issues.some((i) => i.message.includes('calls no_such_fn'))).toBe(true);
  });

  it('does not flag a real flow-function call or a sandbox builtin', () => {
    const nodes = [
      startNode(),
      endNode({ pinExpressions: { answer: 'build_again(vars.state) or len(vars.items) > 0' } }),
    ];
    const issues = computeRunPreflightIssues(nodes, [execEdge], {
      flowFunctions: [{ name: 'build_again', code: 'def build_again(state):\n    return True\n' }],
    });
    expect(issues.some((i) => i.message.includes('not a flow function or sandbox builtin'))).toBe(false);
  });
});

describe('preflight — collectDeclaredVarNames', () => {
  it('collects set_var names and flow-start output pin ids (the editor + runtime share one definition)', () => {
    const nodes: Node<FlowNodeData>[] = [
      {
        id: 'start',
        type: 'default',
        position: { x: 0, y: 0 },
        data: {
          nodeType: 'on_flow_start',
          label: 'Start',
          icon: '',
          headerColor: '',
          inputs: [],
          outputs: [
            { id: 'exec-out', label: '', type: 'execution' },
            { id: 'topic', label: 'topic', type: 'string' },
          ],
        } as FlowNodeData,
      },
      {
        id: 'sv',
        type: 'default',
        position: { x: 100, y: 0 },
        data: {
          nodeType: 'set_var',
          label: 'set i',
          icon: '',
          headerColor: '',
          inputs: [],
          outputs: [],
          pinDefaults: { name: 'i' },
        } as FlowNodeData,
      },
    ];
    const names = collectDeclaredVarNames(nodes);
    expect(names.has('topic')).toBe(true);
    expect(names.has('i')).toBe(true);
    expect(names.has('exec-out')).toBe(false); // execution pins are not vars
  });
});
