import { describe, expect, it } from 'vitest';
import {
  addJsonSchemaFields,
  jsonSchemaFromFields,
  schemaFieldsFromJsonSchema,
  validateStructuredOutputSchema,
  type SchemaField,
} from './jsonSchemaEditor';

describe('json schema editor helpers', () => {
  it('round-trips top-level enum fields without dropping choices', () => {
    const schema = {
      type: 'object',
      properties: {
        choice: {
          type: 'string',
          enum: ['approve', 'reject', 'escalate'],
          description: 'Routing decision',
        },
      },
      required: ['choice'],
    };

    const fields = schemaFieldsFromJsonSchema(schema);

    expect(fields).toHaveLength(1);
    expect(fields[0].type).toBe('enum');
    expect(fields[0].enumValues).toEqual(['approve', 'reject', 'escalate']);

    expect(jsonSchemaFromFields(fields)).toEqual(schema);
  });

  it('emits standard JSON Schema for authored choice fields', () => {
    const fields: SchemaField[] = [
      {
        id: 'field-1',
        name: 'choice',
        type: 'enum',
        required: true,
        enumValues: ['sales', 'support'],
      },
    ];

    expect(jsonSchemaFromFields(fields)).toEqual({
      type: 'object',
      properties: {
        choice: {
          type: 'string',
          enum: ['sales', 'support'],
        },
      },
      required: ['choice'],
    });
  });

  it('rejects empty object schemas produced by removing every field', () => {
    const schema = jsonSchemaFromFields([]);

    expect(schema).toEqual({ type: 'object', properties: {} });
    expect(validateStructuredOutputSchema(schema)).toContain('must not be empty');
  });

  it('preserves existing schema metadata when adding fields from the builder', () => {
    const schema = {
      type: 'object',
      title: 'Evaluation',
      additionalProperties: false,
      properties: {
        verdict: {
          type: 'object',
          description: 'Detailed decision',
          properties: {
            passed: { type: 'boolean' },
            notes: { type: 'string' },
          },
          required: ['passed'],
        },
      },
      required: ['verdict'],
      $defs: {
        score: { type: 'number' },
      },
    };

    const fields: SchemaField[] = [
      ...schemaFieldsFromJsonSchema(schema),
      { id: 'field-2', name: 'score', type: 'number', required: false },
    ];

    expect(jsonSchemaFromFields(fields, schema)).toEqual({
      ...schema,
      properties: {
        ...schema.properties,
        score: { type: 'number' },
      },
      required: ['verdict'],
    });
  });

  it('adds schema fields without modifying existing base fields', () => {
    expect(
      addJsonSchemaFields(
        {
          type: 'object',
          properties: { score: { type: 'number' }, verdict: { type: 'string' } },
          required: ['score'],
          additionalProperties: false,
        },
        {
          type: 'object',
          properties: {
            verdict: { type: 'string', enum: ['pass', 'fail'] },
            notes: { type: 'string' },
          },
          required: ['verdict', 'notes'],
        }
      )
    ).toEqual({
      type: 'object',
      properties: {
        score: { type: 'number' },
        verdict: { type: 'string' },
        notes: { type: 'string' },
      },
      required: ['score', 'notes'],
      additionalProperties: false,
    });
  });
});
