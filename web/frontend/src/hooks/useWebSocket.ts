/**
 * WebSocket hook for real-time flow execution updates.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ExecutionEvent } from '../types/flow';
import { useFlowStore } from './useFlow';

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
  const [connected, setConnected] = useState(false);
  const [isWaiting, setIsWaiting] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [waitingInfo, setWaitingInfo] = useState<WaitingInfo | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { setExecutingNodeId, setIsRunning } = useFlowStore();

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
      t === 'trace_update'
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
          setRunId(event.runId || null);
          break;
        case 'node_start':
          // Only highlight nodes for the root visual run. Child/sub-runs (e.g. Agent subworkflow)
          // may emit node_start events with internal node ids that don't exist in the visual graph.
          if (event.runId && runId && event.runId !== runId) break;
          setExecutingNodeId(event.nodeId || null);
          break;
        case 'node_complete':
          // Keep the last executed node highlighted until the next node_start.
          // This makes fast-running flows observable (Blueprint-style).
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
          break;
        case 'flow_complete':
        case 'flow_error':
          setIsRunning(false);
          setIsWaiting(false);
          setIsPaused(false);
          setWaitingInfo(null);
          setExecutingNodeId(null);
          break;
      }
    },
    [setExecutingNodeId, setIsRunning, onWaiting, runId]
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
      };

      socket.onclose = () => {
        if (wsRef.current !== socket) return;
        setConnected(false);
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
      // Wait for connection then send run command
      const checkAndSend = () => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          send({ type: 'run', input_data: inputData });
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

  const pauseRun = useCallback(() => {
    if (!runId) return;
    sendWithReconnect({ type: 'control', action: 'pause', run_id: runId });
  }, [sendWithReconnect, runId]);

  const resumeRun = useCallback(() => {
    if (!runId) return;
    sendWithReconnect({ type: 'control', action: 'resume', run_id: runId });
  }, [sendWithReconnect, runId]);

  const cancelRun = useCallback(() => {
    if (!runId) return;
    sendWithReconnect({ type: 'control', action: 'cancel', run_id: runId });
  }, [sendWithReconnect, runId]);

  // Keepalive ping to reduce idle WS disconnects during long-running nodes (LLM/Agent).
  useEffect(() => {
    if (!connected) return;
    const interval = setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        send({ type: 'ping' });
      }
    }, 20_000);
    return () => clearInterval(interval);
  }, [connected, send]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

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
