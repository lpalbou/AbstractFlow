// Operator 2026-10-14: the execution view's nodes get a hover card that explains their content in
// a glimpse, and If/Else keeps its drawn branch order there.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReactFlowProvider } from 'reactflow';
import { describe, expect, it } from 'vitest';
import type { Edge, Node } from 'reactflow';
import type { FlowNodeData } from '../types/flow';
import { createNodeData, getNodeTemplate } from '../types/nodes';
import { execGlimpse } from './execGlimpse';
import { ExecViewNode } from '../components/nodes/ExecViewNode';

const node = (id: string, type: string, patch: Partial<FlowNodeData> = {}): Node<FlowNodeData> =>
  ({ id, type: 'custom', position: { x: 0, y: 0 }, data: { ...createNodeData(getNodeTemplate(type as any)!), ...patch } }) as any;

describe('execution view glimpse', () => {
  const start = node('start', 'on_flow_start', { outputs: [{ id: 'exec-out', label: '', type: 'execution' }, { id: 'provider', label: 'provider', type: 'string' }, { id: 'prompt', label: 'prompt', type: 'string' }] });

  it('an LLM call: model, inputs, output with its structured fields and where it goes, and the system prompt', () => {
    const tpl = node('tpl', 'string_template', { label: 'Planner prompt' });
    const planner = node('planner', 'llm_call', {
      label: 'Planner',
      pinDefaults: { model: 'qwen3', system: 'Your role is to identify the tasks.', resp_schema: { type: 'object', properties: { tasks: { type: 'array', items: { type: 'string' } } } } },
    });
    const bo = node('bo', 'break_object', { outputs: [{ id: 'tasks', label: 'tasks', type: 'array' }] });
    const loop = node('loop', 'loop', { label: 'ForEach' });
    const edges: Edge[] = [
      { id: 'e1', source: 'start', sourceHandle: 'provider', target: 'planner', targetHandle: 'provider' },
      { id: 'e2', source: 'tpl', sourceHandle: 'result', target: 'planner', targetHandle: 'prompt' },
      { id: 'e3', source: 'planner', sourceHandle: 'data', target: 'bo', targetHandle: 'object' },
      { id: 'e4', source: 'bo', sourceHandle: 'tasks', target: 'loop', targetHandle: 'items' },
    ];
    const g = execGlimpse(planner, [start, tpl, planner, bo, loop], edges);
    expect(g.title).toBe('Planner');
    expect(g.subtitle).toBe('LLM Call');
    expect(g.sections.map((s) => s.title)).toEqual(['Model', 'Inputs', 'Output']);
    expect(g.sections[0].rows).toEqual([
      { label: 'Provider', value: 'provider (flow input)', kind: 'wire' },
      { label: 'Model', value: 'qwen3', kind: 'text' },
    ]);
    expect(g.sections[1].rows).toEqual([{ label: 'Prompt', value: 'Planner prompt', kind: 'wire' }]);
    expect(g.sections[2].rows).toEqual([
      { label: 'Structured', value: 'tasks: array of string', kind: 'text' },
      { label: 'data · json', value: '→ tasks → ForEach · items', kind: 'wire' },
    ]);
    expect(g.text).toEqual({ label: 'System prompt', value: 'Your role is to identify the tasks.' });
  });

  it('a value that arrives through a relay names what feeds the relay', () => {
    const relay = node('r', 'reroute');
    const call = node('c', 'llm_call');
    const edges: Edge[] = [
      { id: 'e1', source: 'start', sourceHandle: 'provider', target: 'r', targetHandle: 'in' },
      { id: 'e2', source: 'r', sourceHandle: 'out', target: 'c', targetHandle: 'provider' },
    ];
    expect(execGlimpse(call, [start, relay, call], edges).sections[0].rows[0]).toEqual({ label: 'Provider', value: 'provider (flow input)', kind: 'wire' });
  });

  it('an agent adds its tools (from its settings too) and cycle cap; a free-text call says so', () => {
    const agent = node('a', 'agent', { pinDefaults: { max_iterations: 20 }, agentConfig: { tools: ['web_search', 'read_file'] } });
    const g = execGlimpse(agent, [agent], []);
    const inputs = g.sections.find((s) => s.title === 'Inputs')!.rows;
    expect(inputs).toContainEqual({ label: 'Tools', value: '2: web_search, read_file', kind: 'text' });
    expect(inputs).toContainEqual({ label: 'Cycles at most', value: '20', kind: 'text' });
    expect(g.sections.find((s) => s.title === 'Output')!.rows[0]).toEqual({ label: 'Free text', value: 'no structured response', kind: 'text' });
  });

  it('If/Else names the field its condition reads, not the Break Object; Set Variables lists its rows; a wire limit its passes', () => {
    const reviewer = node('rev', 'agent', { label: 'Reviewer' });
    const bo = node('bo', 'break_object', { outputs: [{ id: 'success', label: 'success', type: 'boolean' }] });
    const iff = node('if', 'if');
    const edges: Edge[] = [
      { id: 'e1', source: 'rev', sourceHandle: 'data', target: 'bo', targetHandle: 'object' },
      { id: 'e2', source: 'bo', sourceHandle: 'success', target: 'if', targetHandle: 'condition' },
    ];
    expect(execGlimpse(iff, [reviewer, bo, iff], edges).sections).toEqual([{ title: 'Branches on', rows: [{ label: 'Condition', value: 'Reviewer · data.success', kind: 'wire' }] }]);
    const sv = node('sv', 'set_vars', { inputs: [{ id: 'exec-in', label: '', type: 'execution' }, { id: 'history', label: 'history', type: 'array' }, { id: 'round', label: 'round', type: 'number' }], pinDefaults: { history: [], round: 0 } });
    expect(execGlimpse(sv, [sv], []).sections).toEqual([{ title: 'Sets', rows: [{ label: 'history', value: '[]', kind: 'text' }, { label: 'round', value: '0', kind: 'text' }] }]);
    const limit = node('l', 'loop_limit');
    expect(execGlimpse(limit, [limit], []).sections[0].rows).toEqual([{ label: 'Passes at most', value: '3', kind: 'text' }]);
  });

  it('the execution view draws If/Else with False first when the author swapped the branches', () => {
    const render = (swapped: boolean) =>
      renderToStaticMarkup(
        createElement(ReactFlowProvider, null, createElement(ExecViewNode, { id: 'if', data: { ...createNodeData(getNodeTemplate('if')!), branchesSwapped: swapped } as any, selected: false, type: 'execView', xPos: 0, yPos: 0, zIndex: 0, isConnectable: true, dragging: false }))
      );
    const order = (html: string) => [...html.matchAll(/exec-view-branch-label">([a-z]+)</g)].map((m) => m[1]);
    expect(order(render(false))).toEqual(['true', 'false']);
    expect(order(render(true))).toEqual(['false', 'true']);
  });
});

describe('the repeating wire badge and the Loop Limit node share the glimpse card', () => {
  it('a limited wire says where it repeats, how often, and where the flow goes on at the limit', async () => {
    const { wireLoopGlimpse } = await import('./execGlimpse');
    const loop = node('loop', 'loop', { label: 'ForEach' });
    const iff = node('if', 'if');
    const report = node('report', 'llm_call', { label: 'Report Executor' });
    const edges: Edge[] = [
      { id: 'e6', source: 'if', sourceHandle: 'true', target: 'report', targetHandle: 'exec-in' },
      { id: 'e7', source: 'if', sourceHandle: 'false', target: 'loop', targetHandle: 'exec-in', data: { loopLimit: { max: 3 } } },
    ];
    const g = wireLoopGlimpse(edges[1], [loop, iff, report], edges, 'limited', 3);
    expect(g.title).toBe('Repeats 3×');
    expect(g.sections).toEqual([
      { title: 'Repeats', rows: [{ label: 'From', value: 'If/Else · false', kind: 'wire' }, { label: 'Back to', value: 'ForEach', kind: 'wire' }] },
      { title: 'Limit', rows: [{ label: 'At most', value: '3 times', kind: 'text' }, { label: 'Then', value: 'goes on to Report Executor (the true branch)', kind: 'wire' }] },
    ]);
    expect(wireLoopGlimpse(edges[1], [loop, iff, report], edges, 'limitable', null).sections[1].rows[0].value).toMatch(/no limit yet/);
  });

  it('a Loop Limit node says where again and limit reached lead', () => {
    const limit = node('l', 'loop_limit');
    const reviewer = node('rev', 'agent', { label: 'Reviewer' });
    const report = node('report', 'llm_call', { label: 'Report Executor' });
    const edges: Edge[] = [
      { id: 'a', source: 'l', sourceHandle: 'again', target: 'rev', targetHandle: 'exec-in' },
      { id: 'b', source: 'l', sourceHandle: 'limit_reached', target: 'report', targetHandle: 'exec-in' },
    ];
    expect(execGlimpse(limit, [limit, reviewer, report], edges).sections).toEqual([
      { title: 'Limit', rows: [{ label: 'Passes at most', value: '3', kind: 'text' }] },
      { title: 'Then', rows: [{ label: 'Again', value: 'Reviewer', kind: 'wire' }, { label: 'Limit reached', value: 'Report Executor', kind: 'wire' }] },
    ]);
  });
});
