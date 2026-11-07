// The Run form's reasoning (`thinking`) and MTP (`speculation`) pins follow the selected text model
// (operator rule 2026-11-07), with the kit's served-facts rules (usableSpeculation, usableReasoning).
import { usableReasoning, usableSpeculation } from '@abstractframework/ui-kit';

/** A text provider/model change: the reasoning and MTP pins go back to the default (''). */
export function withRouteOptionsReset(values: Record<string, string>, pinIds: readonly string[]): Record<string, string> {
  const next = { ...values };
  for (const id of pinIds) next[id] = '';
  return next;
}

/** The run input without a reasoning level the model's served card rules out (a level it does not
 * list, or `thinking_support: false`; unknown facts keep the level, the kit's usableReasoning), or an
 * MTP value its capability card does not allow (no card = no MTP). Other inputs untouched. */
export function sendableRunPins(
  input: Record<string, unknown>,
  facts: { speculationCard: unknown; reasoningCard: unknown },
): Record<string, unknown> {
  const out = { ...input };
  if ('speculation' in out) out.speculation = usableSpeculation(out.speculation, facts.speculationCard);
  if (typeof out.thinking === 'string' && out.thinking) out.thinking = usableReasoning(out.thinking, facts.reasoningCard) || undefined;
  return out;
}
