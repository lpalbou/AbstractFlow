/**
 * WebSocket hook for real-time flow execution updates.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ExecutionEvent } from '../types/flow';
import { useFlowStore } from './useFlow';

interface UseWebSocketOptions {
  flowId: string;
  onEvent?: (event: ExecutionEvent) => void;
}

export function useWebSocket({ flowId, onEvent }: UseWebSocketOptions) {
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { setExecutingNodeId, setIsRunning } = useFlowStore();

  // Connect to WebSocket
  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/api/ws/${flowId}`;

    try {
      wsRef.current = new WebSocket(wsUrl);

      wsRef.current.onopen = () => {
        setConnected(true);
        setError(null);
      };

      wsRef.current.onclose = () => {
        setConnected(false);
      };

      wsRef.current.onerror = () => {
        setError('WebSocket connection failed');
        setConnected(false);
      };

      wsRef.current.onmessage = (event) => {
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
  }, [flowId, onEvent]);

  // Handle execution events
  const handleEvent = useCallback(
    (event: ExecutionEvent) => {
      switch (event.type) {
        case 'flow_start':
          setIsRunning(true);
          break;
        case 'node_start':
          setExecutingNodeId(event.nodeId || null);
          break;
        case 'node_complete':
          setExecutingNodeId(null);
          break;
        case 'flow_complete':
        case 'flow_error':
          setIsRunning(false);
          setExecutingNodeId(null);
          break;
      }
    },
    [setExecutingNodeId, setIsRunning]
  );

  // Disconnect from WebSocket
  const disconnect = useCallback(() => {
    if (wsRef.current) {
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
  };
}
