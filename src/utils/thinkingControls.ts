// Reasoning (`thinking`) choices follow the SELECTED model's served facts (operator rule
// 2026-11-07, no model-name guessing): the levels the gateway's capability card lists, read with
// the kit's `reasoningFacts` (the same rule the kit ProviderModelPicker applies on the Agent and
// LLM call nodes). A model whose card lists no levels offers none.
import { reasoningFacts } from '@abstractframework/ui-kit';

export type ThinkingOption = {
  value: string;
  label: string;
};

export const AUTO_THINKING_OPTION: ThinkingOption = { value: '', label: 'Auto (Gateway default)' };

/** The reasoning choices for a model's capability payload: Auto, then the served levels; none when
 * the card lists no levels (or there is no card yet). */
export function thinkingOptionsFromModelCapabilities(payload: unknown): ThinkingOption[] {
  const { levels } = reasoningFacts(payload);
  if (!levels.length) return [];
  return [AUTO_THINKING_OPTION, ...levels.map((value) => ({ value, label: value }))];
}

/** The options a select shows: the served ones, plus a saved level they do not list, marked as
 * saved (as the kit picker does), so a stored choice is never silently relabelled as Auto. */
export function thinkingOptionsWithSaved(options: ThinkingOption[], saved: string): ThinkingOption[] {
  const base = options.length ? options : [AUTO_THINKING_OPTION];
  const clean = String(saved || '').trim();
  if (!clean || base.some((option) => option.value === clean)) return base;
  return [...base, { value: clean, label: `${clean} (saved)` }];
}
