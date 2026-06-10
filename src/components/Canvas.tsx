/**
 * Main canvas component with React Flow.
 */

import { useCallback, useEffect, useMemo, useRef, useState, DragEvent, MouseEvent, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import ReactFlow, {
  Controls,
  Background,
  MiniMap,
  Connection,
  ReactFlowInstance,
  ReactFlowProvider,
  BackgroundVariant,
  Node,
  Edge,
  ConnectionMode,
  BaseEdge,
  EdgeProps,
  useStore,
  useStoreApi,
} from 'reactflow';
import toast from 'react-hot-toast';
import { nodeTypes } from './nodes';
import { useFlowStore } from '../hooks/useFlow';
import { getConnectionError, validateConnection } from '../utils/validation';
import { isRouteOverrideEdge } from '../utils/multiEntryRoutes';
import { NodeTemplate } from '../types/nodes';
import type { FlowNodeData, PinConnectionFeedback, PinType } from '../types/flow';
import { PIN_COLORS } from '../types/flow';
import { PinLegend } from './PinLegend';
import { RunPreflightPanel } from './RunPreflightPanel';
import {
  buildConnectionPreviewForNode,
  connectionHintText,
  type ConnectionDragEndpoint,
} from '../utils/connectionPreview';

import { roundedPolylinePath, routeOrthogonal, type RouteRect } from '../utils/edgeRouting';

function WorkflowEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  markerEnd,
  style,
  data,
}: EdgeProps) {
  const routeData = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
  const routeKind = String(routeData.routeKind || 'data');
  const routeRects = Array.isArray(routeData.routeRects) ? (routeData.routeRects as RouteRect[]) : [];
  const sourceRect = routeData.sourceRect && typeof routeData.sourceRect === 'object' ? (routeData.sourceRect as RouteRect) : null;
  const targetRect = routeData.targetRect && typeof routeData.targetRect === 'object' ? (routeData.targetRect as RouteRect) : null;
  const isControl = routeKind === 'exec';
  const sourceRight = sourceRect ? sourceRect.x + sourceRect.width : sourceX;
  const targetLeft = targetRect ? targetRect.x : targetX;
  const isSelfEdge = Boolean(sourceRect && targetRect && sourceRect.x === targetRect.x && sourceRect.y === targetRect.y);
  const isBackEdge = isSelfEdge || sourceRight > targetLeft + 24;
  const verticalDelta = Math.abs(targetY - sourceY);
  const corridorMinX = Math.min(sourceX, targetX) + 8;
  const corridorMaxX = Math.max(sourceX, targetX) - 8;
  const corridorMinY = Math.min(sourceY, targetY) - (isControl ? 18 : 28);
  const corridorMaxY = Math.max(sourceY, targetY) + (isControl ? 18 : 28);
  const routeHasObstacle =
    corridorMaxX > corridorMinX &&
    routeRects.some((rect) => {
      const overlapsX = rect.x < corridorMaxX && rect.x + rect.width > corridorMinX;
      const overlapsY = rect.y < corridorMaxY && rect.y + rect.height > corridorMinY;
      return overlapsX && overlapsY;
    });
  const forwardGap = targetLeft - sourceRight;
  const isForwardNodeEdge = !isSelfEdge && forwardGap >= -24;
  const shouldUseOuterLane = !isForwardNodeEdge && (isBackEdge || routeHasObstacle);

  let path = '';
  if (isControl && isForwardNodeEdge) {
    const dx = targetX - sourceX;
    const compactStub = Math.max(14, Math.min(44, Math.max(0, dx) * 0.35));
    const midX = Math.min(targetX - 18, Math.max(sourceX + compactStub, sourceX + dx * 0.5));
    const candidate =
      verticalDelta <= 12
        ? [
            { x: sourceX, y: sourceY },
            { x: targetX, y: targetY },
          ]
        : dx > 36
          ? [
              { x: sourceX, y: sourceY },
              { x: midX, y: sourceY },
              { x: midX, y: targetY },
              { x: targetX, y: targetY },
            ]
          : [
              { x: sourceX, y: sourceY },
              { x: sourceX + 42, y: sourceY },
              { x: sourceX + 42, y: targetY },
              { x: targetX, y: targetY },
            ];
    path = verticalDelta <= 12 ? `M ${sourceX},${sourceY} L ${targetX},${targetY}` : roundedPolylinePath(candidate, 10);
  }

  if (!path && shouldUseOuterLane) {
    // Obstacle-avoiding orthogonal route. The source/target nodes are passed
    // separately so the router can project pin stubs past their boundaries
    // (pin handles are anchored inset inside the node body) while still
    // treating both nodes as obstacles for the rest of the route.
    const nodeBottom = Math.max(
      sourceRect ? sourceRect.y + sourceRect.height : sourceY,
      targetRect ? targetRect.y + targetRect.height : targetY
    );
    const routed = routeOrthogonal({
      source: { x: sourceX, y: sourceY },
      target: { x: targetX, y: targetY },
      obstacles: routeRects,
      sourceRect,
      targetRect,
      padding: isControl ? 22 : 26,
      bendPenalty: 56,
      // Exec loop-backs conventionally route above the node row (see backlog
      // 0076); data edges simply take the shortest clear route.
      penalizeBelowY: isControl && isBackEdge ? nodeBottom : undefined,
    });
    if (routed) path = roundedPolylinePath(routed, isControl ? 16 : 18);
  }
  if (!path && isControl && !isForwardNodeEdge) {
    const dx = targetX - sourceX;
    const direction = dx >= 0 ? 1 : -1;
    const sourceStub = sourceX + direction * 36;
    const targetStub = targetX - direction * 36;
    const midY = sourceY + (targetY - sourceY) * 0.5;
    const candidate =
      verticalDelta <= 12
        ? [
            { x: sourceX, y: sourceY },
            { x: targetX, y: targetY },
          ]
        : [
            { x: sourceX, y: sourceY },
            { x: sourceStub, y: sourceY },
            { x: sourceStub, y: midY },
            { x: targetStub, y: midY },
            { x: targetStub, y: targetY },
            { x: targetX, y: targetY },
          ];
    path = verticalDelta <= 12 ? `M ${sourceX},${sourceY} L ${targetX},${targetY}` : roundedPolylinePath(candidate, 12);
  } else if (!path) {
    const dx = targetX - sourceX;
    const control = Math.max(72, Math.min(260, Math.abs(dx) * 0.45));
    const c1x = sourceX + (dx >= 0 ? control : -control);
    const c2x = targetX - (dx >= 0 ? control : -control);
    path = `M ${sourceX},${sourceY} C ${c1x},${sourceY} ${c2x},${targetY} ${targetX},${targetY}`;
  }

  return (
    <>
      <path className="react-flow__edge-underlay" d={path} />
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} interactionWidth={24} />
    </>
  );
}

