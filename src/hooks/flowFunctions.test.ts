import { describe, it, expect, beforeEach } from 'vitest';
import type { Node } from 'reactflow';
import { useFlowStore, renameFunctionCallSites, findFunctionCallSites } from './useFlow';
import type { FlowNodeData } from '../types/flow';

/**
 * Store-level tier-2 behaviors the adversary review found broken or unpinned:
 * P1-6 rename-orphaning, P1-14 promote-is-one-undo, and the load/save + undo
 * round-trip for flowFunctions. Pure store logic — no React.
 */

function mkNode(id: string, exprs?: Record<string, string>): Node<FlowNodeData> {
  return {
    id,
    type: 'custom',
    position: { x: 0, y: 0 },
    data: {
      nodeType: 'while',
      label: id,
      icon: '',
      headerColor: '',
      inputs: [{ id: 'condition', label: 'condition', type: 'boolean' }],
      outputs: [],
      ...(exprs ? { pinExpressions: exprs } : {}),
    } as FlowNodeData,
  };
}

beforeEach(() => {
  useFlowStore.getState().clearFlow();
});

describe('renameFunctionCallSites (P1-6)', () => {
  it('rewrites only the calling name, not partial matches or attributes', () => {
    const nodes = [
      mkNode('a', { condition: 'build_again(vars.s)' }),
      mkNode('b', { condition: 'build_again_more(vars.s) or x.build_again(1)' }),
      mkNode('c', { condition: 'other(vars.s)' }),
    ];
    const out = renameFunctionCallSites(nodes, 'build_again', 'should_loop');
    expect(out[0].data.pinExpressions!.condition).toBe('should_loop(vars.s)');
    // `build_again_more` and the method `.build_again(` are untouched.
    expect(out[1].data.pinExpressions!.condition).toBe('build_again_more(vars.s) or x.build_again(1)');
    expect(out[2].data.pinExpressions!.condition).toBe('other(vars.s)');
  });
});

describe('upsertFlowFunction rename (P1-6)', () => {
  it('renaming a called function rewrites its call sites (no orphan)', () => {
    const store = useFlowStore.getState();
    store.setNodes([mkNode('n1', { condition: 'build_again(vars.state)' })]);
    expect(store.upsertFlowFunction({ name: 'build_again', code: 'def build_again(state):\n    return True\n' })).toBeNull();
    // rename
    const err = useFlowStore
      .getState()
      .upsertFlowFunction(
        { name: 'should_loop', code: 'def should_loop(state):\n    return True\n' },
        { previousName: 'build_again' }
      );
    expect(err).toBeNull();
    const s = useFlowStore.getState();
    expect(s.flowFunctions.map((f) => f.name)).toEqual(['should_loop']);
    // The call site was rewritten — no orphan.
    expect(findFunctionCallSites(s.nodes, 'build_again')).toHaveLength(0);
    expect(findFunctionCallSites(s.nodes, 'should_loop')).toHaveLength(1);
  });
});

describe('function-to-function call sites (shq defect)', () => {
  // multiagent-coding's `shq` is called by 7 sibling functions and by no pin
  // expression. Scanning pins only reported "used 0" + a "1 unused" badge,
  // let Delete orphan all 7, and let rename orphan them silently.
  const shq = { name: 'shq', code: 'def shq(v):\n    return "\'" + str(v) + "\'"\n' };
  const caller = {
    name: 'compose_lint',
    code: 'def compose_lint(state):\n    return {"cmd": "cd " + shq(state.get("root"))}\n',
  };

  it('counts a sibling function body as a call site', () => {
    const sites = findFunctionCallSites([], 'shq', [shq, caller]);
    expect(sites).toHaveLength(1);
    expect(sites[0].kind).toBe('function');
    expect(sites[0].nodeLabel).toBe('compose_lint');
    // Its own def line is never a self-use.
    expect(findFunctionCallSites([], 'shq', [shq])).toHaveLength(0);
  });

  it('refuses to delete a function only other functions call', () => {
    const store = useFlowStore.getState();
    store.upsertFlowFunction(shq);
    store.upsertFlowFunction(caller);
    const err = useFlowStore.getState().removeFlowFunction('shq');
    expect(err).toMatch(/still used by/);
    expect(useFlowStore.getState().flowFunctions).toHaveLength(2);
  });

  it('renaming rewrites sibling function bodies too', () => {
    const store = useFlowStore.getState();
    store.upsertFlowFunction(shq);
    store.upsertFlowFunction(caller);
    const err = useFlowStore
      .getState()
      .upsertFlowFunction(
        { name: 'shell_quote', code: 'def shell_quote(v):\n    return "\'" + str(v) + "\'"\n' },
        { previousName: 'shq' }
      );
    expect(err).toBeNull();
    const fns = useFlowStore.getState().flowFunctions;
    const composed = fns.find((f) => f.name === 'compose_lint')!;
    expect(composed.code).toContain('shell_quote(state.get("root"))');
    expect(composed.code).not.toContain('shq(');
    expect(findFunctionCallSites([], 'shell_quote', fns)).toHaveLength(1);
  });
});

