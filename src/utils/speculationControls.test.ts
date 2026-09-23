import { describe, expect, it } from 'vitest';
import { parseSpeculationInput, withRunSpeculation } from './speculationControls';
import { getNodeTemplate } from '../types/nodes';

describe('MTP intent', () => {
  it('preserves explicit off and does not mutate run or node inputs', () => {
    const input = { _runtime: { thinking: 'high' }, speculation: { mode: 'native_mtp', num_draft_tokens: 4 } };
    const result = withRunSpeculation(input, false);
    expect(result._runtime).toEqual({ thinking: 'high', speculation: false });
    expect(result.speculation).toEqual(input.speculation);
    expect(input._runtime).toEqual({ thinking: 'high' });
    expect(withRunSpeculation(input)).toBe(input);
  });
  it('serializes pin JSON using the same canonical request', () => {
    expect(parseSpeculationInput('false')).toBe(false);
    expect(parseSpeculationInput('')).toBeUndefined();
    expect(parseSpeculationInput('{"mode":"native_mtp","num_draft_tokens":3}')).toEqual({mode:'native_mtp',num_draft_tokens:3,require_acceleration:true});
  });
  it('exposes the same pin on Agent and LLM call nodes', () => {
    for (const name of ['agent', 'llm_call'] as const) {
      expect(getNodeTemplate(name)?.inputs.some(pin => pin.id === 'speculation' && pin.type === 'any')).toBe(true);
    }
  });
});
