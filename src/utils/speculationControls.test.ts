import { describe, expect, it } from 'vitest';
import { parseSpeculationInput } from './speculationControls';
import { getNodeTemplate } from '../types/nodes';

describe('MTP intent', () => {
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
