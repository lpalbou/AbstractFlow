/**
 * Is Empty takes a text or a list (QA 2026-10-28 (e); AbstractRuntime backlog
 * 0862: nothing, "" or a list/object with no elements is empty). Its input
 * keeps the runtime id `text`; flows saved before typed it `string`, which
 * refused a list wire: on load the pin becomes `any`, labelled `value`
 * (a label the author changed is kept).
 */
import type { FlowNodeData } from '../types/flow';

export function withIsEmptyAnyInput<T extends Pick<FlowNodeData, 'nodeType' | 'inputs'>>(data: T): T {
  if (data.nodeType !== 'is_empty_string' || !Array.isArray(data.inputs)) return data;
  const pin = data.inputs.find((p) => p.id === 'text');
  if (!pin || pin.type === 'any') return data;
  return {
    ...data,
    inputs: data.inputs.map((p) => (p.id === 'text' ? { ...p, type: 'any' as const, label: p.label === 'text' || !p.label ? 'value' : p.label } : p)),
  };
}
