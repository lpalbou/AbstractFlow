import { describe, expect, it } from 'vitest';
import type { Edge, Node } from 'reactflow';
import type { FlowNodeData } from '../types/flow';
import { codeProseShare, collectDeclaredVarNames, computeRunPreflightIssues, trivialExpressionKind } from './preflight';

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

// Doctrine advisories (2026-07-30, operator ruling): an expression that only
// READS is a Get Variable node the canvas is not drawing. The classifier must
// separate a bare read from a real derivation, and must never fire on the
// latter — a false positive here trains authors to ignore the panel.
describe('trivialExpressionKind', () => {
  it.each([
    'vars.state',
    'vars.state.get("provider")',
    'vars.state.get("all_passed", False)',
    'vars.state.get("wait_gating", True)',
    'vars["state"]',
    'vars.a.b.c',
  ])('flags %s as a bare variable read', (expr) => {
    expect(trivialExpressionKind(expr)).toBe('var-read');
  });

  it.each([
    '(value or {}).get("report", "")',
    '(value or {}).get("verdict", {})',
    'value["field"]',
    'value.get("tools_ran", [])',
  ])('flags %s as a field extract off the wire', (expr) => {
    expect(trivialExpressionKind(expr)).toBe('field-extract');
  });

  it.each([
    // Real derivations — these are what the expression tier is FOR.
    'vars.state.get("approved", False) and vars.state.get("all_passed", False)',
    'not vars.state.get("accepted") and vars.state.get("plan_revisions", 0) < 3',
    '"gating: " + vars.state.get("gating_mode", "wait")',
    '["approve"] if vars.state.get("all_passed") else ["stop"]',
    'build_again(vars.state)',
    'sorted(vars.items, key=lambda r: r["ts"])',
    // A computed default is not a plain read.
    'vars.state.get("x", compute())',
    // Bare `value` is a pass-through, not an extraction; leave it alone.
    'value',
  ])('leaves %s alone', (expr) => {
    expect(trivialExpressionKind(expr)).toBeNull();
  });

  it('reports a bare read as a WARNING, never a Run blocker', () => {
    const nodes = [
      startNode(),
      endNode({
        pinExpressions: { answer: 'vars.count' },
      }),
    ];
    const edges: Edge[] = [
      { id: 'e1', source: 'start', target: 'end', sourceHandle: 'exec-out', targetHandle: 'exec-in' },
    ];
    const issues = computeRunPreflightIssues(nodes, edges);
    const doctrine = issues.filter((i) => i.message.includes('use a Get Variable node'));
    expect(doctrine).toHaveLength(1);
    expect(doctrine[0].severity).toBe('warning');
  });
});

// Visual-primacy advisories (2026-07-30, operator ruling: "whenever you are NOT
// using the pins, you are HIDING something"). The auditor's P6/P7 twins.
function llmNode(): Node<FlowNodeData> {
  return {
    id: 'llm',
    type: 'default',
    position: { x: 300, y: 0 },
    data: {
      nodeType: 'llm_call',
      label: 'Model',
      icon: '',
      headerColor: '',
      inputs: [
        { id: 'exec-in', label: '', type: 'execution' },
        { id: 'prompt', label: 'prompt', type: 'string' },
      ],
      outputs: [{ id: 'exec-out', label: '', type: 'execution' }],
    } as FlowNodeData,
  };
}

function codeNode(body: string): Node<FlowNodeData> {
  return {
    id: 'compose',
    type: 'default',
    position: { x: 150, y: 200 },
    data: {
      nodeType: 'code',
      label: 'Compose prompt',
      icon: '',
      headerColor: '',
      // PURE: no exec pins. This is why the advisory needs its own pass — a
      // pure node is never in the exec-reachable set.
      inputs: [{ id: 'input', label: 'input', type: 'object' }],
      outputs: [{ id: 'output', label: 'output', type: 'any' }],
      codeBody: body,
    } as FlowNodeData,
  };
}

