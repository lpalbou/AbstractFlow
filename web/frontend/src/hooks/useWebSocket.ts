/**
 * WebSocket hook for real-time flow execution updates.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ExecutionEvent } from '../types/flow';
import { useFlowStore } from './useFlow';

function getOrCreateStableSessionId(): string | undefined {
  // Stable per browser tab (sessionStorage), used to back AbstractRuntime `session` scope
  // across multiple flow executions within the same UI session.
  //
  // IMPORTANT: do not use connection_id fallbacks because AbstractFlow creates one WebSocket
  // per flow, so switching flows would create a new session owner partition.
  try {
    const key = 'abstractflow_session_id_v1';
    const existing = window.sessionStorage.getItem(key);
    if (existing && existing.trim()) return existing.trim();

    const next =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `af_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
    window.sessionStorage.setItem(key, next);
    return next;
  } catch {
    return undefined;
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
}

export function useWebSocket({ flowId, onEvent, onWaiting }: UseWebSocketOptions) {
  const wsRef = useRef<WebSocket | null>(null);
  const wsFlowIdRef = useRef<string>(flowId);
  const pingTimerRef = useRef<number | null>(null);
  const stableSessionIdRef = useRef<string | undefined>(undefined);
  const [connected, setConnected] = useState(false);
  const [isWaiting, setIsWaiting] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [waitingInfo, setWaitingInfo] = useState<WaitingInfo | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  // Root run id for the active WS session.
  //
  // IMPORTANT: we keep a ref in addition to React state to avoid a race where
  // child-run node_start events can arrive before the `runId` state update
  // is visible to subsequent event handlers (React state updates are async).
  //
  // Without this, child run node ids like "node-4" can collide with the root
  // graph's node ids and incorrectly highlight the wrong node.
  const runIdRef = useRef<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  // Execution observability afterglow:
  // Keep recently executed nodes/edges highlighted long enough to be readable when flows run fast.
  // UX note: tuned for human scan time when the run modal is minimized.
  const AFTERGLOW_MS = 3000;
  const recentNodeTimersRef = useRef<Record<string, number>>({});
  const recentEdgeTimersRef = useRef<Record<string, number>>({});
  const lastRootNodeIdRef = useRef<string | null>(null);

  const markNodeAfterglow = useCallback(
    (nodeId: string) => {
      if (!nodeId) return;
      const prev = recentNodeTimersRef.current[nodeId];
      if (prev) window.clearTimeout(prev);

      // Ensure the CSS afterglow animation restarts if this node executes again quickly.
      // (CSS keyframes won't restart if the class stays applied.)
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

      // Ensure the CSS afterglow animation restarts if this edge is traversed again quickly.
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

  const isExecutionEvent = (value: unknown): value is ExecutionEvent => {
    if (!value || typeof value !== 'object') return false;
    const obj = value as Record<string, unknown>;
    const t = obj.type;
    if (typeof t !== 'string') return false;
    // Keepalive messages and unknown message types should never affect UI execution state.
    if (t === 'pong') return false;
    return (
      t === 'node_start' ||
      t === 'node_complete' ||
      t === 'flow_start' ||
      t === 'flow_complete' ||
      t === 'flow_error' ||
      t === 'flow_waiting' ||
      t === 'flow_paused' ||
      t === 'flow_resumed' ||
      t === 'flow_cancelled' ||
      t === 'trace_update' ||
      // Emitted while a parent run is waiting for a subworkflow: maps parent node -> child run_id.
      t === 'subworkflow_update'
    );
  };

  // Handle execution events
  const handleEvent = useCallback(
    (event: ExecutionEvent) => {
      switch (event.type) {
        case 'flow_start':
          setIsRunning(true);
          setIsWaiting(false);
          setIsPaused(false);
          setWaitingInfo(null);
          runIdRef.current = event.runId || null;
          setRunId(runIdRef.current);
          lastRootNodeIdRef.current = null;
          clearAfterglowTimers();
          resetExecutionDecorations();
          break;
        case 'node_start':
          // Only highlight nodes for the root visual run. Child/sub-runs (e.g. Agent subworkflow)
          // may emit node_start events with internal node ids that don't exist in the visual graph.
          // NOTE: use `runIdRef` to avoid a race right after flow_start.
          if (event.runId && runIdRef.current && event.runId !== runIdRef.current) break;
          // Defensive: if we somehow receive node events before flow_start, ignore them.
          if (!runIdRef.current) break;
          if (!event.nodeId || !nodeIdSet.has(event.nodeId)) break;

          // Mark the execution edge from the previously executing root node → current node.
          // This gives a “trail” that makes fast flows readable.
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
          // Keep the last executed node highlighted until the next node_start.
          // This makes fast-running flows observable (Blueprint-style).
          if (event.runId && runIdRef.current && event.runId !== runIdRef.current) break;
          if (!runIdRef.current) break;
          if (event.nodeId && nodeIdSet.has(event.nodeId)) {
            markNodeAfterglow(event.nodeId);

            // Loop progress badge (Foreach / For): show (index+1)/total.
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
        case 'flow_waiting':
          // Flow is paused waiting for user input
          setIsWaiting(true);
          setIsPaused(false);
          const info: WaitingInfo = {
            prompt: event.prompt || 'Please respond:',
            choices: event.choices || [],
            allowFreeText: event.allow_free_text !== false,
            nodeId: event.nodeId || null,
          };
          setWaitingInfo(info);
          onWaiting?.(info);
          break;
        case 'flow_paused':
          setIsPaused(true);
          setIsWaiting(false);
          setWaitingInfo(null);
          setIsRunning(true);
          setRunId(event.runId || runId || null);
          break;
        case 'flow_resumed':
          setIsPaused(false);
          setIsRunning(true);
          setRunId(event.runId || runId || null);
          break;
        case 'flow_cancelled':
          setIsRunning(false);
          setIsPaused(false);
          setIsWaiting(false);
          setWaitingInfo(null);
          setExecutingNodeId(null);
          lastRootNodeIdRef.current = null;
          runIdRef.current = null;
          break;
        case 'flow_complete':
        case 'flow_error':
          setIsRunning(false);
          setIsWaiting(false);
          setIsPaused(false);
          setWaitingInfo(null);
          setExecutingNodeId(null);
          lastRootNodeIdRef.current = null;
          runIdRef.current = null;
          break;
      }
    },
    [
      setExecutingNodeId,
      setIsRunning,
      onWaiting,
      nodeIdSet,
      edges,
      markEdgeAfterglow,
      markNodeAfterglow,
      nodeById,
      setLoopProgress,
      clearAfterglowTimers,
      resetExecutionDecorations,
    ]
  );

  // Ensure strict isolation: when switching flows, disconnect the old socket and
  // clear transient execution/waiting state so previous workflows can't leak UI.
  useEffect(() => {
    if (wsFlowIdRef.current !== flowId) {
      if (wsRef.current) {
        wsRef.current.onopen = null;
        wsRef.current.onclose = null;
        wsRef.current.onerror = null;
        wsRef.current.onmessage = null;
        wsRef.current.close();
        wsRef.current = null;
      }
      setConnected(false);
      setError(null);
      setIsWaiting(false);
      setIsPaused(false);
      setWaitingInfo(null);
      setRunId(null);
      runIdRef.current = null;
      setExecutingNodeId(null);
      setIsRunning(false);
      wsFlowIdRef.current = flowId;
    }
  }, [flowId, setExecutingNodeId, setIsRunning]);

  // Connect to WebSocket
  const connect = useCallback(() => {
    if (!flowId) {
      setError('Missing flow id');
      return;
    }

    // If an existing socket is open but tied to a different flow, close it.
    if (wsRef.current && wsFlowIdRef.current !== flowId) {
      wsRef.current.onopen = null;
      wsRef.current.onclose = null;
      wsRef.current.onerror = null;
      wsRef.current.onmessage = null;
      wsRef.current.close();
      wsRef.current = null;
      if (pingTimerRef.current) {
        window.clearInterval(pingTimerRef.current);
        pingTimerRef.current = null;
      }
      setConnected(false);
    }

    // Avoid spawning multiple concurrent sockets for the same flow.
    if (
      wsRef.current?.readyState === WebSocket.OPEN ||
      wsRef.current?.readyState === WebSocket.CONNECTING
    )
      return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/api/ws/${flowId}`;

    try {
      const socket = new WebSocket(wsUrl);
      wsRef.current = socket;
      wsFlowIdRef.current = flowId;

      socket.onopen = () => {
        if (wsRef.current !== socket) return;
        setConnected(true);
        setError(null);

        // Keepalive: some dev proxies (and some networks) will drop idle WS connections.
        // We already ignore `pong` events in UI state, so this is purely transport health.
        if (pingTimerRef.current) window.clearInterval(pingTimerRef.current);
        pingTimerRef.current = window.setInterval(() => {
          try {
            if (wsRef.current?.readyState === WebSocket.OPEN) {
              wsRef.current.send(JSON.stringify({ type: 'ping' }));
            }
          } catch {
            // ignore
          }
        }, 15000);
      };

      socket.onclose = () => {
        if (wsRef.current !== socket) return;
        setConnected(false);
        if (pingTimerRef.current) {
          window.clearInterval(pingTimerRef.current);
          pingTimerRef.current = null;
        }
      };

      socket.onerror = () => {
        if (wsRef.current !== socket) return;
        setError('WebSocket connection failed');
        setConnected(false);
      };

      socket.onmessage = (event) => {
        if (wsRef.current !== socket) return;
        try {
          const raw: unknown = JSON.parse(event.data);
          if (!isExecutionEvent(raw)) return;
          const data: ExecutionEvent = raw;
          handleEvent(data);
          onEvent?.(data);
        } catch (e) {
          console.error('Failed to parse WebSocket message:', e);
        }
      };
    } catch (e) {
      setError('Failed to create WebSocket connection');
    }
  }, [flowId, handleEvent, onEvent]);

  // Disconnect from WebSocket
  const disconnect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.onopen = null;
      wsRef.current.onclose = null;
      wsRef.current.onerror = null;
      wsRef.current.onmessage = null;
      wsRef.current.close();
      wsRef.current = null;
    }
    if (pingTimerRef.current) {
      window.clearInterval(pingTimerRef.current);
      pingTimerRef.current = null;
    }
    setConnected(false);
  }, []);

  // Send a message
  const send = useCallback((message: object) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    }
  }, []);

  // Best-effort send that reconnects if needed (used by run controls).
  // This makes Pause/Cancel resilient to transient WS disconnects.
  const sendWithReconnect = useCallback(
    (message: object) => {
      const maxTries = 50; // ~5s with 100ms backoff
      const delayMs = 100;

      const trySend = (triesLeft: number) => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          send(message);
          return;
        }
        if (triesLeft <= 0) {
          setError('WebSocket is not connected (failed to send control message)');
          return;
        }
        connect();
        setTimeout(() => trySend(triesLeft - 1), delayMs);
      };

      trySend(maxTries);
    },
    [connect, send]
  );

  // Run the flow via WebSocket
  const runFlow = useCallback(
    (inputData: Record<string, unknown> = {}) => {
      connect();

      // Ensure `session` scope is stable across flows in the same UI session.
      // (AbstractFlow uses one WS per flow, so connection_id is not stable.)
      if (stableSessionIdRef.current === undefined) stableSessionIdRef.current = getOrCreateStableSessionId();
      const stableSessionId = stableSessionIdRef.current;

      const mergedInputData: Record<string, unknown> = { ...(inputData || {}) };
      const hasExplicitSessionId =
        typeof mergedInputData.sessionId === 'string' && mergedInputData.sessionId.trim().length > 0;
      const hasExplicitSessionIdSnake =
        typeof mergedInputData.session_id === 'string' && mergedInputData.session_id.trim().length > 0;
      if (stableSessionId && !hasExplicitSessionId && !hasExplicitSessionIdSnake) mergedInputData.sessionId = stableSessionId;

      // Wait for connection then send run command
      const checkAndSend = () => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          send({ type: 'run', input_data: mergedInputData });
        } else {
          setTimeout(checkAndSend, 100);
        }
      };
      checkAndSend();
    },
    [connect, send]
  );

  // Resume a waiting flow with user response
  const resumeFlow = useCallback(
    (response: string) => {
      if (wsRef.current?.readyState === WebSocket.OPEN && isWaiting && !isPaused) {
        send({ type: 'resume', response });
        setIsWaiting(false);
        setWaitingInfo(null);
      }
    },
    [send, isWaiting, isPaused]
  );

  const pauseRun = useCallback(
    (targetRunId?: string) => {
      const rid = targetRunId || runId;
      if (!rid) return;
      sendWithReconnect({ type: 'control', action: 'pause', run_id: rid });
    },
    [sendWithReconnect, runId]
  );

  const resumeRun = useCallback(
    (targetRunId?: string) => {
      const rid = targetRunId || runId;
      if (!rid) return;
      sendWithReconnect({ type: 'control', action: 'resume', run_id: rid });
    },
    [sendWithReconnect, runId]
  );

  const cancelRun = useCallback(
    (targetRunId?: string) => {
      const rid = targetRunId || runId;
      if (!rid) return;
      sendWithReconnect({ type: 'control', action: 'cancel', run_id: rid });
    },
    [sendWithReconnect, runId]
  );

  // Cleanup on unmount
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
    send,
    runFlow,
    resumeFlow,
    pauseRun,
    resumeRun,
    cancelRun,
    isWaiting,
    isPaused,
    runId,
    waitingInfo,
  };
}
