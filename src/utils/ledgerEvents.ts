/**
 * Ledger-to-ExecutionEvent mapping helpers (gateway-first).
 */

import type { ExecutionEvent } from '../types/flow';

export interface LedgerRecord {
  run_id?: string;
  step_id?: string;
  node_id?: string;
  status?: string;
  idempotency_key?: string | null;
  started_at?: string;
  ended_at?: string;
  effect?: Record<string, unknown> | null;
  result?: Record<string, unknown> | null;
  error?: string | null;
}

interface RunExecutions {
  byStep: Map<string, string>;
  byWaitKey: Map<string, string>;
  latestByNode: Map<string, string>;
  idemByExec: Map<string, Set<string>>;
}

export interface LedgerMappingState {
  /** Open executions per run: execId -> { nodeId, started ts }. */
  openNodesByRun: Map<string, Map<string, { nodeId: string; ts: string }>>;
  executionsByRun: Map<string, RunExecutions>;
}

export function createLedgerMappingState(): LedgerMappingState {
  return { openNodesByRun: new Map(), executionsByRun: new Map() };
}

/**
 * Which execution of its node a ledger record belongs to (one run-window row
 * per execution). The runtime writes several steps for one execution and
 * states no execution id (root backlog 1016), so the phases are recognised
 * from what the records do carry, in this order:
 * 1. a step already seen belongs to its execution;
 * 2. a resume belongs to the execution whose wait it answers (same wait key);
 * 3. a record whose idempotency key is already in the node's latest execution
 *    belongs to it (an approved tool call's execution, a retry, a crash replay);
 * 4. an Agent's structured-output call (`_temp.agent.<node>.structured`) and
 *    the run's terminal record belong to the node's latest execution;
 * 5. anything else starts a new execution.
 * "Same node, nothing recorded in between" is NOT a rule: loops, If/Else and
 * Set Variable write no records, so a node run twice in a row would merge.
 * Checked over every ledger of the operator's gateway (2026-10-11): 1,668 rows
 * removed, none added.
 */
export function executionIdFor(rec: LedgerRecord, state: LedgerMappingState): string | undefined {
  const runId = normalizeString(rec.run_id);
  const nodeId = normalizeString(rec.node_id);
  const stepId = normalizeString(rec.step_id);
  if (!runId || !nodeId || !stepId) return undefined;
  let ex = state.executionsByRun.get(runId);
  if (!ex) {
    ex = { byStep: new Map(), byWaitKey: new Map(), latestByNode: new Map(), idemByExec: new Map() };
    state.executionsByRun.set(runId, ex);
  }
  const effect = (rec.effect || {}) as Record<string, unknown>;
  const payload = (effect.payload || {}) as Record<string, unknown>;
  const idem = normalizeString(rec.idempotency_key);
  const latest = ex.latestByNode.get(nodeId);

  let execId = ex.byStep.get(stepId);
  if (!execId && effect.type === 'resume') execId = ex.byWaitKey.get(normalizeString(payload.wait_key));
  if (!execId && idem && latest && ex.idemByExec.get(latest)?.has(idem)) execId = latest;
  if (!execId && latest) {
    const resultKey = normalizeString(effect.result_key);
    if (resultKey === `_temp.agent.${nodeId}.structured` || idem.startsWith('system:completion:')) execId = latest;
  }
  if (!execId) execId = stepId;

  ex.byStep.set(stepId, execId);
  ex.latestByNode.set(nodeId, execId);
  if (idem) {
    const idems = ex.idemByExec.get(execId) || new Set<string>();
    idems.add(idem);
    ex.idemByExec.set(execId, idems);
  }
  const wait = ((rec.result || {}) as Record<string, unknown>).wait as Record<string, unknown> | undefined;
  const waitKey = normalizeString(wait?.wait_key);
  if (normalizeString(rec.status).toLowerCase() === 'waiting' && waitKey) ex.byWaitKey.set(waitKey, execId);
  return execId;
}