function subflowNode(pins: string[]): Node<FlowNodeData> {
  return {
    id: 'call',
    type: 'default',
    position: { x: 300, y: 0 },
    data: {
      nodeType: 'subflow',
      label: 'Run analysis',
      icon: '',
      headerColor: '',
      subflowId: 'child',
      inputs: [
        { id: 'exec-in', label: '', type: 'execution' },
        ...pins.map((id) => ({ id, label: id, type: 'object' as const })),
      ],
      outputs: [{ id: 'exec-out', label: '', type: 'execution' }],
    } as unknown as FlowNodeData,
  };
}

function builderNode(nodeType: string): Node<FlowNodeData> {
  return {
    id: 'build_input',
    type: 'default',
    position: { x: 150, y: 200 },
    data: {
      nodeType,
      label: 'Build JSON',
      icon: '',
      headerColor: '',
      inputs: [],
      outputs: [{ id: 'result', label: 'result', type: 'object' }],
    } as FlowNodeData,
  };
}

const PROSE_BODY = [
  'parts = []',
  'parts.append("You are an independent reviewer. Judge the answer strictly on the evidence it shows, and name every unsupported claim that you find in it.")',
  'parts.append("Return a short verdict first, then the reasons that decided it, ordered by how much each one mattered to your final judgement.")',
  'return "\\n".join(parts)',
].join('\n');

// The doctrine-compliant shape: every sentence lives on a pin, the body only
// SELECTS between them.
const SELECTION_BODY = [
  'text = str(first_build_text or "")',
  'text = text.replace("{{request}}", str(request or "").strip())',
  'if int(fix_cycles or 0) > 0:',
  '    text = str(repair_text or "").replace("{{failures}}", str(build_feedback or ""))',
  'return {"prompt": text}',
].join('\n');

// Deterministic glue — the legitimate use of a code node.
const SHELL_BODY = [
  'ws = shq(str(workspace_root or "").strip())',
  'cmd = ("cd \'" + ws + "\' && (command -v ruff >/dev/null 2>&1 && ruff check --fix . 2>&1 | tail -5 || true); echo LINT_DONE")',
  'return {"tool_call": {"name": "execute_command", "arguments": {"command": cmd}}}',
].join('\n');

describe('preflight — P7 code-for-orchestration', () => {
  const wire: Edge[] = [
    { id: 'e1', source: 'start', target: 'llm', sourceHandle: 'exec-out', targetHandle: 'exec-in' },
    { id: 'e2', source: 'compose', target: 'llm', sourceHandle: 'output', targetHandle: 'prompt' },
  ];

  it('warns when a PURE code node feeding a prompt pin is mostly prose', () => {
    const issues = computeRunPreflightIssues([startNode(), llmNode(), codeNode(PROSE_BODY)], wire);
    const found = issues.filter((i) => i.message.includes('prose text'));
    expect(found).toHaveLength(1);
    expect(found[0].nodeId).toBe('compose');
    expect(found[0].message).toContain('feeding prompt');
    // Style must never block Run.
    expect(found[0].severity).toBe('warning');
  });

  it('leaves a selection-only body alone (the sentences live on pins)', () => {
    const issues = computeRunPreflightIssues([startNode(), llmNode(), codeNode(SELECTION_BODY)], wire);
    expect(issues.some((i) => i.message.includes('prose text'))).toBe(false);
  });

  it('leaves a shell-command composer alone (deterministic glue is the point)', () => {
    const issues = computeRunPreflightIssues([startNode(), llmNode(), codeNode(SHELL_BODY)], wire);
    expect(issues.some((i) => i.message.includes('prose text'))).toBe(false);
  });

  it('stays quiet on a code node that does not reach the exec spine', () => {
    const orphanEdges: Edge[] = [
      { id: 'e1', source: 'start', target: 'llm', sourceHandle: 'exec-out', targetHandle: 'exec-in' },
    ];
    const issues = computeRunPreflightIssues([startNode(), llmNode(), codeNode(PROSE_BODY)], orphanEdges);
    expect(issues.some((i) => i.message.includes('prose text'))).toBe(false);
  });

  it('measures prose in characters, so one long literal on one line counts', () => {
    expect(codeProseShare(PROSE_BODY)).toBeGreaterThan(0.5);
    expect(codeProseShare(SELECTION_BODY)).toBe(0);
    expect(codeProseShare(SHELL_BODY)).toBe(0);
  });
});