const edgeTypes = {
  workflow: WorkflowEdge,
};

type ReactFlowConnectingHandle = {
  nodeId: string;
  type: 'source' | 'target';
  handleId?: string | null;
};

type ResetCanvasInteractionOptions = {
  forceConnectionCancel?: boolean;
};

function connectionFromDragEndpoint(active: ConnectionDragEndpoint, end: ReactFlowConnectingHandle | null): Connection | null {
  if (!end || !end.handleId) return null;
  if (active.handleType === 'source' && end.type === 'target') {
    return {
      source: active.nodeId,
      sourceHandle: active.handleId,
      target: end.nodeId,
      targetHandle: end.handleId,
    };
  }
  if (active.handleType === 'target' && end.type === 'source') {
    return {
      source: end.nodeId,
      sourceHandle: end.handleId,
      target: active.nodeId,
      targetHandle: active.handleId,
    };
  }
  return null;
}

function hoveredConnectionFeedback(
  nodes: Node<FlowNodeData>[],
  edges: Edge[],
  active: ConnectionDragEndpoint | null,
  end: ReactFlowConnectingHandle | null
): PinConnectionFeedback | null {
  if (!active) return null;
  const connection = connectionFromDragEndpoint(active, end);
  if (!connection) return null;
  const valid = validateConnection(nodes, edges, connection);
  return valid
    ? { status: 'valid', message: 'Compatible target' }
    : { status: 'invalid', message: getConnectionError(nodes, edges, connection) || 'Invalid connection' };
}

