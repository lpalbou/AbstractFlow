/**
 * An automation's inputs as a form (operator 2026-10-25: "The default
 * input_data JSON: I do not know what you are asking"). The fields come from
 * the flow's On Flow Start outputs: `prompt` is "What each run is asked to
 * do"; string, number and boolean pins get matching fields; object/list pins
 * a small JSON field of their own; the `event` pin is never asked (the
 * trigger fills it). Anything else in `input_data` lives in "Advanced: raw
 * JSON". Pure: tested as a round trip.
 */
import type { JsonValue, VisualFlow } from '../types/flow';
import { humanizeKey } from './triggerBindings';
import { TRIGGER_EVENT_PIN_ID } from './triggerEvent';

export type InputFieldKind = 'prompt' | 'text' | 'number' | 'boolean' | 'json';

export interface InputField {
  id: string;
  label: string;
  help?: string;
  kind: InputFieldKind;
}

const TEXT_TYPES = new Set([
  'string',
  'provider',
  'model',
  'provider_text',
  'model_text',
  'provider_image',
  'model_image',
  'provider_video',
  'model_video',
  'workspace_file',
  'workspace_folder',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** The fields of a flow's On Flow Start (execution and the trigger's event excluded). */
export function inputFields(flow: Pick<VisualFlow, 'nodes'>): InputField[] {
  const start = flow.nodes.find((n) => n.type === 'on_flow_start' || n.data?.nodeType === 'on_flow_start');
  const pins = (start?.data?.outputs || []) as Array<{ id: string; label?: string; type?: string; description?: string }>;
  return pins
    .filter((pin) => pin.type !== 'execution' && pin.id !== TRIGGER_EVENT_PIN_ID)
    .map((pin) => {
      if (pin.id === 'prompt') {
        return { id: pin.id, label: 'What each run is asked to do', help: 'The trigger’s details are added automatically.', kind: 'prompt' as const };
      }
      const kind: InputFieldKind = TEXT_TYPES.has(pin.type || 'string') ? 'text' : pin.type === 'number' ? 'number' : pin.type === 'boolean' ? 'boolean' : 'json';
      const label = pin.label && pin.label !== pin.id ? pin.label : humanizeKey(pin.id);
      return { id: pin.id, label, ...(pin.description ? { help: pin.description } : {}), kind };
    });
}

export type InputValues = Record<string, string>;

/** Saved input_data → the form's values and the raw JSON of everything else. */
export function inputFormFromData(fields: InputField[], data: Record<string, JsonValue>): { values: InputValues; raw: string } {
  const values: InputValues = {};
  const rest: Record<string, JsonValue> = {};
  const byId = new Map(fields.map((f) => [f.id, f]));
  for (const [key, value] of Object.entries(data || {})) {
    const field = byId.get(key);
    if (!field) {
      rest[key] = value;
      continue;
    }
    if (field.kind === 'json') values[key] = JSON.stringify(value, null, 2);
    else if (field.kind === 'boolean') values[key] = value === true ? 'true' : value === false ? 'false' : JSON.stringify(value);
    else if (typeof value === 'string' || typeof value === 'number') values[key] = String(value);
    else {
      // A value the field cannot show (an object in a text pin) stays as is, in the raw JSON.
      rest[key] = value;
    }
  }
  return { values, raw: Object.keys(rest).length ? JSON.stringify(rest, null, 2) : '' };
}

/** The form → input_data, or the problems in plain words. Empty fields are omitted. */
export function inputDataFromForm(
  fields: InputField[],
  values: InputValues,
  raw: string
): { input_data: Record<string, JsonValue> } | { problems: string[] } {
  const problems: string[] = [];
  let out: Record<string, JsonValue> = {};
  const text = raw.trim();
  if (text) {
    try {
      const parsed = JSON.parse(text) as unknown;
      if (!isRecord(parsed)) problems.push('Advanced: the raw JSON must be an object, like {"key": "value"}.');
      else out = { ...(parsed as Record<string, JsonValue>) };
    } catch (error) {
      problems.push(`Advanced: the raw JSON is not valid (${error instanceof Error ? error.message : String(error)}).`);
    }
  }
  if (TRIGGER_EVENT_PIN_ID in out) {
    problems.push('Advanced: "event" is filled by the trigger on every run; remove it.');
    delete out[TRIGGER_EVENT_PIN_ID];
  }
  for (const field of fields) {
    const value = values[field.id] ?? '';
    if (field.id in out && value.trim()) problems.push(`Advanced: "${field.id}" has its own field (${field.label}); set it there.`);
    if (!value.trim()) continue;
    switch (field.kind) {
      case 'prompt':
      case 'text':
        out[field.id] = value;
        break;
      case 'number': {
        const n = Number(value.trim());
        if (!Number.isFinite(n)) problems.push(`${field.label}: enter a number.`);
        else out[field.id] = n;
        break;
      }
      case 'boolean':
        out[field.id] = value === 'true';
        break;
      case 'json':
        try {
          out[field.id] = JSON.parse(value) as JsonValue;
        } catch (error) {
          problems.push(`${field.label}: not valid JSON (${error instanceof Error ? error.message : String(error)}).`);
        }
        break;
    }
  }
  return problems.length ? { problems } : { input_data: out };
}
