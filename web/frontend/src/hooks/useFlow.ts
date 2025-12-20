/**
 * Flow state management with Zustand.
 */

import { create } from 'zustand';
import {
  Node,
  Edge,
  Connection,
  addEdge,
  applyNodeChanges,
  applyEdgeChanges,
  NodeChange,
  EdgeChange,
} from 'reactflow';
import type { FlowNodeData, VisualFlow } from '../types/flow';
import { createNodeData, getNodeTemplate, NodeTemplate } from '../types/nodes';

interface FlowState {
  // Flow data
  flowId: string | null;
  flowName: string;
  nodes: Node<FlowNodeData>[];
  edges: Edge[];

  // Selection
  selectedNode: Node<FlowNodeData> | null;
  selectedEdge: Edge | null;

  // Execution state
  executingNodeId: string | null;
  isRunning: boolean;

  // Actions
  setFlowId: (id: string | null) => void;
  setFlowName: (name: string) => void;
  setNodes: (nodes: Node<FlowNodeData>[]) => void;
  setEdges: (edges: Edge[]) => void;
  onNodesChange: (changes: NodeChange[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onConnect: (connection: Connection) => void;
  addNode: (template: NodeTemplate, position: { x: number; y: number }) => void;
  updateNodeData: (nodeId: string, data: Partial<FlowNodeData>) => void;
  deleteNode: (nodeId: string) => void;
  deleteEdge: (edgeId: string) => void;
  setSelectedNode: (node: Node<FlowNodeData> | null) => void;
  setSelectedEdge: (edge: Edge | null) => void;
  setExecutingNodeId: (nodeId: string | null) => void;
  setIsRunning: (running: boolean) => void;
  loadFlow: (flow: VisualFlow) => void;
  getFlow: () => VisualFlow;
  clearFlow: () => void;
}

let nodeIdCounter = 0;

export const useFlowStore = create<FlowState>((set, get) => ({
  // Initial state
  flowId: null,
  flowName: 'Untitled Flow',
  nodes: [],
  edges: [],
  selectedNode: null,
  selectedEdge: null,
  executingNodeId: null,
  isRunning: false,

  // Setters
  setFlowId: (id) => set({ flowId: id }),
  setFlowName: (name) => set({ flowName: name }),
  setNodes: (nodes) => set({ nodes }),
  setEdges: (edges) => set({ edges }),

  // React Flow change handlers
  onNodesChange: (changes) => {
    set({
      nodes: applyNodeChanges(changes, get().nodes),
    });
  },

  onEdgesChange: (changes) => {
    set({
      edges: applyEdgeChanges(changes, get().edges),
    });
  },

  onConnect: (connection) => {
    const newEdge = {
      ...connection,
      id: `edge-${Date.now()}`,
      animated: connection.sourceHandle === 'exec-out',
    };
    set({
      edges: addEdge(newEdge, get().edges),
    });
  },

  // Add a new node
  addNode: (template, position) => {
    const id = `node-${++nodeIdCounter}`;
    const data = createNodeData(template);

    const newNode: Node<FlowNodeData> = {
      id,
      type: 'custom',
      position,
      data,
    };

    set({
      nodes: [...get().nodes, newNode],
    });
  },

  // Update node data
  updateNodeData: (nodeId, data) => {
    const state = get();
    const updatedNodes = state.nodes.map((node) =>
      node.id === nodeId
        ? { ...node, data: { ...node.data, ...data } }
        : node
    );

    // Also update selectedNode if it's the one being updated
    const updatedSelectedNode =
      state.selectedNode?.id === nodeId
        ? updatedNodes.find((n) => n.id === nodeId) || null
        : state.selectedNode;

    set({
      nodes: updatedNodes,
      selectedNode: updatedSelectedNode,
    });
  },

  // Delete a node
  deleteNode: (nodeId) => {
    set({
      nodes: get().nodes.filter((n) => n.id !== nodeId),
      edges: get().edges.filter(
        (e) => e.source !== nodeId && e.target !== nodeId
      ),
      selectedNode:
        get().selectedNode?.id === nodeId ? null : get().selectedNode,
    });
  },

  // Delete an edge
  deleteEdge: (edgeId) => {
    set({
      edges: get().edges.filter((e) => e.id !== edgeId),
      selectedEdge:
        get().selectedEdge?.id === edgeId ? null : get().selectedEdge,
    });
  },

  // Selection
  setSelectedNode: (node) => set({ selectedNode: node, selectedEdge: null }),
  setSelectedEdge: (edge) => set({ selectedEdge: edge, selectedNode: null }),

  // Execution state
  setExecutingNodeId: (nodeId) => set({ executingNodeId: nodeId }),
  setIsRunning: (running) =>
    set({ isRunning: running, executingNodeId: running ? null : null }),

  // Load a flow from API
  loadFlow: (flow) => {
    const nodes: Node<FlowNodeData>[] = flow.nodes.map((vn) => {
      const template = getNodeTemplate(vn.type);
      const data: FlowNodeData = template
        ? { ...createNodeData(template), ...vn.data }
        : (vn.data as FlowNodeData);

      return {
        id: vn.id,
        type: 'custom',
        position: vn.position,
        data,
      };
    });

    const edges: Edge[] = flow.edges.map((ve) => ({
      id: ve.id,
      source: ve.source,
      sourceHandle: ve.sourceHandle,
      target: ve.target,
      targetHandle: ve.targetHandle,
      animated: ve.animated ?? ve.sourceHandle === 'exec-out',
    }));

    set({
      flowId: flow.id,
      flowName: flow.name,
      nodes,
      edges,
      selectedNode: null,
      selectedEdge: null,
    });
  },

  // Get flow for saving
  getFlow: (): VisualFlow => {
    const state = get();

    // Find entry node: node with no incoming execution edges
    const execTargets = new Set(
      state.edges
        .filter((e) => e.targetHandle === 'exec-in')
        .map((e) => e.target)
    );
    const entryNode = state.nodes.find((n) => !execTargets.has(n.id))?.id;

    return {
      id: state.flowId || `flow-${Date.now()}`,
      name: state.flowName,
      nodes: state.nodes.map((n) => ({
        id: n.id,
        type: n.data.nodeType,
        position: n.position,
        data: n.data,
      })),
      edges: state.edges.map((e) => ({
        id: e.id,
        source: e.source,
        sourceHandle: e.sourceHandle || '',
        target: e.target,
        targetHandle: e.targetHandle || '',
        animated: e.animated,
      })),
      entryNode,
    };
  },

  // Clear the flow
  clearFlow: () => {
    set({
      flowId: null,
      flowName: 'Untitled Flow',
      nodes: [],
      edges: [],
      selectedNode: null,
      selectedEdge: null,
    });
    nodeIdCounter = 0;
  },
}));
