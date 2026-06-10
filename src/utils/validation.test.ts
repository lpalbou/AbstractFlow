import { describe, expect, it } from 'vitest';
import { areTypesCompatible } from './validation';

describe('pin type compatibility', () => {
  it('treats json_schema as an object-compatible nominal type', () => {
    expect(areTypesCompatible('json_schema', 'json_schema')).toBe(true);
    expect(areTypesCompatible('json_schema', 'object')).toBe(true);
    expect(areTypesCompatible('object', 'json_schema')).toBe(true);
    expect(areTypesCompatible('json_schema', 'string')).toBe(false);
  });
});
