import { describe, expect, it } from 'vitest';
import type { VisualFlow } from '../types/flow';
import { createNodeData, getNodeTemplate } from '../types/nodes';
import { fromVisualFlow } from './serialization';

// Maintainer ruling 2026-07-11 (agora commons c726): the agent
// max_iterations DEFAULT — applied only when the workflow author has not
// chosen — is 20. Workflow-declared values are authoritative at any number
// ("if the workflow put 3, it's 3"). This incident class is silent drift
// (the January 5 landed in an unrelated commit), so the ruled values are
// pinned here.
const RULED_AGENT_MAX_ITERATIONS_DEFAULT = 20;

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

describe('agent max_iterations ruled defaults (2026-07-11)', () => {
  it('seeds new agent nodes with the ruled default of 20', () => {
    const template = getNodeTemplate('agent');
    expect(template).toBeTruthy();
    const data = createNodeData(template!);
    expect(data.pinDefaults?.max_iterations).toBe(RULED_AGENT_MAX_ITERATIONS_DEFAULT);
  });

  it('backfills legacy pin-less agent nodes with 20 on load', () => {
    const { nodes } = fromVisualFlow(agentVisualFlow({}));
    const agent = nodes.find((n) => n.id === 'agent-1');
    expect(agent?.data.pinDefaults?.max_iterations).toBe(RULED_AGENT_MAX_ITERATIONS_DEFAULT);
  });

  it('preserves an explicit workflow-declared value (the workflow decides)', () => {
    const { nodes } = fromVisualFlow(agentVisualFlow({ pinDefaults: { max_iterations: 3 } }));
    const agent = nodes.find((n) => n.id === 'agent-1');
    expect(agent?.data.pinDefaults?.max_iterations).toBe(3);
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
