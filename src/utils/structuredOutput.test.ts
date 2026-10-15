// Operator 2026-10-11: an Agent's structured response is defined by its
// resp_schema input alone; no separate switch.
import { describe, expect, it } from 'vitest';
import type { FlowNodeData } from '../types/flow';
import { schemaTopFields, withAgentSchemaOnInput } from './structuredOutput';

const reviewer = { type: 'object', properties: { success: { type: 'boolean' }, tasks: { type: 'array', items: { type: 'string' } } }, required: ['success', 'tasks'] };

describe('structured response', () => {
  it('lists the fields a schema promises; no schema, no fields', () => {
    expect(schemaTopFields(reviewer)).toEqual([
      { name: 'success', type: 'boolean' },
      { name: 'tasks', type: 'array of string' },
    ]);
    expect(schemaTopFields(undefined)).toBeNull();
    expect(schemaTopFields({})).toBeNull();
  });

  it('moves an older per-node schema into resp_schema, and never over an existing one', () => {
    const old = { nodeType: 'agent', agentConfig: { tools: ['read_file'], outputSchema: { enabled: true, mode: 'json', jsonSchema: reviewer } }, pinDefaults: {} } as unknown as FlowNodeData;
    const moved = withAgentSchemaOnInput(old);
    expect(moved.pinDefaults?.resp_schema).toEqual(reviewer);
    expect(moved.agentConfig).toEqual({ tools: ['read_file'] });
    const both = { ...old, pinDefaults: { resp_schema: { type: 'object', properties: { x: { type: 'string' } } } } } as unknown as FlowNodeData;
    expect(withAgentSchemaOnInput(both).pinDefaults?.resp_schema).toEqual({ type: 'object', properties: { x: { type: 'string' } } });
    const off = { ...old, agentConfig: { outputSchema: { enabled: false, jsonSchema: reviewer } } } as unknown as FlowNodeData;
    expect(withAgentSchemaOnInput(off).pinDefaults?.resp_schema).toBeUndefined();
    const plain = { nodeType: 'agent', agentConfig: { tools: [] }, pinDefaults: {} } as unknown as FlowNodeData;
    expect(withAgentSchemaOnInput(plain)).toBe(plain);
  });
});
