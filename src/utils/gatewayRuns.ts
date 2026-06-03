/**
 * Gateway run summary helpers (thin client).
 */

import type { RunSummary } from '../types/flow';
import { ABSTRACTFLOW_DRAFT_PURPOSE } from './runLifecycle';

export function extractFlowIdFromWorkflowId(workflowId: string | null | undefined): string {
  const raw = typeof workflowId === 'string' ? workflowId.trim() : '';
  if (!raw) return '';
  const parts = raw.split(':');
  return parts.length > 1 ? parts[parts.length - 1] : raw;
}

export function mapGatewayRunSummary(raw: Record<string, unknown>): RunSummary {
  const waiting = raw.waiting && typeof raw.waiting === 'object' ? (raw.waiting as Record<string, unknown>) : null;
  const wait_reason = typeof waiting?.reason === 'string' ? waiting.reason : null;
  const wait_key = typeof waiting?.wait_key === 'string' ? waiting.wait_key : null;
  const prompt = typeof waiting?.prompt === 'string' ? waiting.prompt : null;
  const choices = Array.isArray(waiting?.choices) ? (waiting?.choices as string[]) : null;
  const allow_free_text = typeof waiting?.allow_free_text === 'boolean' ? waiting.allow_free_text : null;
  const flow_warnings = Array.isArray(raw.flow_warnings)
    ? (raw.flow_warnings as unknown[])
        .filter((w) => typeof w === 'string' && w.trim())
        .map((w) => String(w).trim())
    : null;
  const rawLifecycle =
    raw.run_lifecycle && typeof raw.run_lifecycle === 'object' && !Array.isArray(raw.run_lifecycle)
      ? (raw.run_lifecycle as Record<string, unknown>)
      : null;
  const lifecyclePurpose = typeof rawLifecycle?.purpose === 'string' ? rawLifecycle.purpose.trim() : '';
  const workflowId = typeof raw.workflow_id === 'string' ? raw.workflow_id : null;
  const isDraft = raw.is_draft === true || lifecyclePurpose === ABSTRACTFLOW_DRAFT_PURPOSE;

  return {
    run_id: String(raw.run_id || ''),
    workflow_id: workflowId,
    status: typeof raw.status === 'string' ? raw.status : 'unknown',
    current_node: typeof raw.current_node === 'string' ? raw.current_node : null,
    created_at: typeof raw.created_at === 'string' ? raw.created_at : null,
    updated_at: typeof raw.updated_at === 'string' ? raw.updated_at : null,
    parent_run_id: typeof raw.parent_run_id === 'string' ? raw.parent_run_id : null,
    error: typeof raw.error === 'string' ? raw.error : null,
    flow_warnings,
    wait_reason,
    wait_key,
    paused: Boolean(raw.paused),
    is_draft: isDraft,
    run_lifecycle: rawLifecycle,
    prompt,
    choices,
    allow_free_text,
  };
}

export function isDraftRunSummary(run: RunSummary): boolean {
  return Boolean(run.is_draft);
}

export function filterRunSummariesByFlowId(items: RunSummary[], flowId: string): RunSummary[] {
  const fid = (flowId || '').trim();
  if (!fid) return items;
  return items.filter((r) => extractFlowIdFromWorkflowId(r.workflow_id) === fid);
}
