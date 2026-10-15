/**
 * Which ledger records are one step. STARTED and COMPLETED share a step_id. A
 * tool call that needs approval does not: the runtime parks it (WAITING, on
 * the tool_approval wait) and, once approved, writes the execution as a NEW
 * step_id with the SAME idempotency key. Keyed by step_id alone, the approved
 * call stayed "WAITING" forever beside a second, completed copy of the same
 * tool (2026-10-11, run 15dc6e47: 70 approvals, all executed). Tool calls are
 * therefore keyed by their idempotency key when the runtime gives one. Backlog
 * root 1016 tracks reading this state from the runtime instead.
 */
export function ledgerStepKey(record: Record<string, unknown>, stepId: string): string {
  const effect = record.effect as Record<string, unknown> | null | undefined;
  const idem = typeof record.idempotency_key === 'string' ? record.idempotency_key.trim() : '';
  return effect && effect.type === 'tool_calls' && idem ? `idem:${idem}` : stepId;
}