function ConnectionFeedbackOverlay({
  activeConnection,
  nodes,
  edges,
  wrapperRef,
}: {
  activeConnection: ConnectionDragEndpoint | null;
  nodes: Node<FlowNodeData>[];
  edges: Edge[];
  wrapperRef: RefObject<HTMLDivElement>;
}) {
  const { connectionEndHandle, connectionPosition } = useStore((state) => ({
    connectionEndHandle: state.connectionEndHandle as ReactFlowConnectingHandle | null,
    connectionPosition: state.connectionPosition,
  }));
  const hovered = useMemo(
    () => hoveredConnectionFeedback(nodes, edges, activeConnection, connectionEndHandle),
    [activeConnection, connectionEndHandle, nodes, edges]
  );
  const hint = connectionHintText(activeConnection, hovered);
  if (!activeConnection || !hint) return null;

  const bounds = wrapperRef.current?.getBoundingClientRect();
  const maxX = Math.max(12, (bounds?.width ?? 320) - 280);
  const maxY = Math.max(12, (bounds?.height ?? 120) - 56);

  return (
    <div
      className={`connection-feedback-hint ${hovered?.status || 'idle'}`}
      style={{
        left: Math.max(12, Math.min(maxX, connectionPosition.x + 14)),
        top: Math.max(12, Math.min(maxY, connectionPosition.y + 16)),
      }}
    >
      {hint}
    </div>
  );
}

