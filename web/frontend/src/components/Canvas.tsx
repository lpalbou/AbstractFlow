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

type RoutePoint = { x: number; y: number };
type RouteRect = { x: number; y: number; width: number; height: number };

function compactPoints(points: RoutePoint[]): RoutePoint[] {
  const out: RoutePoint[] = [];
  for (const p of points) {
    const prev = out[out.length - 1];
    if (prev && Math.abs(prev.x - p.x) < 0.5 && Math.abs(prev.y - p.y) < 0.5) continue;
    out.push(p);
  }
  return out;
}

function roundedPolylinePath(pointsIn: RoutePoint[], radius = 18): string {
  const points = compactPoints(pointsIn);
  if (points.length === 0) return '';
  if (points.length === 1) return `M ${points[0].x},${points[0].y}`;
  let path = `M ${points[0].x},${points[0].y}`;
  for (let i = 1; i < points.length - 1; i += 1) {
    const prev = points[i - 1];
    const curr = points[i];
    const next = points[i + 1];
    const inDx = curr.x - prev.x;
    const inDy = curr.y - prev.y;
    const outDx = next.x - curr.x;
    const outDy = next.y - curr.y;
    const inLen = Math.hypot(inDx, inDy);
    const outLen = Math.hypot(outDx, outDy);
    if (inLen < 1 || outLen < 1) {
      path += ` L ${curr.x},${curr.y}`;
      continue;
    }
    const r = Math.min(radius, inLen / 2, outLen / 2);
    const before = { x: curr.x - (inDx / inLen) * r, y: curr.y - (inDy / inLen) * r };
    const after = { x: curr.x + (outDx / outLen) * r, y: curr.y + (outDy / outLen) * r };
    path += ` L ${before.x},${before.y} Q ${curr.x},${curr.y} ${after.x},${after.y}`;
  }
  const last = points[points.length - 1];
  path += ` L ${last.x},${last.y}`;
  return path;
}

function routeLength(points: RoutePoint[]): number {
  let length = 0;
  for (let i = 1; i < points.length; i += 1) {
    length += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }
  return length;
}

function routeIntersectsRects(points: RoutePoint[], rects: RouteRect[], padding = 14): boolean {
  if (points.length < 2 || rects.length === 0) return false;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    const minX = Math.min(a.x, b.x);
    const maxX = Math.max(a.x, b.x);
    const minY = Math.min(a.y, b.y);
    const maxY = Math.max(a.y, b.y);
    for (const rect of rects) {
      const left = rect.x - padding;
      const right = rect.x + rect.width + padding;
      const top = rect.y - padding;
      const bottom = rect.y + rect.height + padding;
      if (maxX < left || minX > right || maxY < top || minY > bottom) continue;
      return true;
    }
  }
  return false;
}

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
    const nodeTop = Math.min(sourceRect?.y ?? sourceY, targetRect?.y ?? targetY);
    const nodeBottom = Math.max(
      sourceRect ? sourceRect.y + sourceRect.height : sourceY,
      targetRect ? targetRect.y + targetRect.height : targetY
    );
    const direction = targetX >= sourceX ? 1 : -1;
    const sourceStub = sourceX + direction * 48;
    const targetStub = targetX - direction * 48;
    const laneMargin = isControl ? 54 : 78;
    const preferredAbove = isControl && isBackEdge ? true : sourceY <= nodeTop + (targetY - nodeTop) / 2;
    const makePoints = (laneY: number): RoutePoint[] => [
      { x: sourceX, y: sourceY },
      { x: sourceStub, y: sourceY },
      { x: sourceStub, y: laneY },
      { x: targetStub, y: laneY },
      { x: targetStub, y: targetY },
      { x: targetX, y: targetY },
    ];
    const laneCandidates: Array<{ above: boolean; points: RoutePoint[] }> = [];
    for (let step = 0; step < 5; step += 1) {
      const margin = laneMargin + step * 36;
      const above = { above: true, points: makePoints(nodeTop - margin) };
      const below = { above: false, points: makePoints(nodeBottom + margin) };
      laneCandidates.push(preferredAbove ? above : below, preferredAbove ? below : above);
    }
    const clearCandidates = laneCandidates.filter((candidate) =>
      !routeIntersectsRects(candidate.points, routeRects, isControl ? 12 : 18)
    );
    const candidates = clearCandidates.length > 0 ? clearCandidates : laneCandidates;
    const chosen = candidates.reduce((best, candidate) => {
      if (isControl && isBackEdge && best.above !== candidate.above) return best.above ? best : candidate;
      return routeLength(candidate.points) < routeLength(best.points) ? candidate : best;
    }, candidates[0]);
    path = roundedPolylinePath(chosen.points, isControl ? 16 : 18);
  } else if (!path && isControl) {
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

  return <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} interactionWidth={24} />;
}

