import type { FlowNodeData } from '../types/flow';

/**
 * An Agent's structured response is its `resp_schema` input (operator
 * 2026-10-11): the runtime returns a JSON object matching that schema on the
 * Agent's `data` output whenever it carries one (a value set on the node or a
 * wire). There is no separate on/off setting in the editor.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

/** The top-level fields of a JSON schema (name and type), or null when there is no schema. */
export function schemaTopFields(schema: unknown): Array<{ name: string; type: string }> | null {
  if (!isRecord(schema) || Object.keys(schema).length === 0) return null;
  const properties = isRecord(schema.properties) ? schema.properties : {};
  return Object.entries(properties).map(([name, def]) => {
    const d = isRecord(def) ? def : {};
    const items = isRecord(d.items) ? d.items : null;
    const type = typeof d.type === 'string' ? d.type : 'any';
    return { name, type: type === 'array' && items && typeof items.type === 'string' ? `array of ${items.type}` : type };
  });
}

/**
 * The older per-node setting (`agentConfig.outputSchema`, an on/off switch with
 * its own schema) moved into `resp_schema`: an enabled schema becomes the
 * input's value when the input is empty; the setting is then dropped (the
 * runtime gives the input precedence anyway, and still reads the old setting).
 * Returns the same data when there is nothing to move.
 */
export function withAgentSchemaOnInput(data: FlowNodeData): FlowNodeData {
  const outputSchema = data.agentConfig?.outputSchema;
  if (data.nodeType !== 'agent' || !outputSchema) return data;
  const { outputSchema: _dropped, ...agentConfig } = data.agentConfig || {};
  const pinDefaults = { ...(data.pinDefaults || {}) } as Record<string, unknown>;
  const current = pinDefaults.resp_schema;
  const inputEmpty = !isRecord(current) || Object.keys(current).length === 0;
  if (inputEmpty && outputSchema.enabled && isRecord(outputSchema.jsonSchema)) pinDefaults.resp_schema = outputSchema.jsonSchema;
  return { ...data, agentConfig, pinDefaults: pinDefaults as FlowNodeData['pinDefaults'] };
}
