import { describe, expect, it } from 'vitest';
import type { FlowNodeData, VisualFlow } from '../types/flow';
import { createNodeData, getNodeTemplate } from '../types/nodes';
import { AGENT_MAX_ITERATIONS_DEFAULT } from './agentIterationDefaults';
import { hasNonDefaultConfiguredPinValue } from './nodePinDisclosure';
import { fromVisualFlow } from './serialization';

// The agent max_iterations DEFAULT - applied only when the workflow author has
// not chosen - is 50 (operator 2026-11-08: "by default, set it to 50
// everywhere"; it was 20 under the 2026-07-11 ruling). Workflow-declared values
// stay authoritative at any number ("if the workflow put 3, it's 3"), and a
// saved 20 stays 20: the editor never rewrites a value the author set. This
// incident class is silent drift, so the number is pinned here as a literal.
const RULED_AGENT_MAX_ITERATIONS_DEFAULT = 50;

function agentVisualFlow(overrides: {
  pinDefaults?: Record<string, unknown>;
  edges?: VisualFlow['edges'];
}): VisualFlow {
  return {
    id: 'flow-1',
    name: 'test',
    nodes: [
      {
        id: 'agent-1',
        type: 'agent',
        position: { x: 0, y: 0 },
        data: {
          nodeType: 'agent',
          label: 'Agent',
          inputs: [
            { id: 'exec-in', label: '', type: 'execution' },
            { id: 'max_iterations', label: 'max_iterations', type: 'number' },
          ],
          outputs: [{ id: 'exec-out', label: '', type: 'execution' }],
          ...(overrides.pinDefaults ? { pinDefaults: overrides.pinDefaults } : {}),
        },
      },
      {
        id: 'start-1',
        type: 'on_flow_start',
        position: { x: -100, y: 0 },
        data: {
          nodeType: 'on_flow_start',
          label: 'Start',
          inputs: [],
          outputs: [
            { id: 'exec-out', label: '', type: 'execution' },
            { id: 'max_iterations', label: 'max_iterations', type: 'number' },
          ],
        },
      },
    ],
    edges: overrides.edges ?? [],
  } as VisualFlow;
}

describe('agent max_iterations defaults (operator 2026-11-08: 50)', () => {
  it('the editor default is one named constant, 50', () => {
    expect(AGENT_MAX_ITERATIONS_DEFAULT).toBe(RULED_AGENT_MAX_ITERATIONS_DEFAULT);
  });

  it('seeds new agent nodes with 50', () => {
    const template = getNodeTemplate('agent');
    expect(template).toBeTruthy();
    const data = createNodeData(template!);
    expect(data.pinDefaults?.max_iterations).toBe(RULED_AGENT_MAX_ITERATIONS_DEFAULT);
  });

  it('backfills legacy pin-less, unwired agent nodes with 50 on load', () => {
    const { nodes } = fromVisualFlow(agentVisualFlow({}));
    const agent = nodes.find((n) => n.id === 'agent-1');
    expect(agent?.data.pinDefaults?.max_iterations).toBe(RULED_AGENT_MAX_ITERATIONS_DEFAULT);
  });

  it('preserves an explicit workflow-declared value (the workflow decides): 7 stays 7', () => {
    const { nodes } = fromVisualFlow(agentVisualFlow({ pinDefaults: { max_iterations: 7 } }));
    const agent = nodes.find((n) => n.id === 'agent-1');
    expect(agent?.data.pinDefaults?.max_iterations).toBe(7);
  });

  it('never rewrites a saved 20 (the old seed) to the new default', () => {
    const { nodes } = fromVisualFlow(agentVisualFlow({ pinDefaults: { max_iterations: 20 } }));
    const agent = nodes.find((n) => n.id === 'agent-1');
    expect(agent?.data.pinDefaults?.max_iterations).toBe(20);
  });

  it('pin disclosure: 50 is the default, a saved 20 is an authored value', () => {
    const agentData = (maxIterations: number) =>
      ({ nodeType: 'agent', label: 'Agent', icon: '', headerColor: '', inputs: [], outputs: [], pinDefaults: { max_iterations: maxIterations } }) as FlowNodeData;
    expect(hasNonDefaultConfiguredPinValue(agentData(RULED_AGENT_MAX_ITERATIONS_DEFAULT), 'max_iterations')).toBe(false);
    expect(hasNonDefaultConfiguredPinValue(agentData(20), 'max_iterations')).toBe(true);
  });

  it('does not backfill when the pin is edge-connected (the graph decides)', () => {
    // The basic-agent source shape: an EXPLICIT empty pinDefaults (which
    // overrides the template seed on load) plus an edge feeding the pin.
    // Backfilling here would change saved bytes for zero runtime behavior
    // (connected pins win) and desync the packed bundle from source.
    const { nodes } = fromVisualFlow(
      agentVisualFlow({
        pinDefaults: {},
        edges: [
          {
            id: 'e1',
            source: 'start-1',
            sourceHandle: 'max_iterations',
            target: 'agent-1',
            targetHandle: 'max_iterations',
          },
        ],
      })
    );
    const agent = nodes.find((n) => n.id === 'agent-1');
    const defaults = agent?.data.pinDefaults ?? {};
    expect(Object.prototype.hasOwnProperty.call(defaults, 'max_iterations')).toBe(false);
  });
});