describe('preflight — P6 hidden subflow contract', () => {
  const edges = (): Edge[] => [
    { id: 'e1', source: 'start', target: 'call', sourceHandle: 'exec-out', targetHandle: 'exec-in' },
    { id: 'e2', source: 'build_input', target: 'call', sourceHandle: 'result', targetHandle: 'input' },
  ];

  it('warns when a hand-built object is the subflow node\'s only data input', () => {
    const nodes = [startNode(), subflowNode(['inherit_context', 'input']), builderNode('make_object')];
    const issues = computeRunPreflightIssues(nodes, edges());
    const found = issues.filter((i) => i.message.includes('declare an input pin per child field'));
    expect(found).toHaveLength(1);
    expect(found[0].nodeId).toBe('call');
    expect(found[0].message).toContain('Build JSON');
    expect(found[0].severity).toBe('warning');
  });

  it('is silent once the fields are declared as pins', () => {
    const nodes = [startNode(), subflowNode(['inherit_context', 'topic', 'depth']), builderNode('make_object')];
    const perFieldEdges: Edge[] = [
      { id: 'e1', source: 'start', target: 'call', sourceHandle: 'exec-out', targetHandle: 'exec-in' },
      { id: 'e2', source: 'build_input', target: 'call', sourceHandle: 'result', targetHandle: 'topic' },
    ];
    const issues = computeRunPreflightIssues(nodes, perFieldEdges);
    expect(issues.some((i) => i.message.includes('declare an input pin per child field'))).toBe(false);
  });

  it('abstains when nothing hand-builds the object (the child contract may be one value)', () => {
    const nodes = [startNode(), subflowNode(['inherit_context', 'input']), builderNode('get_var')];
    const issues = computeRunPreflightIssues(nodes, edges());
    expect(issues.some((i) => i.message.includes('declare an input pin per child field'))).toBe(false);
  });
});

describe('declared interface boundary pins', () => {
  it('warns (advisory) for each required pin missing from On Flow Start / On Flow End', () => {
    const end = endNode({
      inputs: [
        { id: 'exec-in', label: '', type: 'execution' },
        { id: 'response', label: 'response', type: 'string' },
      ],
    });
    const issues = computeRunPreflightIssues([startNode(), end], [], { flowInterfaces: ['abstractcode.agent.v1'] });
    const pinIssues = issues.filter((i) => i.message.includes('required by interface abstractcode.agent.v1'));
    expect(pinIssues.map((i) => `${i.nodeId}:${i.message.split("'")[1]}`).sort()).toEqual([
      'end:meta',
      'end:success',
      'start:model',
      'start:prompt',
      'start:provider',
    ]);
    expect(pinIssues.every((i) => i.severity === 'warning')).toBe(true);
    expect(pinIssues.find((i) => i.nodeId === 'end' && i.message.includes("'success'"))?.message).toContain(
      "Missing input pin 'success' (boolean)"
    );
  });

  it('is silent without declared interfaces or when every pin is present', () => {
    expect(
      computeRunPreflightIssues([startNode(), endNode({})], []).some((i) => i.message.includes('required by interface'))
    ).toBe(false);
    const start = startNode();
    start.data.outputs.push({ id: 'items', label: 'items', type: 'array' });
    const end = endNode({
      inputs: [
        { id: 'exec-in', label: '', type: 'execution' },
        { id: 'results', label: 'results', type: 'array' },
        { id: 'synthesis', label: 'synthesis', type: 'string' },
      ],
    });
    const issues = computeRunPreflightIssues([start, end], [], { flowInterfaces: ['abstractbatch.mapreduce.v1'] });
    expect(issues.some((i) => i.message.includes('required by interface'))).toBe(false);
  });
});
