import { describe, expect, it } from 'vitest';
import { areTypesCompatible } from './validation';

describe('pin type compatibility', () => {
  it('treats json_schema as an object-compatible nominal type', () => {
    expect(areTypesCompatible('json_schema', 'json_schema')).toBe(true);
    expect(areTypesCompatible('json_schema', 'object')).toBe(true);
    expect(areTypesCompatible('object', 'json_schema')).toBe(true);
    expect(areTypesCompatible('json_schema', 'string')).toBe(false);
  });

  it('lets the dynamic any type feed nominal provider/model pins (loop.item -> llm_call.model)', () => {
    expect(areTypesCompatible('any', 'model')).toBe(true);
    expect(areTypesCompatible('any', 'model_text')).toBe(true);
    expect(areTypesCompatible('any', 'provider')).toBe(true);
    expect(areTypesCompatible('model', 'any')).toBe(true);
  });

  it('keeps nominal guards for non-any payload types', () => {
    expect(areTypesCompatible('string', 'model')).toBe(false);
    expect(areTypesCompatible('model', 'string')).toBe(false);
    expect(areTypesCompatible('execution', 'any')).toBe(false);
    expect(areTypesCompatible('any', 'execution')).toBe(false);
  });
});
