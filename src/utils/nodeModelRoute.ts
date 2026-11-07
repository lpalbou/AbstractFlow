// Agent / LLM call text route as the kit ProviderModelPicker value (operator rule 2026-11-07).
// The picker owns the rules: reasoning and MTP follow the selected model and go back to the gateway
// default on every provider/model change; MTP depths only when the model's capability card says so.
// This file only maps the picker value to the node's config (agentConfig / effectConfig).
import { normalizeSpeculationValue, type ProviderModelPickerValue } from '@abstractframework/ui-kit';
import type { FlowNodeData } from '../types/flow';

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const configKey = (data: FlowNodeData) => (data.nodeType === 'agent' ? 'agentConfig' : 'effectConfig');

export function nodeRouteValue(data: FlowNodeData): ProviderModelPickerValue {
  const cfg = ((data as any)[configKey(data)] || {}) as Record<string, unknown>;
  const speculation = normalizeSpeculationValue((data.pinDefaults as any)?.speculation ?? cfg.speculation);
  return {
    provider: str(cfg.provider),
    model: str(cfg.model),
    reasoning: str(cfg.thinking),
    ...(speculation !== undefined ? { speculation } : {}),
  };
}

/** The node patch for a picker change: provider/model/thinking/speculation in the node config; the
 * speculation pin default is dropped (the config holds the choice, as before). */
export function nodeRoutePatch(data: FlowNodeData, next: ProviderModelPickerValue): Partial<FlowNodeData> {
  const key = configKey(data);
  const pinDefaults = { ...(data.pinDefaults || {}) } as Record<string, unknown>;
  delete pinDefaults.speculation;
  return {
    pinDefaults: pinDefaults as FlowNodeData['pinDefaults'],
    [key]: {
      ...((data as any)[key] || {}),
      provider: str(next.provider) || undefined,
      model: str(next.model) || undefined,
      thinking: str(next.reasoning) || undefined,
      speculation: normalizeSpeculationValue(next.speculation),
    },
  } as Partial<FlowNodeData>;
}

/** Pin defaults after a text provider/model default change (On Flow Start / End): the reasoning
 * (`thinking`) and MTP (`speculation`) defaults go back to the gateway default. */
export function withoutRouteOptionDefaults(defaults: Record<string, unknown>): Record<string, unknown> {
  const next = { ...defaults };
  delete next.thinking;
  delete next.speculation;
  return next;
}
