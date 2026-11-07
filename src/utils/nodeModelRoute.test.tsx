// Operator rule 2026-11-07: Agent and LLM call nodes choose provider, model, reasoning and MTP with
// the kit ProviderModelPicker (no own copy, no model-name rule); changing the model or provider puts
// reasoning and MTP back on the gateway default; MTP depths only for a model the gateway says supports it.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import type { Node } from 'reactflow';
import { createNodeData, getNodeTemplate } from '../types/nodes';
import type { FlowNodeData, NodeType } from '../types/flow';
import { PropertiesPanel } from '../components/PropertiesPanel';
import { nodeRoutePatch, nodeRouteValue, withoutRouteOptionDefaults } from './nodeModelRoute';

const DEPTH2 = { mode: 'native_mtp' as const, num_draft_tokens: 2, require_acceleration: true as const };

function nodeOf(type: NodeType, patch: Partial<FlowNodeData> = {}): Node<FlowNodeData> {
  const template = getNodeTemplate(type);
  if (!template) throw new Error(`no template for ${type}`);
  return { id: `n-${type}`, type: 'custom', position: { x: 0, y: 0 }, data: { ...createNodeData(template), ...patch } };
}

describe('Agent / LLM call model route', () => {
  it('reads the node config as the kit picker value', () => {
    const agent = nodeOf('agent', { agentConfig: { provider: 'lmstudio', model: 'm', thinking: 'high', speculation: DEPTH2 } as any }).data;
    expect(nodeRouteValue(agent)).toEqual({ provider: 'lmstudio', model: 'm', reasoning: 'high', speculation: DEPTH2 });
    const llm = nodeOf('llm_call', { effectConfig: { provider: 'p', model: 'q', thinking: 'low' } as any, pinDefaults: { speculation: false } as any }).data;
    expect(nodeRouteValue(llm)).toEqual({ provider: 'p', model: 'q', reasoning: 'low', speculation: false });
  });

  it('a model change from the picker clears reasoning and MTP on the node (config and pin default)', () => {
    const data = nodeOf('agent', { agentConfig: { provider: 'lmstudio', model: 'm', thinking: 'high', speculation: DEPTH2, temperature: 0.2 } as any, pinDefaults: { speculation: DEPTH2 } as any }).data;
    // What the kit picker emits on a model change (resetModelOptions).
    const patch = nodeRoutePatch(data, { provider: 'airelays', model: 'gpt-5.6-terra', reasoning: '', speculation: undefined });
    expect(patch.agentConfig).toMatchObject({ provider: 'airelays', model: 'gpt-5.6-terra', temperature: 0.2 });
    expect((patch.agentConfig as any).thinking).toBeUndefined();
    expect((patch.agentConfig as any).speculation).toBeUndefined();
    expect((patch.pinDefaults as any).speculation).toBeUndefined();
    const llm = nodeOf('llm_call', { effectConfig: { provider: 'p', model: 'q', thinking: 'low', speculation: DEPTH2 } as any }).data;
    const llmPatch = nodeRoutePatch(llm, { provider: '', model: '', reasoning: '', speculation: undefined });
    expect(llmPatch.effectConfig).toMatchObject({ provider: undefined, model: undefined, thinking: undefined, speculation: undefined });
  });

  it('renders the kit picker (compact) in Agent and LLM call nodes, not the own provider/model/reasoning selects', () => {
    for (const type of ['agent', 'llm_call'] as const) {
      const client = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } });
      const html = renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(PropertiesPanel, { node: nodeOf(type) })));
      expect(html, type).toContain('af-pmp af-pmp--compact');
      expect(html, type).not.toContain('Auto (Gateway default)</option>');
    }
  });

  it('a text provider/model pin default change clears the reasoning and MTP defaults', () => {
    expect(withoutRouteOptionDefaults({ provider: 'p', model: 'm', thinking: 'high', speculation: DEPTH2, prompt: 'x' })).toEqual({ provider: 'p', model: 'm', prompt: 'x' });
  });
});
