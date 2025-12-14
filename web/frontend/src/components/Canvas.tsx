/**
 * Main canvas component with React Flow.
 */

import { useCallback, useRef, DragEvent, MouseEvent } from 'react';
import ReactFlow, {
  Controls,
  Background,
  MiniMap,
  Connection,
  ReactFlowInstance,
  BackgroundVariant,
  Node,
  Edge,
} from 'reactflow';
import toast from 'react-hot-toast';
import { nodeTypes } from './nodes';
import { useFlowStore } from '../hooks/useFlow';
import { validateConnection } from '../utils/validation';
import { NodeTemplate } from '../types/nodes';
import type { FlowNodeData, PinType } from '../types/flow';
import { PIN_COLORS } from '../types/flow';

export function Canvas() {
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const reactFlowInstance = useRef<ReactFlowInstance | null>(null);

  const {
    nodes,
    edges,
    onNodesChange,
    onEdgesChange,
    onConnect,
    addNode,
    setSelectedNode,
    setSelectedEdge,
  } = useFlowStore();

  // Handle connection with validation
  const handleConnect = useCallback(
    (connection: Connection) => {
      if (!validateConnection(nodes, connection)) {
        toast.error('Incompatible pin types');
        return;
      }
      onConnect(connection);
    },
    [nodes, onConnect]
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

  return (
    <div
      ref={reactFlowWrapper}
      className="canvas-wrapper"
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={handleConnect}
        onNodeClick={handleNodeClick}
        onEdgeClick={handleEdgeClick}
        onPaneClick={handlePaneClick}
        onInit={handleInit}
        nodeTypes={nodeTypes}
        defaultEdgeOptions={{
          type: 'smoothstep',
          animated: false,
        }}
        connectionLineStyle={{ stroke: '#888', strokeWidth: 2 }}
        fitView
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
    </div>
  );
}

export default Canvas;
