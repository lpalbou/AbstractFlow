/**
 * Main canvas component with React Flow.
 */

import { useCallback, useEffect, useMemo, useRef, DragEvent, MouseEvent } from 'react';
import ReactFlow, {
  Controls,
  Background,
  MiniMap,
  Connection,
  ReactFlowInstance,
  BackgroundVariant,
  Node,
  Edge,
  ConnectionMode,
} from 'reactflow';
import toast from 'react-hot-toast';
import { nodeTypes } from './nodes';
import { useFlowStore } from '../hooks/useFlow';
import { getConnectionError, validateConnection } from '../utils/validation';
import { NodeTemplate } from '../types/nodes';
import type { FlowNodeData, PinType } from '../types/flow';
import { PIN_COLORS } from '../types/flow';
import { PinLegend } from './PinLegend';

export function Canvas() {
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const reactFlowInstance = useRef<ReactFlowInstance | null>(null);

  // React Flow uses a multiplicative zoom factor of 1.2 per zoom step.
  // We define our own "zoom positions" relative to max zoom:
  // - Default: 2 zoom-out steps from max
  // - Min: 10 zoom-out steps from max
  const ZOOM_STEP = 1.2;
  const MAX_ZOOM = 2;
  const DEFAULT_ZOOM_OUT_STEPS = 2;
  const MIN_ZOOM_OUT_STEPS = 10;

  const DEFAULT_ZOOM = MAX_ZOOM / (ZOOM_STEP ** DEFAULT_ZOOM_OUT_STEPS);
  const MIN_ZOOM = MAX_ZOOM / (ZOOM_STEP ** MIN_ZOOM_OUT_STEPS);

  const {
    nodes,
    edges,
    executingNodeId,
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

  // Handle connection with validation
  const handleConnect = useCallback(
    (connection: Connection) => {
      if (!validateConnection(nodes, edges, connection)) {
        toast.error(getConnectionError(nodes, edges, connection) || 'Invalid connection');
        return;
      }
      onConnect(connection);
    },
    [nodes, edges, onConnect]
  );

  // Handle node selection
  const handleNodeClick = useCallback(
    (_event: MouseEvent, node: Node<FlowNodeData>) => {
      setSelectedNode(node);
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

  // Get edge style based on source handle type
  const getEdgeStyleColor = (edge: Edge): string => {
    const sourceNode = nodes.find((n) => n.id === edge.source);
    if (!sourceNode) return '#888';

    const sourcePin = sourceNode.data.outputs.find(
      (p) => p.id === edge.sourceHandle
    );
    if (!sourcePin) return '#888';

    return PIN_COLORS[sourcePin.type as PinType] || '#888';
  };

  // Unused currently but can be used for custom edge rendering
  void getEdgeStyleColor;

  // Execution observability:
  // While a node is executing, highlight the execution edges connected to it
  // (incoming/outgoing exec pins) so users can visually follow the graph.
  const decoratedEdges = useMemo(() => {
    const hasActive = Boolean(executingNodeId);
    const hasRecent = Boolean(recentEdgeIds && Object.keys(recentEdgeIds).length > 0);
    if (!hasActive && !hasRecent) return edges;
    const isExec = (e: Edge) => e.sourceHandle === 'exec-out' || e.targetHandle === 'exec-in' || Boolean(e.animated);
    const isActive = (e: Edge) =>
      isExec(e) && (e.source === executingNodeId || e.target === executingNodeId);
    return edges.map((e) => {
      const classes = [e.className || ''].filter(Boolean);

      if (hasRecent && recentEdgeIds && recentEdgeIds[e.id]) {
        classes.push('exec-recent');
      }

      let animated = Boolean(e.animated);
      if (hasActive && isActive(e)) {
        classes.push('exec-active');
        animated = true;
      }

      if (classes.length === 0 && animated === Boolean(e.animated)) return e;
      return { ...e, className: classes.join(' '), animated };
    });
  }, [edges, executingNodeId, recentEdgeIds]);

  return (
    <div
      ref={reactFlowWrapper}
      className="canvas-wrapper"
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <ReactFlow
        nodes={nodes}
        edges={decoratedEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={handleConnect}
        isValidConnection={(connection) => validateConnection(nodes, edges, connection)}
        connectionMode={ConnectionMode.Strict}
        onNodeClick={handleNodeClick}
        onEdgeClick={handleEdgeClick}
        onPaneClick={handlePaneClick}
        onInit={handleInit}
        nodeTypes={nodeTypes}
        minZoom={MIN_ZOOM}
        maxZoom={MAX_ZOOM}
        defaultViewport={{ x: 0, y: 0, zoom: DEFAULT_ZOOM }}
        defaultEdgeOptions={{
          type: 'smoothstep',
          animated: false,
        }}
        connectionLineStyle={{ stroke: '#888', strokeWidth: 2 }}
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
        <MiniMap
          nodeColor={(node) => {
            const data = node.data as FlowNodeData;
            return data?.headerColor || '#888';
          }}
          maskColor="rgba(0, 0, 0, 0.7)"
        />
      </ReactFlow>
      <PinLegend />
    </div>
  );
}

export default Canvas;