function durationMs(startIso?: string | null, endIso?: string | null): number | undefined {
  if (!startIso || !endIso) return undefined;
  const s = new Date(startIso).getTime();
  const e = new Date(endIso).getTime();
  if (!Number.isFinite(s) || !Number.isFinite(e)) return undefined;
  return Math.max(0, e - s);
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isAbstractStatusResult(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return normalizeString(record.name) === 'abstract.status';
}

function extractAbstractProgressPayload(rec: LedgerRecord): Record<string, unknown> | null {
  const fromResult = rec.result && typeof rec.result === 'object' ? (rec.result as Record<string, unknown>) : null;
  if (normalizeString(fromResult?.name) === 'abstract.progress') {
    const payload = fromResult?.payload;
    if (payload && typeof payload === 'object' && !Array.isArray(payload)) return payload as Record<string, unknown>;
    return {};
  }

  const effectPayload = rec.effect?.payload;
  const fromEffect = effectPayload && typeof effectPayload === 'object' && !Array.isArray(effectPayload)
    ? (effectPayload as Record<string, unknown>)
    : null;
  if (normalizeString(fromEffect?.name) === 'abstract.progress') {
    const payload = fromEffect?.payload;
    if (payload && typeof payload === 'object' && !Array.isArray(payload)) return payload as Record<string, unknown>;
    return {};
  }

  return null;
}

function extractWaitInfo(rec: LedgerRecord) {
  const res = rec && typeof rec === 'object' ? rec.result : null;
  const wait = res && typeof res === 'object' ? (res as Record<string, unknown>).wait : null;
  if (!wait || typeof wait !== 'object') return null;
  const waitObj = wait as Record<string, unknown>;
  const waitKey = normalizeString(waitObj.wait_key);
  const reason = normalizeString(waitObj.reason);
  const details = waitObj.details;
  const detailObj = details && typeof details === 'object' ? (details as Record<string, unknown>) : null;
  const isPause = waitKey.startsWith('pause:') || detailObj?.kind === 'pause';
  const subRunId =
    normalizeString(detailObj?.sub_run_id) ||
    normalizeString(detailObj?.subRunId) ||
    (waitKey.startsWith('subworkflow:') ? waitKey.replace('subworkflow:', '').trim() : '');
  return {
    waitKey,
    reason,
    prompt: normalizeString(waitObj.prompt) || undefined,
    choices: Array.isArray(waitObj.choices) ? (waitObj.choices as string[]) : undefined,
    allowFreeText: waitObj.allow_free_text !== false,
    // Deadline-bearing waits (WAIT_EVENT with an idle timeout, WAIT_UNTIL)
    // carry `until` beside `wait_key` — pass it through for honest rendering.
    until: normalizeString(waitObj.until) || undefined,
    isPause,
    subRunId: subRunId || undefined,
    details: detailObj || undefined,
  };
}

function traceUpdateEvent(rec: LedgerRecord, nodeId: string, runId: string): ExecutionEvent {
  const ts = normalizeString(rec.ended_at) || normalizeString(rec.started_at) || undefined;
  const step = { ...rec, ts };
  return {
    type: 'trace_update',
    runId,
    stepId: normalizeString(rec.step_id) || undefined,
    nodeId,
    steps: [step],
  };
}

export interface ToolApprovalResumeMarker {
  approved: true;
  auto: boolean;
}

/**
 * Tool-approval resume detection (backlog 0138 — approval visibility).
 *
 * An approved tool-approval resume used to be suppressed as bookkeeping,
 * which made Approve All a silent safety bypass: the timeline showed no
 * trace that a tool call ran without a prompt. The resume ledger record
 * carries the needed signal end to end:
 * - `effect.payload.wait_reason === 'user'` (tool approvals park as
 *   WaitReason.USER; event/job/until resumes are excluded by this),
 * - the inner resume payload carries a BOOLEAN `approved` — only approval
 *   resumes send it (ask_user replies send response/text/value instead),
 * - `auto_approved: true` is stamped exclusively by the client auto-approve
 *   path, so auto vs manual approval is distinguishable.
 *
 * Returns a marker for APPROVED resumes only (denied tool calls never
 * execute, so there is nothing to audit in the timeline); null otherwise.
 */
export function toolApprovalResumeMarker(rec: LedgerRecord): ToolApprovalResumeMarker | null {
  const effect = rec.effect && typeof rec.effect === 'object' ? rec.effect : null;
  if (normalizeString(effect?.type) !== 'resume') return null;
  const resumed =
    rec.result && typeof rec.result === 'object' ? (rec.result as Record<string, unknown>).resumed === true : false;
  if (!resumed) return null;
  const effectPayload = effect ? effect.payload : null;
  const payload = effectPayload && typeof effectPayload === 'object' && !Array.isArray(effectPayload)
    ? (effectPayload as Record<string, unknown>)
    : null;
  if (!payload) return null;
  if (normalizeString(payload.wait_reason).toLowerCase() !== 'user') return null;
  const userPayload = payload.payload && typeof payload.payload === 'object' && !Array.isArray(payload.payload)
    ? (payload.payload as Record<string, unknown>)
    : null;
  if (!userPayload) return null;
  if (userPayload.approved !== true) return null;
  return { approved: true, auto: userPayload.auto_approved === true };
}

function resumePayloadResult(rec: LedgerRecord): Record<string, unknown> | undefined {
  const effect = rec.effect && typeof rec.effect === 'object' ? rec.effect : null;
  if (normalizeString(effect?.type) !== 'resume') return undefined;
  const effectPayload = effect ? effect.payload : null;
  const payload = effectPayload && typeof effectPayload === 'object' && !Array.isArray(effectPayload)
    ? (effectPayload as Record<string, unknown>)
    : null;
  const resumed = rec.result && typeof rec.result === 'object' ? (rec.result as Record<string, unknown>).resumed === true : false;
  if (!payload || !resumed) return undefined;
  const waitReason = normalizeString(payload.wait_reason).toLowerCase();
  if (!['event', 'user'].includes(waitReason)) return undefined;
  const userPayload = payload.payload && typeof payload.payload === 'object' && !Array.isArray(payload.payload)
    ? (payload.payload as Record<string, unknown>)
    : null;
  if (!userPayload) return undefined;
  // Event parks (backlog 0111): the resume payload IS the event envelope that
  // woke the park — any non-empty payload is the honest visible content.
  // User waits keep the narrower rule (only recognized reply keys surface).
  if (waitReason === 'event') {
    return Object.keys(userPayload).length > 0 ? userPayload : undefined;
  }
  const hasVisibleOutput =
    userPayload.audio_artifact != null ||
    userPayload.artifact_ref != null ||
    userPayload.artifact != null ||
    userPayload.image_artifact != null ||
    userPayload.video_artifact != null ||
    userPayload.response != null ||
    userPayload.text != null ||
    userPayload.value != null;
  return hasVisibleOutput ? userPayload : undefined;
}

export function mapLedgerRecordToEvents(rec: LedgerRecord, state: LedgerMappingState): ExecutionEvent[] {
  const runId = normalizeString(rec.run_id);
  const nodeId = normalizeString(rec.node_id);
  if (!runId || !nodeId) return [];
  const stepId = normalizeString(rec.step_id) || undefined;
  const execId = executionIdFor(rec, state);
  const openKey = execId || nodeId;

  const effType = normalizeString(rec.effect?.type);
  const resObj = rec.result && typeof rec.result === 'object' ? (rec.result as Record<string, unknown>) : null;
  const visibleResumeResult = resumePayloadResult(rec);
  const suppressResult = effType === 'resume' && resObj && resObj.resumed === true && visibleResumeResult === undefined;

  const status = normalizeString(rec.status).toLowerCase();
  const startedAt = normalizeString(rec.started_at) || undefined;
  const endedAt = normalizeString(rec.ended_at) || undefined;

  let openNodes = state.openNodesByRun.get(runId);
  if (!openNodes) {
    openNodes = new Map();
    state.openNodesByRun.set(runId, openNodes);
  }

  const events: ExecutionEvent[] = [];

  if (status === 'started') {
    const ts = startedAt || endedAt;
    // A new execution closes every other open one of the run (the runtime runs
    // one node at a time); a later phase of the same execution does not.
    for (const [key, open] of Array.from(openNodes.entries())) {
      if (key === openKey) continue;
      const dur = durationMs(open.ts, ts);
      events.push({
        type: 'node_complete',
        runId,
        nodeId: open.nodeId,
        execId: key === open.nodeId ? undefined : key,
        ts,
        meta: dur !== undefined ? { duration_ms: Math.round(dur * 100) / 100 } : undefined,
      });
      openNodes.delete(key);
    }
    events.push({ type: 'node_start', runId, stepId, execId, nodeId, ts });
    if (ts && !openNodes.has(openKey)) openNodes.set(openKey, { nodeId, ts });
  } else if (status === 'completed') {
    if (isAbstractStatusResult(rec.result)) {
      events.push(traceUpdateEvent(rec, nodeId, runId));
      return events;
    }

    const progressPayload = extractAbstractProgressPayload(rec);
    if (progressPayload) {
      const ts = endedAt || startedAt;
      events.push({
        type: 'node_progress',
        runId,
        execId,
        stepId: normalizeString(progressPayload.step_id) || stepId,
        nodeId: normalizeString(progressPayload.node_id) || nodeId,
        ts,
        progress: progressPayload,
        result: progressPayload,
      });
      events.push(traceUpdateEvent(rec, nodeId, runId));
      return events;
    }

    const ts = endedAt || startedAt;
    const dur = durationMs(startedAt, endedAt);
    // Approved tool-approval resumes keep their result suppressed (the
    // decision payload is not a step output) but must not vanish: the marker
    // lets the timeline show which tool calls ran with (auto-)approval.
    const approvalMarker = effType === 'resume' ? toolApprovalResumeMarker(rec) : null;
    events.push({
      type: 'node_complete',
      runId,
      stepId,
      execId,
      nodeId,
      ts,
      result: visibleResumeResult ?? (suppressResult ? undefined : rec.result),
      meta: dur !== undefined ? { duration_ms: Math.round(dur * 100) / 100 } : undefined,
      approval: approvalMarker ?? undefined,
    });
    openNodes.delete(openKey);
  } else if (status === 'failed') {
    const ts = endedAt || startedAt;
    events.push({
      type: 'flow_error',
      runId,
      stepId,
      execId,
      nodeId,
      ts,
      error: normalizeString(rec.error) || 'Step failed',
    });
    openNodes.delete(openKey);
  } else if (status === 'waiting') {
    const waitInfo = extractWaitInfo(rec);
    if (waitInfo?.isPause) {
      events.push({ type: 'flow_paused', runId, stepId, execId, nodeId, ts: endedAt || startedAt });
    } else if (waitInfo) {
      events.push({
        type: 'flow_waiting',
        runId,
        stepId,
        execId,
        nodeId,
        ts: endedAt || startedAt,
        prompt: waitInfo.prompt,
        choices: waitInfo.choices,
        allow_free_text: waitInfo.allowFreeText,
        wait_key: waitInfo.waitKey || undefined,
        reason: waitInfo.reason || undefined,
        until: waitInfo.until,
        details: waitInfo.details,
      });
      if (waitInfo.subRunId) {
        events.push({
          type: 'subworkflow_update',
          runId,
          stepId,
          execId,
          nodeId,
          sub_run_id: waitInfo.subRunId,
        });
      }
    }
    if (!openNodes.has(openKey)) {
      openNodes.set(openKey, { nodeId, ts: startedAt || endedAt || '' });
    }
  }

  const subRunId = normalizeString((rec.result as Record<string, unknown> | null)?.sub_run_id);
  if (effType === 'start_subworkflow' && subRunId) {
    events.push({ type: 'subworkflow_update', runId, stepId, execId, nodeId, sub_run_id: subRunId });
  }

  events.push(traceUpdateEvent(rec, nodeId, runId));
  return events;
}

export function closeOpenNodes({
  runId,
  state,
  ts,
}: {
  runId: string;
  state: LedgerMappingState;
  ts: string | undefined;
}): ExecutionEvent[] {
  const openNodes = state.openNodesByRun.get(runId);
  if (!openNodes || openNodes.size === 0) return [];
  const out: ExecutionEvent[] = [];
  for (const [key, open] of Array.from(openNodes.entries())) {
    const nodeId = open.nodeId;
    const dur = durationMs(open.ts, ts);
    out.push({
      type: 'node_complete',
      runId,
      nodeId,
      execId: key === nodeId ? undefined : key,
      ts,
      meta: dur !== undefined ? { duration_ms: Math.round(dur * 100) / 100 } : undefined,
    });
  }
  openNodes.clear();
  return out;
}