const edgeTypes = {
  workflow: WorkflowEdge,
};

type ReactFlowConnectingHandle = {
  nodeId: string;
  type: 'source' | 'target';
  handleId?: string | null;
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

  const resetCanvasInteraction = useCallback(
    (pointerId?: number) => {
      if (typeof pointerId === 'number') {
        activeCanvasPointerIds.current.delete(pointerId);
        releasePointerCapture(pointerId);
      } else {
        for (const id of activeCanvasPointerIds.current) releasePointerCapture(id);
        activeCanvasPointerIds.current.clear();
      }
      setActiveConnection(null);

      // React Flow's d3 drag handlers can miss release/cancel on trackpads or
      // window focus changes. Clear only transient interaction flags; persisted
      // graph state remains owned by the store/actions above.
      window.setTimeout(() => {
        const store = reactFlowStore.getState() as any;
        store.cancelConnection?.();
        (reactFlowStore as any).setState?.({
          paneDragging: false,
          userSelectionActive: false,
          nodesSelectionActive: false,
          userSelectionRect: null,
        });
      }, 0);
    },
    [reactFlowStore, releasePointerCapture]
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
        resetCanvasInteraction(event.pointerId);
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
    const onVisibilityChange = () => {
      if (document.visibilityState !== 'visible') resetCanvasInteraction();
    };

    window.addEventListener('pointerdown', onPointerDown, opts);
    window.addEventListener('pointerup', onPointerRelease, opts);
    window.addEventListener('pointercancel', onPointerRelease, opts);
    window.addEventListener('pointermove', onPointerMove, opts);
    window.addEventListener('mouseup', onMouseRelease, opts);
    window.addEventListener('blur', onMouseRelease, opts);
    window.addEventListener('contextmenu', onMouseRelease, opts);
    document.addEventListener('visibilitychange', onVisibilityChange, opts);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, opts);
      window.removeEventListener('pointerup', onPointerRelease, opts);
      window.removeEventListener('pointercancel', onPointerRelease, opts);
      window.removeEventListener('pointermove', onPointerMove, opts);
      window.removeEventListener('mouseup', onMouseRelease, opts);
      window.removeEventListener('blur', onMouseRelease, opts);
      window.removeEventListener('contextmenu', onMouseRelease, opts);
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
      const pinType =
        handleType === 'source'
          ? pinTypesByNodeId.outputsByNode.get(nodeId)?.get(handleId)
          : pinTypesByNodeId.inputsByNode.get(nodeId)?.get(handleId);
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
      onPointerCancelCapture={handleCanvasPointerReleaseCapture}
      onLostPointerCapture={handleCanvasPointerReleaseCapture}
      onContextMenuCapture={() => resetCanvasInteraction()}
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
        >
          <Controls />
          <Background
            variant={BackgroundVariant.Dots}
            gap={16}
            size={1}
            color="#444"
          />
          {previewCollapsed ? (
            <button
              type="button"
              className="canvas-preview-toggle collapsed"
              onClick={() => setPreviewCollapsed(false)}
              title="Show canvas preview"
            >
              Preview
            </button>
          ) : (
            <>
              <MiniMap
                nodeColor={(node) => {
                  const data = node.data as FlowNodeData;
                  return data?.headerColor || '#888';
                }}
                maskColor="rgba(0, 0, 0, 0.7)"
                onClick={() => setPreviewCollapsed(true)}
              />
              <button
                type="button"
                className="canvas-preview-toggle"
                onClick={() => setPreviewCollapsed(true)}
                title="Collapse canvas preview"
              >
                ×
              </button>
            </>
          )}
        </ReactFlow>
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
