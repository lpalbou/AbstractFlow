import { describe, expect, it } from 'vitest';
import type { Pin } from '../types/flow';
import { hasJsonSchemaPinDefault, isJsonSchemaInputPin } from './jsonSchemaPins';

function pin(overrides: Partial<Pin>): Pin {
  return {
    id: 'context',
    label: 'context',
    type: 'object',
    ...overrides,
  };
}

describe('json schema pin detection', () => {
  it('detects response schema pins without marking generic object pins', () => {
    expect(
      isJsonSchemaInputPin(
        pin({
          id: 'resp_schema',
          label: 'resp_schema',
          description: 'Optional JSON Schema object the response must conform to.',
        })
      )
    ).toBe(true);

    expect(
      isJsonSchemaInputPin(
        pin({
          id: 'context',
          label: 'context',
          description: 'Optional context object for the model.',
        })
      )
    ).toBe(false);
  });

  it('accepts explicit json schema pins and rejects unrelated non-object pins', () => {
    expect(
      isJsonSchemaInputPin(
        pin({
          id: 'criteria',
          label: 'criteria',
          type: 'json_schema',
          description: 'Schema for judge criteria.',
        })
      )
    ).toBe(true);

    expect(
      isJsonSchemaInputPin(
        pin({
          id: 'resp_schema',
          label: 'resp_schema',
          type: 'string',
          description: 'Optional JSON Schema object.',
        })
      )
    ).toBe(false);
  });

  it('detects future schema-like pins by id plus JSON Schema docs', () => {
    expect(
      isJsonSchemaInputPin(
        pin({
          id: 'input_schema',
          label: 'input_schema',
          description: 'JSON Schema for input validation.',
        })
      )
    ).toBe(true);
  });

  it('recognizes non-empty object defaults as configured schemas', () => {
    expect(hasJsonSchemaPinDefault({ type: 'object', properties: { answer: { type: 'string' } } })).toBe(true);
    expect(hasJsonSchemaPinDefault({})).toBe(false);
    expect(hasJsonSchemaPinDefault(null)).toBe(false);
  });

  it('does not treat object-value schema metadata as a schema editor pin', () => {
    expect(
      isJsonSchemaInputPin(
        pin({
          id: 'evaluations',
          label: 'evaluations',
          schema: { type: 'object', properties: { score: { type: 'number' } } },
        })
      )
    ).toBe(false);
  });
});
