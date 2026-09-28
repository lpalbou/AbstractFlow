import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Edge, Node } from 'reactflow';
import type { FlowNodeData, VisualFlow } from '../types/flow';
import { listBundledFlows } from './bundledFlows';
import { interfaceBoundaryPins } from './flowFamilies';
import { computeRunPreflightIssues } from './preflight';

// The type-mismatch preflight warning must not fire on any shipped flow:
// legacy spellings (provider for provider_text, model_text for model) are
// accepted. Covers every example flow on disk (a superset of the bundled
// library catalog, which the library preview also renders) plus the bundled
// catalog itself as loaded by the app.
const FLOWS_DIR = resolve(__dirname, '../../examples/flows');

function exampleFlows(): VisualFlow[] {
  return readdirSync(FLOWS_DIR)
    .filter((name) => name.endsWith('.json'))
    .map((name) => JSON.parse(readFileSync(resolve(FLOWS_DIR, name), 'utf8')) as VisualFlow)
    .filter((flow) => Array.isArray(flow?.nodes));
}

describe('interface pin types across shipped flows', () => {
  it('no shipped flow declaring an interface gets a type-mismatch warning', () => {
    const byId = new Map<string, VisualFlow>();
    for (const flow of [...exampleFlows(), ...listBundledFlows()]) byId.set(flow.id, flow);
    const declaring = [...byId.values()].filter((flow) => {
      const pins = interfaceBoundaryPins(flow.interfaces);
      return pins.start.length + pins.end.length > 0;
    });
    // Guard against a vacuous pass (59 example flows declare a pinned interface).
    expect(declaring.length).toBeGreaterThan(50);
    const mismatches = declaring.flatMap((flow) =>
      computeRunPreflightIssues(flow.nodes as unknown as Node<FlowNodeData>[], flow.edges as Edge[], {
        flowInterfaces: flow.interfaces,
      })
        .filter((issue) => issue.message.includes('the interface expects'))
        .map((issue) => `${flow.id}:${issue.nodeId} ${issue.message}`)
    );
    expect(mismatches).toEqual([]);
    console.info(`interface pin types checked on ${declaring.length} flows`);
  });
});

describe('entity-chat provider/model typed for agent.v1', () => {
  it('its start pins carry the contract types and their edges survive an editor load', async () => {
    const { useFlowStore } = await import('../hooks/useFlow');
    const flow = listBundledFlows().find((f) => f.id === 'entity-chat');
    expect(flow).toBeTruthy();
    const start = flow!.nodes.find((n) => n.data?.nodeType === 'on_flow_start');
    const typeOf = (id: string) => start?.data?.outputs.find((p) => p.id === id)?.type;
    expect([typeOf('provider'), typeOf('model')]).toEqual(['provider_text', 'model']);
    useFlowStore.getState().clearFlow();
    const loaded = useFlowStore.getState().loadFlow(flow!);
    // loadFlow drops type-invalid edges: the retyped pins' edges must survive.
    const kept = loaded.edges
      .filter((e) => e.source === 'start' && (e.sourceHandle === 'provider' || e.sourceHandle === 'model'))
      .map((e) => `${e.sourceHandle}->${e.target}.${e.targetHandle}`)
      .sort();
    expect(kept).toEqual(['model->chat_report.model', 'model->visit_in.model', 'provider->chat_report.provider', 'provider->visit_in.provider']);
  });
});
