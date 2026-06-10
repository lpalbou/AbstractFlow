import type { ExecutionEvent } from '../types/flow';

export interface PendingApprovalWait {
  prompt: string;
  choices: string[];
  allowFreeText: boolean;
  nodeId: string | null;
  waitKey?: string;
  runId?: string;
  reason?: string;
  details?: Record<string, unknown>;
}

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function approvalDetailsFromEvent(event: ExecutionEvent): Record<string, unknown> | null {
  if (event.type !== 'flow_waiting') return null;
  const details = event.details && typeof event.details === 'object' ? event.details : null;
  if (!details) return null;
  const mode = cleanString(details.mode).toLowerCase();
  const kind = cleanString(details.kind).toLowerCase();
  if (mode !== 'approval_required' && kind !== 'tool_approval') return null;
  return details;
}

function sameRun(wait: PendingApprovalWait, event: ExecutionEvent): boolean {
  const waitRunId = cleanString(wait.runId);
  const eventRunId = cleanString(event.runId);
  return !waitRunId || !eventRunId || waitRunId === eventRunId;
}

function sameNode(wait: PendingApprovalWait, event: ExecutionEvent): boolean {
  const waitNodeId = cleanString(wait.nodeId);
  const eventNodeId = cleanString(event.nodeId);
  return !waitNodeId || !eventNodeId || waitNodeId === eventNodeId;
}

function resolvesPendingApproval(wait: PendingApprovalWait, event: ExecutionEvent): boolean {
  if (!sameRun(wait, event)) return false;
  if (event.type === 'flow_complete' || event.type === 'flow_cancelled' || event.type === 'flow_resumed') return true;
  if (event.type === 'flow_error') return sameNode(wait, event);
  if (event.type === 'node_complete' || event.type === 'node_progress') return sameNode(wait, event);
  if (event.type === 'node_start') return true;
  return false;
}

export function extractReplayTraceEvents(events: ExecutionEvent[]): ExecutionEvent[] {
  return events.filter((event) => event.type === 'trace_update');
}

export function extractPendingApprovalWait(events: ExecutionEvent[]): PendingApprovalWait | null {
  let pending: PendingApprovalWait | null = null;

  for (const event of events) {
    if (pending && resolvesPendingApproval(pending, event)) {
      pending = null;
    }

    const details = approvalDetailsFromEvent(event);
    if (!details) continue;
    pending = {
      prompt: event.prompt || 'Please respond:',
      choices: Array.isArray(event.choices) ? event.choices : [],
      allowFreeText: event.allow_free_text !== false,
      nodeId: event.nodeId || null,
      waitKey: event.wait_key,
      runId: event.runId || undefined,
      reason: typeof event.reason === 'string' ? event.reason : undefined,
      details,
    };
  }

  return pending;
}