function CanvasBody() {
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const reactFlowInstance = useRef<ReactFlowInstance | null>(null);
  const reactFlowStore = useStoreApi();
  const activeCanvasPointerIds = useRef<Set<number>>(new Set());
  const [previewCollapsed, setPreviewCollapsed] = useState(false);
  const [activeConnection, setActiveConnection] = useState<ConnectionDragEndpoint | null>(null);

  // React Flow uses a multiplicative zoom factor of 1.2 per zoom step.
  // We define our own "zoom positions" relative to max zoom:
  // - Default: 2 zoom-out steps from max
  // - Min: 13 zoom-out steps from max
  const ZOOM_STEP = 1.2;
  const MAX_ZOOM = 2;
  const DEFAULT_ZOOM_OUT_STEPS = 2;
  const MIN_ZOOM_OUT_STEPS = 13;

  const DEFAULT_ZOOM = MAX_ZOOM / (ZOOM_STEP ** DEFAULT_ZOOM_OUT_STEPS);
  const MIN_ZOOM = MAX_ZOOM / (ZOOM_STEP ** MIN_ZOOM_OUT_STEPS);

  const {
    nodes,
    edges,
    selectedNode,
    executingNodeId,
    recentNodeIds,
    recentEdgeIds,
    onNodesChange,
    onEdgesChange,
    onConnect,
    addNode,
    setSelectedNode,
    setSelectedEdge,
    copySelectionToClipboard,
    pasteClipboard,
    duplicateSelection,
  } = useFlowStore();

  const releasePointerCapture = useCallback((pointerId: number) => {
    const root = reactFlowWrapper.current;
    if (!root) return;
    const elements = [root, ...Array.from(root.querySelectorAll<HTMLElement>('*'))];
    for (const element of elements) {
      try {
        if (element.hasPointerCapture?.(pointerId)) element.releasePointerCapture(pointerId);
      } catch {
        // Best-effort cleanup for browser/React Flow drag state.
      }
    }
  }, []);

  const hasActiveReactFlowConnection = useCallback((): boolean => {
    const store = reactFlowStore.getState() as any;
    return Boolean(store.connectionStartHandle || store.connectionNodeId || store.connectionHandleId);
  }, [reactFlowStore]);

  const resetCanvasInteraction = useCallback(
    (pointerId?: number, options: ResetCanvasInteractionOptions = {}) => {
      if (typeof pointerId === 'number') {
        activeCanvasPointerIds.current.delete(pointerId);
        releasePointerCapture(pointerId);
      } else {
        for (const id of activeCanvasPointerIds.current) releasePointerCapture(id);
        activeCanvasPointerIds.current.clear();
      }

      const preserveConnectionDrag = !options.forceConnectionCancel && hasActiveReactFlowConnection();
      if (!preserveConnectionDrag) setActiveConnection(null);

      // React Flow's d3 drag handlers can miss release/cancel on trackpads or
      // window focus changes. Clear only transient interaction flags; persisted
      // graph state remains owned by the store/actions above.
      window.setTimeout(() => {
        const store = reactFlowStore.getState() as any;
        const connectionStillActive = Boolean(
          store.connectionStartHandle || store.connectionNodeId || store.connectionHandleId
        );
        if (options.forceConnectionCancel || !connectionStillActive) {
          store.cancelConnection?.();
          setActiveConnection(null);
        }
        (reactFlowStore as any).setState?.({
          paneDragging: false,
          userSelectionActive: false,
          nodesSelectionActive: false,
          userSelectionRect: null,
        });
      }, 0);
    },
    [reactFlowStore, releasePointerCapture, hasActiveReactFlowConnection]
  );

  const handleCanvasPointerDownCapture = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    activeCanvasPointerIds.current.add(event.pointerId);
  }, []);

  const handleCanvasPointerReleaseCapture = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      resetCanvasInteraction(event.pointerId);
    },
    [resetCanvasInteraction]
  );

  const handleCanvasPointerCancelCapture = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      resetCanvasInteraction(event.pointerId, { forceConnectionCancel: true });
    },
    [resetCanvasInteraction]
  );

  const handleCanvasPointerMoveCapture = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.buttons === 0 && activeCanvasPointerIds.current.size > 0) {
        resetCanvasInteraction(event.pointerId);
      }
    },
    [resetCanvasInteraction]
  );

  // Map pin handle ids → pin types so we can color data edges by their data type.
  const pinTypesByNodeId = useMemo(() => {
    const outputsByNode = new Map<string, Map<string, PinType>>();
    const inputsByNode = new Map<string, Map<string, PinType>>();
    for (const n of nodes) {
      const data = n.data;
      const out = new Map<string, PinType>();
      const inp = new Map<string, PinType>();
      for (const p of data.outputs || []) out.set(p.id, p.type as PinType);
      for (const p of data.inputs || []) inp.set(p.id, p.type as PinType);
      outputsByNode.set(n.id, out);
      inputsByNode.set(n.id, inp);
    }
    return { outputsByNode, inputsByNode };
  }, [nodes]);

  const isEditableTarget = (target: EventTarget | null): boolean => {
    if (!target) return false;
    if (!(target instanceof HTMLElement)) return false;
    const tag = target.tagName.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
    if (target.isContentEditable) return true;
    if (target.closest?.('[data-no-flow-hotkeys="true"]')) return true;
    return false;
  };

  useEffect(() => {
    const opts = { capture: true } as const;
    const onKeyDown = (e: KeyboardEvent) => {
      // Avoid hijacking normal typing / editor shortcuts.
      if (e.defaultPrevented) return;
      if (isEditableTarget(e.target)) return;
      const sel = window.getSelection?.();
      if (sel && !sel.isCollapsed) return;

      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const key = (e.key || '').toLowerCase();

      if (!e.shiftKey && key === 'c') {
        const n = copySelectionToClipboard();
        if (n > 0) {
          e.preventDefault();
          toast.success(n === 1 ? 'Copied node' : `Copied ${n} nodes`);
        }
        return;
      }

      if (!e.shiftKey && key === 'v') {
        const n = pasteClipboard();
        if (n > 0) {
          e.preventDefault();
          toast.success(n === 1 ? 'Pasted node' : `Pasted ${n} nodes`);
        }
        return;
      }

      // Duplicate selected nodes (Blueprint-style "duplicate quickly") without edges.
      // NOTE: We avoid Ctrl/Cmd+W (browser tab close). Use Ctrl/Cmd+Shift+V instead.
      if (e.shiftKey && key === 'v') {
        const n = duplicateSelection();
        if (n > 0) {
          e.preventDefault();
          toast.success(n === 1 ? 'Duplicated node' : `Duplicated ${n} nodes`);
        }
      }
    };

    window.addEventListener('keydown', onKeyDown, opts);
    return () => {
      window.removeEventListener('keydown', onKeyDown, opts);
    };
  }, [copySelectionToClipboard, pasteClipboard, duplicateSelection]);

  useEffect(() => {
    const opts = { capture: true } as const;
    const isInsideCanvas = (target: EventTarget | null): boolean => {
      const DomNode = globalThis.Node;
      return Boolean(typeof DomNode !== 'undefined' && target instanceof DomNode && reactFlowWrapper.current?.contains(target));
    };
    const onPointerDown = (event: PointerEvent) => {
      if (isInsideCanvas(event.target)) activeCanvasPointerIds.current.add(event.pointerId);
    };
    const onPointerRelease = (event: PointerEvent) => {
      if (activeCanvasPointerIds.current.size > 0 || activeConnection) {
        resetCanvasInteraction(event.pointerId, { forceConnectionCancel: event.type === 'pointercancel' });
      }
    };
    const onPointerMove = (event: PointerEvent) => {
      if (event.buttons === 0 && activeCanvasPointerIds.current.size > 0) {
        resetCanvasInteraction(event.pointerId);
      }
    };
    const onMouseRelease = () => {
      if (activeCanvasPointerIds.current.size > 0 || activeConnection) resetCanvasInteraction();
    };
    const onForcedMouseRelease = () => {
      if (activeCanvasPointerIds.current.size > 0 || activeConnection) {
        resetCanvasInteraction(undefined, { forceConnectionCancel: true });
      }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState !== 'visible') resetCanvasInteraction(undefined, { forceConnectionCancel: true });
    };

    window.addEventListener('pointerdown', onPointerDown, opts);
    window.addEventListener('pointerup', onPointerRelease, opts);
    window.addEventListener('pointercancel', onPointerRelease, opts);
    window.addEventListener('pointermove', onPointerMove, opts);
    window.addEventListener('mouseup', onMouseRelease, opts);
    window.addEventListener('blur', onForcedMouseRelease, opts);
    window.addEventListener('contextmenu', onForcedMouseRelease, opts);
    document.addEventListener('visibilitychange', onVisibilityChange, opts);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, opts);
      window.removeEventListener('pointerup', onPointerRelease, opts);
      window.removeEventListener('pointercancel', onPointerRelease, opts);
      window.removeEventListener('pointermove', onPointerMove, opts);
      window.removeEventListener('mouseup', onMouseRelease, opts);
      window.removeEventListener('blur', onForcedMouseRelease, opts);
      window.removeEventListener('contextmenu', onForcedMouseRelease, opts);
      document.removeEventListener('visibilitychange', onVisibilityChange, opts);
    };
  }, [activeConnection, resetCanvasInteraction]);

  // Handle connection with validation
  const handleConnect = useCallback(
    (connection: Connection) => {
      setActiveConnection(null);
      if (!validateConnection(nodes, edges, connection)) {
        toast.error(getConnectionError(nodes, edges, connection) || 'Invalid connection');
        return;
      }
      onConnect(connection);
    },
    [nodes, edges, onConnect]
  );

  const handleConnectStart = useCallback(
    (_event: unknown, params: { nodeId?: string | null; handleId?: string | null; handleType?: string | null }) => {
      const nodeId = typeof params?.nodeId === 'string' ? params.nodeId : '';
      const handleId = typeof params?.handleId === 'string' ? params.handleId : '';
      const handleType = params?.handleType === 'target' ? 'target' : 'source';
      if (!nodeId || !handleId) {
        setActiveConnection(null);
        return;
      }
      const resolvedPinType =
        handleType === 'source'
          ? pinTypesByNodeId.outputsByNode.get(nodeId)?.get(handleId)
          : pinTypesByNodeId.inputsByNode.get(nodeId)?.get(handleId);
      const pinType =
        resolvedPinType ||
        (handleId === 'exec-in' || handleId === 'exec-out' ? 'execution' : undefined);
      setActiveConnection({ nodeId, handleId, handleType, pinType });
    },
    [pinTypesByNodeId]
  );

  const handleConnectEnd = useCallback(() => {
    setActiveConnection(null);
  }, []);

  const handleIsValidConnection = useCallback(
    (connection: Connection): boolean => validateConnection(nodes, edges, connection),
    [nodes, edges]
  );

  // Handle node selection
  const handleNodeClick = useCallback(
    (_event: MouseEvent, node: Node<FlowNodeData>) => {
      const { connectionPreview: _preview, ...cleanData } = node.data;
      setSelectedNode({ ...node, data: cleanData });
    },
    [setSelectedNode]
  );

  // Handle edge selection
  const handleEdgeClick = useCallback(
    (_event: MouseEvent, edge: Edge) => {
      setSelectedEdge(edge);
    },
    [setSelectedEdge]
  );

  // Handle pane click (deselect)
  const handlePaneClick = useCallback(() => {
    setSelectedNode(null);
    setSelectedEdge(null);
  }, [setSelectedNode, setSelectedEdge]);

  // Handle drag over (allow drop)
  const handleDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  // Handle drop (add node)
  const handleDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();

      const templateData = event.dataTransfer.getData('application/reactflow');
      if (!templateData || !reactFlowInstance.current || !reactFlowWrapper.current) {
        return;
      }

      try {
        const template: NodeTemplate = JSON.parse(templateData);

        // Get drop position in flow coordinates
        const bounds = reactFlowWrapper.current.getBoundingClientRect();
        const position = reactFlowInstance.current.screenToFlowPosition({
          x: event.clientX - bounds.left,
          y: event.clientY - bounds.top,
        });

        addNode(template, position);
        toast.success(`Added ${template.label} node`);
      } catch (e) {
        console.error('Failed to parse dropped node template:', e);
      }
    },
    [addNode]
  );

  // Store ReactFlow instance
  const handleInit = useCallback((instance: ReactFlowInstance) => {
    reactFlowInstance.current = instance;
  }, []);

  useEffect(() => {
    const root = reactFlowWrapper.current;
    if (!root) return;

    let frame = 0;
    let lastWidth = 0;
    let lastHeight = 0;
    const notifyLayoutChanged = () => {
      if (frame) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        window.dispatchEvent(new Event('resize'));
      });
    };

    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      const width = Math.round(rect?.width || 0);
      const height = Math.round(rect?.height || 0);
      if (width <= 0 || height <= 0) return;
      if (width === lastWidth && height === lastHeight) return;
      lastWidth = width;
      lastHeight = height;
      notifyLayoutChanged();
    });
    observer.observe(root);
    notifyLayoutChanged();

    return () => {
      observer.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  const focusNode = useCallback(
    (nodeId: string) => {
      const inst = reactFlowInstance.current;
      if (!inst) return;
      const node = nodes.find((n) => n.id === nodeId);
      if (!node) return;
      try {
        inst.fitView({ nodes: [node], padding: 0.35, duration: 250, maxZoom: DEFAULT_ZOOM });
      } catch {
        // best-effort; ignore
      }
    },
    [nodes, DEFAULT_ZOOM]
  );

  const minimapNodeColor = useCallback((node: Node<FlowNodeData>): string => {
    const data = node.data as FlowNodeData;
    return data?.headerColor || '#71819a';
  }, []);

  const minimapNodeStrokeColor = useCallback(
    (node: Node<FlowNodeData>): string => {
      if (executingNodeId === node.id) return '#31f08a';
      if (recentNodeIds && recentNodeIds[node.id]) return '#67b8ff';
      if (node.selected || selectedNode?.id === node.id) return '#f8fbff';
      return 'rgba(212, 224, 245, 0.48)';
    },
    [executingNodeId, recentNodeIds, selectedNode]
  );

  const minimapNodeClassName = useCallback(
    (node: Node<FlowNodeData>): string => {
      const classes = ['canvas-preview-node'];
      if (executingNodeId === node.id) classes.push('is-executing');
      else if (recentNodeIds && recentNodeIds[node.id]) classes.push('is-recent');
      if (node.selected || selectedNode?.id === node.id) classes.push('is-selected');
      return classes.join(' ');
    },
    [executingNodeId, recentNodeIds, selectedNode]
  );

  // Get edge style based on source handle type
  const getEdgeStyleColor = (edge: Edge): string | null => {
    const sourceHandle = edge.sourceHandle || '';
    const outMap = pinTypesByNodeId.outputsByNode.get(edge.source);
    const sourceType = outMap?.get(sourceHandle);
    if (!sourceType || sourceType === 'execution') return null;
    return PIN_COLORS[sourceType] || null;
  };

  // Execution observability:
  // Highlight only the *taken* execution edges (prev → next) via an afterglow class
  // driven by execution events. Do NOT highlight all outgoing edges of the active node,
  // otherwise conditional/control nodes would light up branches that are not taken.
  const baseStyledEdges = useMemo(() => {
    const nodeRectsById = new Map<string, RouteRect>();
    for (const node of nodes) {
      const measured = (node as any).measured || {};
      const width = Number(node.width || measured.width || 320);
      const height = Number(node.height || measured.height || 220);
      nodeRectsById.set(node.id, {
        x: node.position.x,
        y: node.position.y,
        width: Number.isFinite(width) ? width : 320,
        height: Number.isFinite(height) ? height : 220,
      });
    }

    return edges.map((e) => {
      const sourceHandle = e.sourceHandle || '';
      const targetHandle = e.targetHandle || '';
      const sourceType = pinTypesByNodeId.outputsByNode.get(e.source)?.get(sourceHandle);
      const targetType = pinTypesByNodeId.inputsByNode.get(e.target)?.get(targetHandle);
      const isExecEdge = sourceType === 'execution' || targetType === 'execution';
      const isRouteOverride = isRouteOverrideEdge(e);

      // ---- classes -------------------------------------------------------
      // This class is used only for baseline styling (slightly thicker exec edges).
      // Runtime "path taken" highlighting is handled separately via `exec-recent`.
      const prevClassName = e.className || '';
      const parts = prevClassName
        .split(/\s+/)
        .filter(Boolean)
        .filter((c) => c !== 'exec-recent' && c !== 'exec-active');
      const cleanParts = parts.filter((c) => c !== 'exec-base' && c !== 'route-override');
      const nextPartsBase = isExecEdge ? [...cleanParts, 'exec-base'] : cleanParts;
      const nextParts = isRouteOverride ? [...nextPartsBase, 'route-override'] : nextPartsBase;
      const nextClassName = nextParts.length > 0 ? nextParts.join(' ') : undefined;

      // ---- style ---------------------------------------------------------
      // Data edges: color by the source pin data type for better readability.
      // Exec edges: keep neutral colors; UX uses stroke width + runtime afterglow.
      const desiredStroke = !isExecEdge ? getEdgeStyleColor(e) : null;
      const prevStroke = (e.style as Record<string, unknown> | undefined)?.stroke as string | undefined;
      const shouldSetStroke = Boolean(desiredStroke) && desiredStroke !== prevStroke;
      const nextStyleBase = shouldSetStroke ? ({ ...(e.style || {}), stroke: desiredStroke } as Edge['style']) : e.style;
      const nextStyle = isRouteOverride
        ? ({ ...(nextStyleBase || {}), strokeDasharray: '7 5' } as Edge['style'])
        : nextStyleBase;
      const nextZIndex = isExecEdge ? 2 : isRouteOverride ? 1 : 0;
      const nextType = 'workflow';
      const sourceRect = nodeRectsById.get(e.source);
      const targetRect = nodeRectsById.get(e.target);
      const minX = Math.min(sourceRect?.x ?? 0, targetRect?.x ?? 0) - 120;
      const maxX = Math.max(
        sourceRect ? sourceRect.x + sourceRect.width : 0,
        targetRect ? targetRect.x + targetRect.width : 0
      ) + 120;
      const routeRects = [...nodeRectsById.entries()]
        .filter(([nodeId, rect]) => nodeId !== e.source && nodeId !== e.target && rect.x < maxX && rect.x + rect.width > minX)
        .map(([, rect]) => rect);
      const sourceRight = sourceRect ? sourceRect.x + sourceRect.width : Number.NEGATIVE_INFINITY;
      const targetLeft = targetRect ? targetRect.x : Number.POSITIVE_INFINITY;
      const forwardGapMin = Math.min(sourceRight, targetLeft);
      const forwardGapMax = Math.max(sourceRight, targetLeft);
      const yMin = Math.min(sourceRect?.y ?? 0, targetRect?.y ?? 0) - 24;
      const yMax = Math.max(
        sourceRect ? sourceRect.y + sourceRect.height : 0,
        targetRect ? targetRect.y + targetRect.height : 0
      ) + 24;
      const routeHasObstacle = Boolean(
        sourceRect &&
        targetRect &&
        sourceRect.x < targetRect.x &&
        routeRects.some((rect) => {
          const overlapsX = rect.x < forwardGapMax && rect.x + rect.width > forwardGapMin;
          const overlapsY = rect.y < yMax && rect.y + rect.height > yMin;
          return overlapsX && overlapsY;
        })
      );
      const prevData = e.data && typeof e.data === 'object' ? (e.data as Record<string, unknown>) : {};
      const routeKind = isExecEdge ? 'exec' : isRouteOverride ? 'override' : 'data';
      const nextData = { ...prevData, routeKind, routeRects, routeHasObstacle, sourceRect, targetRect };

      const classChanged = nextClassName !== (e.className || undefined);
      const styleChanged = nextStyle !== e.style;
      const zIndexChanged = e.zIndex !== nextZIndex;
      const typeChanged = e.type !== nextType;
      const dataChanged =
        prevData.routeKind !== routeKind ||
        prevData.routeHasObstacle !== routeHasObstacle ||
        !Array.isArray(prevData.routeRects) ||
        (prevData.routeRects as unknown[]).length !== routeRects.length ||
        prevData.sourceRect !== sourceRect ||
        prevData.targetRect !== targetRect;
      if (!classChanged && !styleChanged && !zIndexChanged && !typeChanged && !dataChanged) return e;
      return { ...e, className: nextClassName, style: nextStyle, zIndex: nextZIndex, type: nextType, data: nextData };
    });
  }, [edges, nodes, pinTypesByNodeId]);

  const decoratedEdges = useMemo(() => {
    const hasRecent = Boolean(recentEdgeIds && Object.keys(recentEdgeIds).length > 0);
    if (!hasRecent) return baseStyledEdges;
    return baseStyledEdges.map((e) => {
      if (!recentEdgeIds || !recentEdgeIds[e.id]) return e;
      const prev = e.className || '';
      if (prev.split(/\s+/).includes('exec-recent')) return e;
      const next = (prev ? `${prev} ` : '') + 'exec-recent';
      return { ...e, className: next };
    });
  }, [baseStyledEdges, recentEdgeIds]);

  const previewNodes = useMemo(() => {
    if (!activeConnection) return nodes;
    return nodes.map((node) => ({
      ...node,
      data: {
        ...node.data,
        connectionPreview: buildConnectionPreviewForNode(nodes, edges, activeConnection, node),
      },
    }));
  }, [activeConnection, nodes, edges]);

  const connectionLineStyle = useMemo(() => {
    const sourceType = activeConnection?.pinType;
    const color = sourceType && sourceType !== 'execution' ? PIN_COLORS[sourceType] : '#888';
    return { stroke: color || '#888', strokeWidth: activeConnection ? 3 : 2 };
  }, [activeConnection]);

  return (
    <div
      ref={reactFlowWrapper}
      className="canvas-wrapper"
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onPointerDownCapture={handleCanvasPointerDownCapture}
      onPointerMoveCapture={handleCanvasPointerMoveCapture}
      onPointerUpCapture={handleCanvasPointerReleaseCapture}
      onPointerCancelCapture={handleCanvasPointerCancelCapture}
      onLostPointerCapture={handleCanvasPointerReleaseCapture}
      onContextMenuCapture={() => resetCanvasInteraction(undefined, { forceConnectionCancel: true })}
    >
        <ReactFlow
          nodes={previewNodes}
          edges={decoratedEdges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={handleConnect}
          onConnectStart={handleConnectStart}
          onConnectEnd={handleConnectEnd}
          isValidConnection={handleIsValidConnection}
          connectionMode={ConnectionMode.Strict}
          onNodeClick={handleNodeClick}
          onEdgeClick={handleEdgeClick}
          onPaneClick={handlePaneClick}
          onInit={handleInit}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          minZoom={MIN_ZOOM}
          maxZoom={MAX_ZOOM}
          defaultViewport={{ x: 0, y: 0, zoom: DEFAULT_ZOOM }}
          defaultEdgeOptions={{
            type: 'smoothstep',
            animated: false,
          }}
          connectionLineStyle={connectionLineStyle}
          fitView
          fitViewOptions={{ maxZoom: DEFAULT_ZOOM }}
          snapToGrid
          snapGrid={[16, 16]}
          deleteKeyCode={['Backspace', 'Delete']}
          attributionPosition="top-right"
        >
          <Controls />
          <Background
            variant={BackgroundVariant.Dots}
            gap={16}
            size={1.15}
            color="rgba(124, 149, 188, 0.28)"
          />
          {previewCollapsed ? (
            <button
              type="button"
              className="canvas-preview-toggle canvas-preview-toggle--expand collapsed"
              onClick={() => setPreviewCollapsed(false)}
              aria-label="Show canvas preview"
              title="Show canvas preview"
            >
              <span className="canvas-preview-toggle-icon" aria-hidden="true" />
            </button>
          ) : (
            <>
              <MiniMap
                nodeColor={minimapNodeColor}
                nodeStrokeColor={minimapNodeStrokeColor}
                nodeClassName={minimapNodeClassName}
                nodeBorderRadius={4}
                nodeStrokeWidth={3}
                maskColor="rgba(5, 8, 18, 0.66)"
                maskStrokeColor="rgba(132, 177, 255, 0.32)"
                maskStrokeWidth={2}
                pannable
                zoomable
                zoomStep={8}
                offsetScale={7}
                ariaLabel="Canvas preview"
                onNodeClick={(event, node) => {
                  event.stopPropagation();
                  focusNode(node.id);
                }}
              />
              <button
                type="button"
                className="canvas-preview-toggle canvas-preview-toggle--collapse"
                onClick={() => setPreviewCollapsed(true)}
                aria-label="Collapse canvas preview"
                title="Collapse canvas preview"
              >
                <span className="canvas-preview-toggle-icon" aria-hidden="true" />
              </button>
            </>
          )}
        </ReactFlow>
        {nodes.length === 0 ? (
          <div className="canvas-empty-state" aria-hidden="true">
            <div className="canvas-empty-title">Start your flow</div>
            <div className="canvas-empty-text">Drag a node from the left palette and drop it here.</div>
            <div className="canvas-empty-hint">Tip: begin with an event node such as “On Flow Start”.</div>
          </div>
        ) : null}
        <ConnectionFeedbackOverlay
          activeConnection={activeConnection}
          nodes={nodes}
          edges={edges}
          wrapperRef={reactFlowWrapper}
        />
        <RunPreflightPanel onFocusNode={focusNode} />
        <PinLegend />
    </div>
  );
}

export function Canvas() {
  return (
    <ReactFlowProvider>
      <CanvasBody />
    </ReactFlowProvider>
  );
}

export default Canvas;
