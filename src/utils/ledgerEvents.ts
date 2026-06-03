/**
 * Ledger-to-ExecutionEvent mapping helpers (gateway-first).
 */

import type { ExecutionEvent } from '../types/flow';

export interface LedgerRecord {
  run_id?: string;
  step_id?: string;
  node_id?: string;
  status?: string;
  started_at?: string;
  ended_at?: string;
  effect?: Record<string, unknown> | null;
  result?: Record<string, unknown> | null;
  error?: string | null;
}

export interface LedgerMappingState {
  openNodesByRun: Map<string, Map<string, string>>;
}

export function createLedgerMappingState(): LedgerMappingState {
  return { openNodesByRun: new Map() };
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
    for (const [openNodeId, openTs] of Array.from(openNodes.entries())) {
      if (openNodeId === nodeId) continue;
      const dur = durationMs(openTs, ts);
      events.push({
        type: 'node_complete',
        runId,
        nodeId: openNodeId,
        ts,
        meta: dur !== undefined ? { duration_ms: Math.round(dur * 100) / 100 } : undefined,
      });
      openNodes.delete(openNodeId);
    }
    events.push({ type: 'node_start', runId, stepId, nodeId, ts });
    if (ts) openNodes.set(nodeId, ts);
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
    events.push({
      type: 'node_complete',
      runId,
      stepId,
      nodeId,
      ts,
      result: visibleResumeResult ?? (suppressResult ? undefined : rec.result),
      meta: dur !== undefined ? { duration_ms: Math.round(dur * 100) / 100 } : undefined,
    });
    openNodes.delete(nodeId);
  } else if (status === 'failed') {
    const ts = endedAt || startedAt;
    events.push({
      type: 'flow_error',
      runId,
      stepId,
      nodeId,
      ts,
      error: normalizeString(rec.error) || 'Step failed',
    });
    openNodes.delete(nodeId);
  } else if (status === 'waiting') {
    const waitInfo = extractWaitInfo(rec);
    if (waitInfo?.isPause) {
      events.push({ type: 'flow_paused', runId, stepId, nodeId, ts: endedAt || startedAt });
    } else if (waitInfo) {
      events.push({
        type: 'flow_waiting',
        runId,
        stepId,
        nodeId,
        ts: endedAt || startedAt,
        prompt: waitInfo.prompt,
        choices: waitInfo.choices,
        allow_free_text: waitInfo.allowFreeText,
        wait_key: waitInfo.waitKey || undefined,
        reason: waitInfo.reason || undefined,
        details: waitInfo.details,
      });
      if (waitInfo.subRunId) {
        events.push({
          type: 'subworkflow_update',
          runId,
          stepId,
          nodeId,
          sub_run_id: waitInfo.subRunId,
        });
      }
    }
    if (!openNodes.has(nodeId)) {
      openNodes.set(nodeId, startedAt || endedAt || '');
    }
  }

  const subRunId = normalizeString((rec.result as Record<string, unknown> | null)?.sub_run_id);
  if (effType === 'start_subworkflow' && subRunId) {
    events.push({ type: 'subworkflow_update', runId, stepId, nodeId, sub_run_id: subRunId });
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
  for (const [nodeId, openTs] of Array.from(openNodes.entries())) {
    const dur = durationMs(openTs, ts);
    out.push({
      type: 'node_complete',
      runId,
      nodeId,
      ts,
      meta: dur !== undefined ? { duration_ms: Math.round(dur * 100) / 100 } : undefined,
    });
  }
  openNodes.clear();
  return out;
}
