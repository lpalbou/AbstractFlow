// The Run form's reasoning (`thinking`) and MTP (`speculation`) pins follow the selected text model
// (operator rule 2026-11-07), with the kit's served-facts rules (usableSpeculation).
import { usableSpeculation } from '@abstractframework/ui-kit';

/** A text provider/model change: the reasoning and MTP pins go back to the default (''). */
export function withRouteOptionsReset(values: Record<string, string>, pinIds: readonly string[]): Record<string, string> {
  const next = { ...values };
  for (const id of pinIds) next[id] = '';
  return next;
}

/** The run input without a reasoning level the form does not offer for this model, or an MTP value
 * the model's capability card does not allow (no card = no MTP). Other inputs untouched. */
export function sendableRunPins(
  input: Record<string, unknown>,
  facts: { speculationCard: unknown; offeredReasoning: readonly string[] },
): Record<string, unknown> {
  const out = { ...input };
  if ('speculation' in out) out.speculation = usableSpeculation(out.speculation, facts.speculationCard);
  if (typeof out.thinking === 'string' && out.thinking && !facts.offeredReasoning.includes(out.thinking)) out.thinking = undefined;
  return out;
}
