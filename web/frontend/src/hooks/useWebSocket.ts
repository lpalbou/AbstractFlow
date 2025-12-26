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

    if (wsRef.current?.readyState === WebSocket.OPEN) return;

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
          const data: ExecutionEvent = JSON.parse(event.data);
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
    if (wsRef.current?.readyState === WebSocket.OPEN && runId) {
      send({ type: 'control', action: 'pause', run_id: runId });
    }
  }, [send, runId]);

  const resumeRun = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN && runId) {
      send({ type: 'control', action: 'resume', run_id: runId });
    }
  }, [send, runId]);

  const cancelRun = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN && runId) {
      send({ type: 'control', action: 'cancel', run_id: runId });
    }
  }, [send, runId]);

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
