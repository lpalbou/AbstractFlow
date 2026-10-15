import type { FlowNodeData, Pin, PinType } from '../types/flow';
import { flowIoArrayItemTypeForPin, type FlowIoArrayItemType } from './pinTypeOptions';

/**
 * Set Variables rows (operator 2026-10-11: "set multiple variables at once ...
 * just defining name and type ... and optionally a default value"). Each row is
 * a data input pin of the node: its id is the variable name, its type the
 * variable's type, its pin default the value written when nothing is wired
 * (abstractruntime set_vars: every data pin besides `updates` is written).
 * The node has no whole-object `updates` pin any more (rows replaced it); an
 * older flow keeps it only while something is wired to it.
 */

export const SET_VARIABLE_TYPES: ReadonlyArray<PinType> = ['string', 'number', 'boolean', 'array', 'object', 'any'];

/** What a new row of this type starts with: the value written when nothing is wired. */
export function defaultForVariableType(type: PinType): unknown {
  switch (type) {
    case 'string':
      return '';
    case 'number':
      return 0;
    case 'boolean':
      return false;
    case 'array':
      return [];
    case 'object':
      return {};
    default:
      return null;
  }
}

/** What an array row can hold (the same "array of X" pin schema On Flow Start uses). */
export const SET_VARIABLE_ITEM_TYPES: ReadonlyArray<FlowIoArrayItemType> = ['any', 'string', 'number', 'boolean', 'object'];

/** The element type of an array row ('any' when it says nothing). */
export function setVariableItemType(pin: Pick<Pin, 'type' | 'schema'>): FlowIoArrayItemType {
  const itemType = flowIoArrayItemTypeForPin(pin);
  return SET_VARIABLE_ITEM_TYPES.includes(itemType) ? itemType : 'any';
}

function jsonKind(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

/** Why `value` cannot be this row's value (an array whose items are not its element type), or null. */
export function setVariableValueProblem(pin: Pick<Pin, 'id' | 'type' | 'schema'>, value: unknown): string | null {
  if (pin.type !== 'array') return null;
  if (!Array.isArray(value)) return `${pin.id} is a list: write it as [ ... ]`;
  const itemType = setVariableItemType(pin);
  if (itemType === 'any') return null;
  const expected = itemType === 'object' ? 'object' : itemType;
  const bad = value.findIndex((item) => jsonKind(item) !== expected);
  if (bad < 0) return null;
  return `Item ${bad + 1} of ${pin.id} is ${jsonKind(value[bad])}, not ${itemType === 'object' ? 'json' : itemType}`;
}

/** The row type that fits a value an older flow stored in `updates`. */
function rowTypeForValue(value: unknown): PinType {
  const kind = jsonKind(value);
  if (kind === 'string' || kind === 'number' || kind === 'boolean' || kind === 'array' || kind === 'object') return kind;
  return 'any';
}

/**
 * Older Set Variables nodes carried a whole-object `updates` pin. On load, a
 * value typed into it becomes one row per key and the pin goes; a pin with a
 * wire stays, since the wire decides at run time what it sets (the runtime
 * still reads it). Returns the same data when there is nothing to move.
 */
export function withSetVariableRows(
  data: FlowNodeData,
  wiredInputs: ReadonlySet<string>,
  wiredOutputs: ReadonlySet<string>
): FlowNodeData {
  if (data.nodeType !== 'set_vars') return data;
  const inputs = data.inputs || [];
  const outputs = data.outputs || [];
  const hasInput = inputs.some((p) => p.id === 'updates');
  const hasOutput = outputs.some((p) => p.id === 'updates');
  if (!hasInput && !hasOutput) return data;

  const pinDefaults = { ...(data.pinDefaults || {}) } as Record<string, unknown>;
  let nextInputs = inputs;
  if (hasInput && !wiredInputs.has('updates')) {
    const seed = pinDefaults.updates;
    const entries = seed && typeof seed === 'object' && !Array.isArray(seed) ? Object.entries(seed as Record<string, unknown>) : [];
    const rows = setVariableRows(inputs);
    const taken = new Set(rows.map((r) => r.id));
    // A key that cannot be a row name keeps the old pin, so no value is lost.
    if (entries.every(([key]) => variableNameProblem(key, taken) === null)) {
      const added: Pin[] = entries.map(([key, value]) => ({ id: key, label: key, type: rowTypeForValue(value) }));
      for (const [key, value] of entries) pinDefaults[key] = value;
      delete pinDefaults.updates;
      nextInputs = [...inputs.filter((p) => p.id !== 'updates'), ...added];
    }
  }
  const nextOutputs = hasOutput && !wiredOutputs.has('updates') ? outputs.filter((p) => p.id !== 'updates') : outputs;
  if (nextInputs === inputs && nextOutputs === outputs) return data;
  return { ...data, inputs: nextInputs, outputs: nextOutputs, pinDefaults: pinDefaults as FlowNodeData['pinDefaults'] };
}

/** The variable rows of a Set Variables node: its data inputs except an older flow's wired `updates`. */
export function setVariableRows(inputs: Pin[]): Pin[] {
  return inputs.filter((p) => p.type !== 'execution' && p.id !== 'updates');
}

/** A usable variable name, or why not (names are pin ids; a leading `_` is reserved by the runtime). */
export function variableNameProblem(name: string, taken: ReadonlySet<string>, verb: 'set' | 'read' = 'set'): string | null {
  const trimmed = name.trim();
  if (!trimmed) return 'A variable needs a name';
  if (/\s/.test(trimmed)) return 'Names have no spaces (use _ or a dotted path)';
  if (trimmed.startsWith('_')) return 'Names starting with _ are reserved';
  if (trimmed === 'updates') return '"updates" is reserved by older Set Variables nodes';
  if (taken.has(trimmed)) return `"${trimmed}" is already ${verb} by this node`;
  return null;
}
