/**
 * Ledger-stream hook for real-time flow execution updates.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ExecutionEvent } from '../types/flow';
import { useFlowStore } from './useFlow';
import {
  closeOpenNodes,
  createLedgerMappingState,
  mapLedgerRecordToEvents,
  type LedgerRecord,
} from '../utils/ledgerEvents';

// Stable per-tab session id for run context continuity.
const STABLE_SESSION_ID_KEY = 'abstractflow_session_id_v1';
const AUTO_APPROVE_SESSIONS_KEY = 'abstractflow_auto_approve_sessions_v1';

function getOrCreateStableSessionId(): string | undefined {
  // Stable per browser tab (sessionStorage), used to back AbstractRuntime `session` scope
  // across multiple flow executions within the same UI session.
  try {
    const existing = window.sessionStorage.getItem(STABLE_SESSION_ID_KEY);
    if (existing && existing.trim()) return existing.trim();

    const next =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `af_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
    window.sessionStorage.setItem(STABLE_SESSION_ID_KEY, next);
    return next;
  } catch {
    return undefined;
  }
}

function loadAutoApproveSessions(): Set<string> {
  try {
    const raw = window.sessionStorage.getItem(AUTO_APPROVE_SESSIONS_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    const items = parsed.filter((v) => typeof v === 'string' && v.trim()).map((v) => v.trim());
    return new Set(items);
  } catch {
    return new Set();
  }
}

function persistAutoApproveSessions(next: Set<string>) {
  try {
    const arr = Array.from(next.values());
    window.sessionStorage.setItem(AUTO_APPROVE_SESSIONS_KEY, JSON.stringify(arr));
  } catch {
    // Best-effort; ignore storage failures.
  }
}

interface UseWebSocketOptions {
  flowId: string;
  onEvent?: (event: ExecutionEvent) => void;
  onWaiting?: (info: WaitingInfo) => void;
}

export interface WaitingInfo {
  prompt: string;
  choices: string[];
  allowFreeText: boolean;
  nodeId: string | null;
  waitKey?: string;
  runId?: string;
  reason?: string;
  details?: Record<string, unknown>;
}

export function useWebSocket({ flowId, onEvent, onWaiting }: UseWebSocketOptions) {
  const streamRef = useRef<EventSource | null>(null);
  const streamCursorRef = useRef<number>(0);
  const mappingStateRef = useRef(createLedgerMappingState());
  const stableSessionIdRef = useRef<string | undefined>(undefined);
  const [stableSessionId, setStableSessionId] = useState<string | undefined>(() => getOrCreateStableSessionId());
  const [autoApproveSessions, setAutoApproveSessions] = useState<Set<string>>(() => loadAutoApproveSessions());
  const autoApproveSessionsRef = useRef<Set<string>>(autoApproveSessions);
  const autoApprovedWaitKeysRef = useRef<Set<string>>(new Set());
  const autoApproveRunRootsRef = useRef<Set<string>>(new Set());
  const rootRunIdRef = useRef<string | null>(null);
  const runRootByRunIdRef = useRef<Map<string, string>>(new Map());
  const [connected, setConnected] = useState(false);
  const [isWaiting, setIsWaiting] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [waitingInfo, setWaitingInfo] = useState<WaitingInfo | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const runIdRef = useRef<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pausedRef = useRef(false);
  const waitingRef = useRef(false);
  const waitingInfoRef = useRef<WaitingInfo | null>(null);
  const terminalEmittedRef = useRef<Map<string, string>>(new Map());
  const subrunStreamsRef = useRef<Map<string, EventSource>>(new Map());
  const subrunCursorRef = useRef<Map<string, number>>(new Map());
  const ensureSubrunStreamRef = useRef<(runId: string) => void>(() => {});

  const { setExecutingNodeId, setIsRunning } = useFlowStore();
  const nodes = useFlowStore((s) => s.nodes);
  const edges = useFlowStore((s) => s.edges);
  const resetExecutionDecorations = useFlowStore((s) => s.resetExecutionDecorations);
  const markRecentNode = useFlowStore((s) => s.markRecentNode);
  const unmarkRecentNode = useFlowStore((s) => s.unmarkRecentNode);
  const markRecentEdge = useFlowStore((s) => s.markRecentEdge);
  const unmarkRecentEdge = useFlowStore((s) => s.unmarkRecentEdge);
  const setLoopProgress = useFlowStore((s) => s.setLoopProgress);

  const nodeIdSet = useMemo(() => new Set(nodes.map((n) => n.id)), [nodes]);
  const nodeById = useMemo(() => new Map(nodes.map((n) => [n.id, n] as const)), [nodes]);

  useEffect(() => {
    autoApproveSessionsRef.current = autoApproveSessions;
  }, [autoApproveSessions]);

  const setAutoApproveForSession = useCallback((sessionId: string, enabled: boolean) => {
    const sid = typeof sessionId === 'string' ? sessionId.trim() : '';
    if (!sid) return;
    setAutoApproveSessions((prev) => {
      const next = new Set(prev);
      if (enabled) next.add(sid);
      else next.delete(sid);
      persistAutoApproveSessions(next);
      return next;
    });
  }, []);

  const setAutoApproveForRunRoot = useCallback((rootRunId: string, enabled: boolean) => {
    const rid = typeof rootRunId === 'string' ? rootRunId.trim() : '';
    if (!rid) return;
    if (enabled) autoApproveRunRootsRef.current.add(rid);
    else autoApproveRunRootsRef.current.delete(rid);
  }, []);

  const persistStableSessionId = useCallback((next?: string) => {
    const trimmed = typeof next === 'string' ? next.trim() : '';
    if (!trimmed) {
      stableSessionIdRef.current = undefined;
      setStableSessionId(undefined);
      try {
        window.sessionStorage.removeItem(STABLE_SESSION_ID_KEY);
      } catch {
        // Best-effort; ignore storage failures.
      }
      return;
    }
    stableSessionIdRef.current = trimmed;
    setStableSessionId(trimmed);
    try {
      window.sessionStorage.setItem(STABLE_SESSION_ID_KEY, trimmed);
    } catch {
      // Best-effort; ignore storage failures.
    }
  }, []);

  useEffect(() => {
    pausedRef.current = isPaused;
  }, [isPaused]);

  useEffect(() => {
    waitingRef.current = isWaiting;
  }, [isWaiting]);

  useEffect(() => {
    waitingInfoRef.current = waitingInfo;
  }, [waitingInfo]);

  useEffect(() => {
    stableSessionIdRef.current = stableSessionId;
  }, [stableSessionId]);

  const isToolApprovalWait = useCallback((info: WaitingInfo | null): boolean => {
    if (!info) return false;
    const details = info.details;
    if (!details || typeof details !== 'object') return false;
    const mode = typeof details.mode === 'string' ? details.mode.trim() : '';
    const kind = typeof details.kind === 'string' ? details.kind.trim() : '';
    return mode === 'approval_required' || kind === 'tool_approval';
  }, []);

  // Execution observability afterglow:
  // Keep recently executed nodes/edges highlighted long enough to be readable when flows run fast.
  const AFTERGLOW_MS = 3000;
  const recentNodeTimersRef = useRef<Record<string, number>>({});
  const recentEdgeTimersRef = useRef<Record<string, number>>({});
  const lastRootNodeIdRef = useRef<string | null>(null);

  const markNodeAfterglow = useCallback(
    (nodeId: string) => {
      if (!nodeId) return;
      const prev = recentNodeTimersRef.current[nodeId];
      if (prev) window.clearTimeout(prev);

      unmarkRecentNode(nodeId);
      window.requestAnimationFrame(() => {
        markRecentNode(nodeId);
        recentNodeTimersRef.current[nodeId] = window.setTimeout(() => {
          unmarkRecentNode(nodeId);
          delete recentNodeTimersRef.current[nodeId];
        }, AFTERGLOW_MS);
      });
    },
    [markRecentNode, unmarkRecentNode]
  );

  const markEdgeAfterglow = useCallback(
    (edgeId: string) => {
      if (!edgeId) return;
      const prev = recentEdgeTimersRef.current[edgeId];
      if (prev) window.clearTimeout(prev);

      unmarkRecentEdge(edgeId);
      window.requestAnimationFrame(() => {
        markRecentEdge(edgeId);
        recentEdgeTimersRef.current[edgeId] = window.setTimeout(() => {
          unmarkRecentEdge(edgeId);
          delete recentEdgeTimersRef.current[edgeId];
        }, AFTERGLOW_MS);
      });
    },
    [markRecentEdge, unmarkRecentEdge]
  );

  const clearAfterglowTimers = useCallback(() => {
    for (const t of Object.values(recentNodeTimersRef.current)) window.clearTimeout(t);
    for (const t of Object.values(recentEdgeTimersRef.current)) window.clearTimeout(t);
    recentNodeTimersRef.current = {};
    recentEdgeTimersRef.current = {};
  }, []);

  const closeSubrunStreams = useCallback(() => {
    for (const es of subrunStreamsRef.current.values()) {
      try {
        es.close();
      } catch {
        // ignore
      }
    }
    subrunStreamsRef.current.clear();
    subrunCursorRef.current.clear();
  }, []);

  const submitCommand = useCallback(async (payload: { runId: string; type: string; payload?: Record<string, unknown> }) => {
    const commandId =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `cmd_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
    const res = await fetch('/api/gateway/commands', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        command_id: commandId,
        run_id: payload.runId,
        type: payload.type,
        payload: payload.payload || {},
      }),
    });
    if (!res.ok) {
      const msg = await res.text();
      throw new Error(msg || `Command failed (HTTP ${res.status})`);
    }
  }, []);

  const autoApproveWait = useCallback(
    async (info: WaitingInfo) => {
      const rid = info.runId || runIdRef.current;
      const waitKey = info.waitKey;
      if (!rid || !waitKey) return;
      if (autoApprovedWaitKeysRef.current.has(waitKey)) return;
      autoApprovedWaitKeysRef.current.add(waitKey);
      try {
        await submitCommand({
          runId: rid,
          type: 'resume',
          payload: { wait_key: waitKey, payload: { approved: true, auto_approved: true } },
        });
      } catch (e) {
        autoApprovedWaitKeysRef.current.delete(waitKey);
        setIsWaiting(true);
        setWaitingInfo(info);
        setError(e instanceof Error ? e.message : 'Auto-approve failed');
      }
    },
    [submitCommand]
  );

  const handleEvent = useCallback(
    (event: ExecutionEvent) => {
      switch (event.type) {
        case 'flow_start':
          setIsRunning(true);
          setIsWaiting(false);
          setIsPaused(false);
          setWaitingInfo(null);
          autoApprovedWaitKeysRef.current.clear();
          runIdRef.current = event.runId || null;
          setRunId(runIdRef.current);
          rootRunIdRef.current = event.runId || null;
          if (event.runId) runRootByRunIdRef.current.set(event.runId, event.runId);
          lastRootNodeIdRef.current = null;
          clearAfterglowTimers();
          resetExecutionDecorations();
          break;
        case 'node_start':
          if (event.runId && runIdRef.current && event.runId !== runIdRef.current) break;
          if (!runIdRef.current) break;
          if (!event.nodeId || !nodeIdSet.has(event.nodeId)) break;

          if (isWaiting || isPaused) {
            setIsWaiting(false);
            setIsPaused(false);
            setWaitingInfo(null);
            waitingRef.current = false;
            pausedRef.current = false;
            waitingInfoRef.current = null;
          }

          const prev = lastRootNodeIdRef.current;
          if (prev && prev !== event.nodeId) {
            for (const e of edges) {
              const isExecEdge =
                e.sourceHandle === 'exec-out' ||
                e.targetHandle === 'exec-in' ||
                Boolean(e.animated);
              if (!isExecEdge) continue;
              if (e.source === prev && e.target === event.nodeId) markEdgeAfterglow(e.id);
            }
          }

          lastRootNodeIdRef.current = event.nodeId;
          setExecutingNodeId(event.nodeId);
          break;
        case 'node_complete':
          if (event.runId && runIdRef.current && event.runId !== runIdRef.current) break;
          if (!runIdRef.current) break;
          if (event.nodeId && nodeIdSet.has(event.nodeId)) {
            markNodeAfterglow(event.nodeId);

            const n = nodeById.get(event.nodeId);
            const nodeType = n?.data?.nodeType;
            if ((nodeType === 'loop' || nodeType === 'for') && event.result && typeof event.result === 'object') {
              const r = event.result as Record<string, unknown>;
              const idxRaw = r.index;
              const totalRaw = r.total;
              const idx = typeof idxRaw === 'number' ? idxRaw : typeof idxRaw === 'string' ? Number(idxRaw) : NaN;
              const total = typeof totalRaw === 'number' ? totalRaw : typeof totalRaw === 'string' ? Number(totalRaw) : NaN;
              if (Number.isFinite(idx) && Number.isFinite(total) && total > 0) {
                setLoopProgress(event.nodeId, Math.max(0, Math.floor(idx)), Math.max(1, Math.floor(total)));
              }
            }
          }
          break;
        case 'flow_waiting': {
          const reason = typeof event.reason === 'string' ? event.reason : '';
          const isSubworkflowWait = reason.toLowerCase() === 'subworkflow';
          // Subworkflow waits are non-interactive; keep UI in running mode.
          if (isSubworkflowWait) {
            const currentWait = waitingInfoRef.current;
            // Do not override an active tool-approval wait from a child run.
            if (isToolApprovalWait(currentWait)) {
              setIsWaiting(true);
              setIsPaused(false);
              waitingRef.current = true;
              pausedRef.current = false;
              break;
            }
            setIsWaiting(false);
            setWaitingInfo(null);
            setIsPaused(false);
            waitingRef.current = false;
            pausedRef.current = false;
            waitingInfoRef.current = null;
            break;
          }
          setIsWaiting(true);
          setIsPaused(false);
          waitingRef.current = true;
          pausedRef.current = false;
          const info: WaitingInfo = {
            prompt: event.prompt || 'Please respond:',
            choices: event.choices || [],
            allowFreeText: event.allow_free_text !== false,
            nodeId: event.nodeId || null,
            waitKey: event.wait_key,
            runId: event.runId || undefined,
            reason: reason || undefined,
            details: event.details && typeof event.details === 'object' ? (event.details as Record<string, unknown>) : undefined,
          };
          const sid = stableSessionIdRef.current;
          const rootId = info.runId ? runRootByRunIdRef.current.get(info.runId) : null;
          const autoEnabled =
            (typeof sid === 'string' && sid.trim() && autoApproveSessionsRef.current.has(sid.trim())) ||
            (typeof rootId === 'string' && rootId.trim() && autoApproveRunRootsRef.current.has(rootId.trim()));
          if (autoEnabled && isToolApprovalWait(info)) {
            setIsWaiting(false);
            setWaitingInfo(null);
            waitingRef.current = false;
            waitingInfoRef.current = null;
            void autoApproveWait(info);
            break;
          }
          waitingInfoRef.current = info;
          setWaitingInfo(info);
          onWaiting?.(info);
          break;
        }
        case 'flow_paused':
          setIsPaused(true);
          setIsWaiting(false);
          setWaitingInfo(null);
          setIsRunning(true);
          setRunId(event.runId || runId || null);
          pausedRef.current = true;
          waitingRef.current = false;
          waitingInfoRef.current = null;
          break;
        case 'flow_resumed':
          setIsPaused(false);
          setIsWaiting(false);
          setWaitingInfo(null);
          setIsRunning(true);
          setRunId(event.runId || runId || null);
          pausedRef.current = false;
          waitingRef.current = false;
          waitingInfoRef.current = null;
          break;
        case 'flow_cancelled':
          setIsRunning(false);
          setIsPaused(false);
          setIsWaiting(false);
          setWaitingInfo(null);
          setExecutingNodeId(null);
          lastRootNodeIdRef.current = null;
          autoApprovedWaitKeysRef.current.clear();
          runIdRef.current = null;
          pausedRef.current = false;
          waitingRef.current = false;
          waitingInfoRef.current = null;
          break;
        case 'flow_complete':
        case 'flow_error':
          setIsRunning(false);
          setIsWaiting(false);
          setIsPaused(false);
          setWaitingInfo(null);
          setExecutingNodeId(null);
          lastRootNodeIdRef.current = null;
          autoApprovedWaitKeysRef.current.clear();
          runIdRef.current = null;
          pausedRef.current = false;
          waitingRef.current = false;
          waitingInfoRef.current = null;
          break;
        default:
          break;
      }
    },
    [
      clearAfterglowTimers,
      edges,
      isPaused,
      isWaiting,
      markEdgeAfterglow,
      markNodeAfterglow,
      nodeById,
      nodeIdSet,
      isToolApprovalWait,
      autoApproveWait,
      onWaiting,
      resetExecutionDecorations,
      runId,
      setExecutingNodeId,
      setIsRunning,
      setLoopProgress,
    ]
  );

  const dispatchEvent = useCallback(
    (event: ExecutionEvent) => {
      handleEvent(event);
      onEvent?.(event);
    },
    [handleEvent, onEvent]
  );

  const handleLedgerEvents = useCallback(
    (events: ExecutionEvent[]) => {
      for (const ev of events) {
        if (ev.runId) {
          const existingRoot = runRootByRunIdRef.current.get(ev.runId);
          const nextRoot = existingRoot || rootRunIdRef.current || ev.runId;
          runRootByRunIdRef.current.set(ev.runId, nextRoot);
        }
        if (
          ev.type === 'node_start' &&
          ev.runId &&
          runIdRef.current &&
          ev.runId === runIdRef.current &&
          (pausedRef.current || waitingRef.current)
        ) {
          dispatchEvent({ type: 'flow_resumed', runId: ev.runId });
          pausedRef.current = false;
          waitingRef.current = false;
        }
        if (ev.type === 'subworkflow_update') {
          const subRunId = typeof ev.sub_run_id === 'string' ? ev.sub_run_id.trim() : '';
          if (subRunId) {
            const parentRoot =
              (ev.runId && runRootByRunIdRef.current.get(ev.runId)) || rootRunIdRef.current || ev.runId || '';
            if (parentRoot) runRootByRunIdRef.current.set(subRunId, parentRoot);
            ensureSubrunStreamRef.current(subRunId);
          }
        }
        dispatchEvent(ev);
      }
    },
    [dispatchEvent]
  );

  const emitLedgerRecord = useCallback(
    (record: LedgerRecord) => {
      const events = mapLedgerRecordToEvents(record, mappingStateRef.current);
      if (events.length > 0) handleLedgerEvents(events);
    },
    [handleLedgerEvents]
  );

  const ensureSubrunStream = useCallback(
    (ridRaw: string) => {
      const rid = typeof ridRaw === 'string' ? ridRaw.trim() : '';
      if (!rid) return;
      if (rid === runIdRef.current) return;
      if (subrunStreamsRef.current.has(rid)) return;

      const after = Math.max(0, Number(subrunCursorRef.current.get(rid) || 0));
      const url = `/api/gateway/runs/${encodeURIComponent(rid)}/ledger/stream?after=${after}`;
      const es = new EventSource(url);
      subrunStreamsRef.current.set(rid, es);

      es.onopen = () => {
        if (subrunStreamsRef.current.get(rid) !== es) return;
      };

      es.onerror = () => {
        if (subrunStreamsRef.current.get(rid) !== es) return;
      };

      es.addEventListener('step', (evt) => {
        if (subrunStreamsRef.current.get(rid) !== es) return;
        try {
          const payload = JSON.parse((evt as MessageEvent).data || '{}') as { cursor?: number; record?: LedgerRecord };
          if (typeof payload.cursor === 'number') subrunCursorRef.current.set(rid, payload.cursor);
          const record = payload.record;
          if (!record) return;
          emitLedgerRecord(record);
        } catch (e) {
          console.error('Failed to parse subrun ledger stream event:', e);
        }
      });

      es.addEventListener('done', () => {
        if (subrunStreamsRef.current.get(rid) !== es) return;
        es.close();
        subrunStreamsRef.current.delete(rid);
      });
    },
    [emitLedgerRecord]
  );

  useEffect(() => {
    ensureSubrunStreamRef.current = ensureSubrunStream;
  }, [ensureSubrunStream]);

  const fetchRunSummary = useCallback(async (rid: string) => {
    const res = await fetch(`/api/gateway/runs/${encodeURIComponent(rid)}`);
    if (!res.ok) {
      const msg = await res.text();
      throw new Error(msg || `Failed to load run (HTTP ${res.status})`);
    }
    return res.json() as Promise<Record<string, unknown>>;
  }, []);

  const applyRunSummary = useCallback(
    (summary: Record<string, unknown>) => {
      const rid = typeof summary.run_id === 'string' ? summary.run_id : '';
      if (!rid) return;

      const status = typeof summary.status === 'string' ? summary.status.toLowerCase() : '';
      const updatedAt = typeof summary.updated_at === 'string' ? summary.updated_at : undefined;

      const terminalKey = `${rid}:${status}`;
      if (terminalEmittedRef.current.get(rid) === terminalKey) return;

      if (status === 'completed') {
        const closeEvents = closeOpenNodes({ runId: rid, state: mappingStateRef.current, ts: updatedAt });
        closeEvents.forEach(dispatchEvent);
        terminalEmittedRef.current.set(rid, terminalKey);
        dispatchEvent({ type: 'flow_complete', runId: rid, ts: updatedAt });
        return;
      }
      if (status === 'failed') {
        const closeEvents = closeOpenNodes({ runId: rid, state: mappingStateRef.current, ts: updatedAt });
        closeEvents.forEach(dispatchEvent);
        terminalEmittedRef.current.set(rid, terminalKey);
        const err = typeof summary.error === 'string' ? summary.error : 'Run failed';
        dispatchEvent({ type: 'flow_error', runId: rid, ts: updatedAt, error: err });
        return;
      }
      if (status === 'cancelled') {
        const closeEvents = closeOpenNodes({ runId: rid, state: mappingStateRef.current, ts: updatedAt });
        closeEvents.forEach(dispatchEvent);
        terminalEmittedRef.current.set(rid, terminalKey);
        dispatchEvent({ type: 'flow_cancelled', runId: rid, ts: updatedAt });
        return;
      }

      const waiting = summary.waiting && typeof summary.waiting === 'object' ? (summary.waiting as Record<string, unknown>) : null;
      if (status === 'waiting' && waiting) {
        const waitKey = typeof waiting.wait_key === 'string' ? waiting.wait_key : '';
        const details = waiting.details && typeof waiting.details === 'object' ? (waiting.details as Record<string, unknown>) : null;
        const isPause = waitKey.startsWith('pause:') || details?.kind === 'pause';
        const subRunId = typeof details?.sub_run_id === 'string' ? String(details?.sub_run_id).trim() : '';
        if (subRunId) ensureSubrunStreamRef.current(subRunId);
        if (isPause) {
          dispatchEvent({ type: 'flow_paused', runId: rid, ts: updatedAt });
        } else {
          dispatchEvent({
            type: 'flow_waiting',
            runId: rid,
            ts: updatedAt,
            prompt: typeof waiting.prompt === 'string' ? waiting.prompt : undefined,
            choices: Array.isArray(waiting.choices) ? (waiting.choices as string[]) : undefined,
            allow_free_text: waiting.allow_free_text !== false,
            wait_key: waitKey || undefined,
            reason: typeof waiting.reason === 'string' ? waiting.reason : undefined,
          });
        }
      }
    },
    [dispatchEvent]
  );

  const disconnect = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.close();
      streamRef.current = null;
    }
    closeSubrunStreams();
    setConnected(false);
  }, [closeSubrunStreams]);

  const connectStream = useCallback(
    (rid: string) => {
      if (!rid) return;
      disconnect();
      const after = Math.max(0, Number(streamCursorRef.current || 0));
      const url = `/api/gateway/runs/${encodeURIComponent(rid)}/ledger/stream?after=${after}`;
      const es = new EventSource(url);
      streamRef.current = es;

      es.onopen = () => {
        if (streamRef.current !== es) return;
        setConnected(true);
        setError(null);
      };

      es.onerror = () => {
        if (streamRef.current !== es) return;
        setConnected(false);
      };

      es.addEventListener('step', (evt) => {
        if (streamRef.current !== es) return;
        try {
          const payload = JSON.parse((evt as MessageEvent).data || '{}') as { cursor?: number; record?: LedgerRecord };
          if (typeof payload.cursor === 'number') streamCursorRef.current = payload.cursor;
          const record = payload.record;
          if (!record) return;
          emitLedgerRecord(record);
        } catch (e) {
          console.error('Failed to parse ledger stream event:', e);
        }
      });

      es.addEventListener('done', async () => {
        if (streamRef.current !== es) return;
        try {
          const summary = await fetchRunSummary(rid);
          applyRunSummary(summary);
        } catch (e) {
          setError(e instanceof Error ? e.message : 'Failed to finalize run');
        } finally {
          es.close();
          setConnected(false);
        }
      });
    },
    [applyRunSummary, disconnect, emitLedgerRecord, fetchRunSummary]
  );

  const runFlow = useCallback(
    async (inputData: Record<string, unknown> = {}) => {
      if (!flowId) {
        setError('flow_id is required');
        return;
      }

      const mergedInputData: Record<string, unknown> = { ...(inputData || {}) };
      const explicitSessionId =
        typeof mergedInputData.sessionId === 'string' && mergedInputData.sessionId.trim().length > 0
          ? mergedInputData.sessionId.trim()
          : typeof mergedInputData.session_id === 'string' && mergedInputData.session_id.trim().length > 0
            ? mergedInputData.session_id.trim()
            : '';

      if (explicitSessionId) {
        persistStableSessionId(explicitSessionId);
        mergedInputData.sessionId = explicitSessionId;
      } else if (!stableSessionIdRef.current) {
        const next = getOrCreateStableSessionId();
        if (next) persistStableSessionId(next);
      }

      const effectiveSessionId = explicitSessionId || stableSessionIdRef.current || '';
      if (effectiveSessionId && !explicitSessionId) {
        mergedInputData.sessionId = effectiveSessionId;
      }

      try {
        setError(null);
        const publishRes = await fetch(`/api/gateway/visualflows/${encodeURIComponent(flowId)}/publish`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bundle_version: 'dev', overwrite: true, reload_gateway: true }),
        });
        if (!publishRes.ok) {
          const msg = await publishRes.text();
          throw new Error(msg || `Publish failed (HTTP ${publishRes.status})`);
        }
        const publishPayload = (await publishRes.json()) as { bundle_id: string; bundle_version: string };

        const startRes = await fetch('/api/gateway/runs/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            bundle_id: publishPayload.bundle_id,
            bundle_version: publishPayload.bundle_version,
            flow_id: flowId,
            input_data: mergedInputData,
            session_id: effectiveSessionId || undefined,
          }),
        });
        if (!startRes.ok) {
          const msg = await startRes.text();
          throw new Error(msg || `Failed to start run (HTTP ${startRes.status})`);
        }
        const startPayload = (await startRes.json()) as { run_id?: string };
        const rid = typeof startPayload.run_id === 'string' ? startPayload.run_id : '';
        if (!rid) throw new Error('Gateway did not return run_id');

        mappingStateRef.current = createLedgerMappingState();
        streamCursorRef.current = 0;
        closeSubrunStreams();
        terminalEmittedRef.current.delete(rid);
        runIdRef.current = rid;
        setRunId(rid);
        dispatchEvent({ type: 'flow_start', runId: rid, ts: new Date().toISOString() });
        connectStream(rid);
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Failed to run flow';
        setError(msg);
        dispatchEvent({ type: 'flow_error', error: msg });
      }
    },
    [closeSubrunStreams, connectStream, dispatchEvent, flowId]
  );

  // Reset the session id so the next run starts a fresh context.
  const resetSession = useCallback(() => {
    persistStableSessionId(undefined);
  }, [persistStableSessionId]);

  const resumeFlow = useCallback(
    async (
      response: string | { response?: string; approved?: boolean; reason?: string; runId?: string; waitKey?: string }
    ) => {
      const info = waitingInfoRef.current;
      let rid = info?.runId || runIdRef.current;
      let waitKey = info?.waitKey;
      if (response && typeof response === 'object') {
        if (typeof response.runId === 'string' && response.runId.trim()) rid = response.runId.trim();
        if (typeof response.waitKey === 'string' && response.waitKey.trim()) waitKey = response.waitKey.trim();
      }
      if (!rid || !waitKey || isPaused) return;
      try {
        const payload =
          typeof response === 'string'
            ? { response }
            : response
              ? (({ response, approved, reason }) => ({ response, approved, reason }))(response)
              : {};
        await submitCommand({
          runId: rid,
          type: 'resume',
          payload: { wait_key: waitKey, payload },
        });
        setIsWaiting(false);
        setWaitingInfo(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to resume');
      }
    },
    [isPaused, submitCommand]
  );

  const pauseRun = useCallback(
    async (targetRunId?: string) => {
      const rid = targetRunId || runIdRef.current;
      if (!rid) return;
      try {
        await submitCommand({ runId: rid, type: 'pause' });
        const summary = await fetchRunSummary(rid);
        applyRunSummary(summary);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to pause');
      }
    },
    [applyRunSummary, fetchRunSummary, submitCommand]
  );

  const resumeRun = useCallback(
    async (targetRunId?: string) => {
      const rid = targetRunId || runIdRef.current;
      if (!rid) return;
      try {
        await submitCommand({ runId: rid, type: 'resume' });
        const summary = await fetchRunSummary(rid);
        applyRunSummary(summary);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to resume');
      }
    },
    [applyRunSummary, fetchRunSummary, submitCommand]
  );

  const cancelRun = useCallback(
    async (targetRunId?: string) => {
      const rid = targetRunId || runIdRef.current;
      if (!rid) return;
      try {
        await submitCommand({ runId: rid, type: 'cancel' });
        const summary = await fetchRunSummary(rid);
        applyRunSummary(summary);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to cancel');
      }
    },
    [applyRunSummary, fetchRunSummary, submitCommand]
  );

  const connect = useCallback(() => {
    const rid = runIdRef.current;
    if (!rid) return;
    connectStream(rid);
  }, [connectStream]);

  useEffect(() => {
    return () => {
      clearAfterglowTimers();
      disconnect();
    };
  }, [disconnect, clearAfterglowTimers]);

  return {
    connected,
    error,
    connect,
    disconnect,
    runFlow,
    resumeFlow,
    pauseRun,
    resumeRun,
    cancelRun,
    resetSession,
    setAutoApproveForSession,
    setAutoApproveForRunRoot,
    autoApproveSessions,
    isWaiting,
    isPaused,
    runId,
    stableSessionId,
    waitingInfo,
  };
}
