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
  disconnectPin: (nodeId: string, handleId: string, isInput: boolean) => void;
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
    const state = get();
    const removedNodeIds = changes
      .filter((c) => c.type === 'remove')
      .map((c) => c.id);

    const updatedNodes = applyNodeChanges(changes, state.nodes);

    if (removedNodeIds.length === 0) {
      set({ nodes: updatedNodes });
      return;
    }

    const removed = new Set(removedNodeIds);
    const remainingEdges = state.edges.filter(
      (e) => !removed.has(e.source) && !removed.has(e.target)
    );

    const selectedNode =
      state.selectedNode && removed.has(state.selectedNode.id)
        ? null
        : state.selectedNode;

    const selectedEdge =
      state.selectedEdge &&
      !remainingEdges.some((e) => e.id === state.selectedEdge?.id)
        ? null
        : state.selectedEdge;

    set({
      nodes: updatedNodes,
      edges: remainingEdges,
      selectedNode,
      selectedEdge,
    });
  },

  onEdgesChange: (changes) => {
    const state = get();
    const removedEdgeIds = changes
      .filter((c) => c.type === 'remove')
      .map((c) => c.id);

    const updatedEdges = applyEdgeChanges(changes, state.edges);

    if (removedEdgeIds.length === 0) {
      set({ edges: updatedEdges });
      return;
    }

    const removed = new Set(removedEdgeIds);
    const selectedEdge =
      state.selectedEdge && removed.has(state.selectedEdge.id)
        ? null
        : state.selectedEdge;

    set({
      edges: updatedEdges,
      selectedEdge,
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
    const existingNode = state.nodes.find((n) => n.id === nodeId);
    const nextData = existingNode ? { ...existingNode.data, ...data } : undefined;

    const removedInputHandles = new Set<string>();
    const removedOutputHandles = new Set<string>();

    if (existingNode && nextData) {
      if (data.inputs) {
        const prev = existingNode.data.inputs.map((p) => p.id);
        const next = nextData.inputs.map((p) => p.id);
        for (const id of prev) {
          if (!next.includes(id)) removedInputHandles.add(id);
        }
      }
      if (data.outputs) {
        const prev = existingNode.data.outputs.map((p) => p.id);
        const next = nextData.outputs.map((p) => p.id);
        for (const id of prev) {
          if (!next.includes(id)) removedOutputHandles.add(id);
        }
      }
    }

    const updatedNodes = state.nodes.map((node) =>
      node.id === nodeId
        ? { ...node, data: { ...node.data, ...data } }
        : node
    );

    const removedEdges = state.edges.filter((e) => {
      if (removedInputHandles.size > 0 && e.target === nodeId && removedInputHandles.has(e.targetHandle || '')) {
        return true;
      }
      if (removedOutputHandles.size > 0 && e.source === nodeId && removedOutputHandles.has(e.sourceHandle || '')) {
        return true;
      }
      return false;
    });

    const remainingEdges =
      removedEdges.length > 0 ? state.edges.filter((e) => !removedEdges.includes(e)) : state.edges;

    // Also update selectedNode if it's the one being updated
    const updatedSelectedNode =
      state.selectedNode?.id === nodeId
        ? updatedNodes.find((n) => n.id === nodeId) || null
        : state.selectedNode;

    set({
      nodes: updatedNodes,
      edges: remainingEdges,
      selectedNode: updatedSelectedNode,
      selectedEdge:
        removedEdges.length > 0 && state.selectedEdge && removedEdges.some((e) => e.id === state.selectedEdge?.id)
          ? null
          : state.selectedEdge,
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

  // Disconnect edges attached to a specific pin (handle)
  disconnectPin: (nodeId, handleId, isInput) => {
    const state = get();
    const matches = (e: Edge) =>
      isInput
        ? e.target === nodeId && e.targetHandle === handleId
        : e.source === nodeId && e.sourceHandle === handleId;

    const removed = state.edges.filter(matches);
    if (removed.length === 0) return;

    const remaining = state.edges.filter((e) => !matches(e));
    const selectedEdgeId = state.selectedEdge?.id || null;
    const clearedSelectedEdge =
      selectedEdgeId && removed.some((e) => e.id === selectedEdgeId) ? null : state.selectedEdge;

    set({
      edges: remaining,
      selectedEdge: clearedSelectedEdge,
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

    // Ensure newly added nodes get unique ids after load/import.
    // Node ids are generated as `node-{n}`.
    let maxNodeId = 0;
    for (const vn of flow.nodes) {
      const m = /^node-(\d+)$/.exec(vn.id);
      if (m) {
        const n = Number(m[1]);
        if (Number.isFinite(n) && n > maxNodeId) maxNodeId = n;
      }
    }
    nodeIdCounter = maxNodeId;

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