describe('removeFlowFunction refusal (verified-good, kept pinned)', () => {
  it('refuses while a pin expression still calls it', () => {
    const store = useFlowStore.getState();
    store.setNodes([mkNode('n1', { condition: 'build_again(vars.state)' })]);
    store.upsertFlowFunction({ name: 'build_again', code: 'def build_again(state):\n    return True\n' });
    const err = useFlowStore.getState().removeFlowFunction('build_again');
    expect(err).toMatch(/still used by/);
    expect(useFlowStore.getState().flowFunctions).toHaveLength(1);
  });
});

describe('promoteExpressionToFunction is ONE undo step (P1-14)', () => {
  it('creates the function AND rebinds the pin, undone as a single entry', () => {
    const store = useFlowStore.getState();
    store.setNodes([mkNode('n1', { condition: 'vars.state["phase"] == "fixing"' })]);
    const before = useFlowStore.getState().past.length;
    const err = useFlowStore
      .getState()
      .promoteExpressionToFunction(
        { name: 'is_fixing', code: 'def is_fixing(state):\n    return (\n        state["phase"] == "fixing"\n    )\n' },
        'n1',
        'condition',
        'is_fixing(vars.state)'
      );
    expect(err).toBeNull();
    let s = useFlowStore.getState();
    expect(s.flowFunctions.map((f) => f.name)).toEqual(['is_fixing']);
    expect(s.nodes[0].data.pinExpressions!.condition).toBe('is_fixing(vars.state)');
    // Exactly one history entry was pushed for the whole gesture.
    expect(s.past.length).toBe(before + 1);
    // One undo reverts BOTH the function and the pin rebind.
    useFlowStore.getState().undo();
    s = useFlowStore.getState();
    expect(s.flowFunctions).toHaveLength(0);
    expect(s.nodes[0].data.pinExpressions!.condition).toBe('vars.state["phase"] == "fixing"');
  });
});

describe('load/save/undo round-trip for flowFunctions', () => {
  it('getFlow emits functions; loadFlow restores them; undo covers edits', () => {
    const store = useFlowStore.getState();
    store.upsertFlowFunction({ name: 'f', code: 'def f(x):\n    return x\n', kind: 'shaper' });
    const flow = useFlowStore.getState().getFlow();
    expect(flow.functions?.map((fn) => fn.name)).toEqual(['f']);
    // Round-trip through loadFlow.
    useFlowStore.getState().clearFlow();
    expect(useFlowStore.getState().flowFunctions).toHaveLength(0);
    useFlowStore.getState().loadFlow(flow);
    expect(useFlowStore.getState().flowFunctions.map((fn) => fn.name)).toEqual(['f']);
    // Edit then undo restores the previous code.
    useFlowStore.getState().upsertFlowFunction({ name: 'f', code: 'def f(x):\n    return x + 1\n' }, { previousName: 'f' });
    expect(useFlowStore.getState().flowFunctions[0].code).toContain('x + 1');
    useFlowStore.getState().undo();
    expect(useFlowStore.getState().flowFunctions[0].code).not.toContain('x + 1');
  });
});
