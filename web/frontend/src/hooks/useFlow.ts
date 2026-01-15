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
import type { FlowNodeData, VisualFlow, Pin, JsonValue } from '../types/flow';
import { createNodeData, getNodeTemplate, mergePinDocsFromTemplate, NodeTemplate } from '../types/nodes';
import { validateConnection } from '../utils/validation';

interface FlowState {
  // Flow data
  flowId: string | null;
  flowName: string;
  flowInterfaces: string[];
  nodes: Node<FlowNodeData>[];
  edges: Edge[];

  // Selection
  selectedNode: Node<FlowNodeData> | null;
  selectedEdge: Edge | null;

  // Execution state
  executingNodeId: string | null;
  isRunning: boolean;
  // Execution observability (visual “afterglow” + progress)
  recentNodeIds: Record<string, true>;
  recentEdgeIds: Record<string, true>;
  loopProgressByNodeId: Record<string, { index: number; total: number }>;
  lastLoopProgress: { nodeId: string; index: number; total: number } | null;

  // Preflight validation (before starting a run)
  preflightIssues: Array<{ id: string; nodeId: string; nodeLabel: string; message: string }>;

  // Editor clipboard (nodes only; edges are intentionally excluded)
  clipboard: NodeClipboard | null;
  clipboardPasteCount: number;

  // Actions
  setFlowId: (id: string | null) => void;
  setFlowName: (name: string) => void;
  setFlowInterfaces: (interfaces: string[]) => void;
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
  copySelectionToClipboard: () => number;
  pasteClipboard: () => number;
  duplicateSelection: () => number;
  setExecutingNodeId: (nodeId: string | null) => void;
  setIsRunning: (running: boolean) => void;
  resetExecutionDecorations: () => void;
  markRecentNode: (nodeId: string) => void;
  unmarkRecentNode: (nodeId: string) => void;
  markRecentEdge: (edgeId: string) => void;
  unmarkRecentEdge: (edgeId: string) => void;
  setLoopProgress: (nodeId: string, index: number, total: number) => void;
  setPreflightIssues: (issues: Array<{ id: string; nodeId: string; nodeLabel: string; message: string }>) => void;
  clearPreflightIssues: () => void;
  loadFlow: (flow: VisualFlow) => void;
  getFlow: () => VisualFlow;
  clearFlow: () => void;
}

let nodeIdCounter = 0;

type Point = { x: number; y: number };

interface NodeClipboardItem {
  type: string;
  data: FlowNodeData;
  relPosition: Point;
}

interface NodeClipboard {
  origin: Point;
  items: NodeClipboardItem[];
  ts: number;
}

const DEFAULT_CLONE_OFFSET: Point = { x: 40, y: 40 };

function deepClone<T>(value: T): T {
  // Flow node data is expected to be JSON-serializable. Prefer structuredClone if available.
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sc = (globalThis as any).structuredClone as ((v: unknown) => unknown) | undefined;
    if (typeof sc === 'function') return sc(value) as T;
  } catch {
    // fall through
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

function isNodeSelected(node: Node<FlowNodeData>): boolean {
  return Boolean(node.selected);
}

function getSelection(state: Pick<FlowState, 'nodes' | 'selectedNode'>): Node<FlowNodeData>[] {
  const selected = state.nodes.filter(isNodeSelected);
  if (selected.length > 0) return selected;
  if (state.selectedNode) {
    const byId = state.nodes.find((n) => n.id === state.selectedNode?.id);
    return byId ? [byId] : [state.selectedNode];
  }
  return [];
}

function getBounds(nodes: Node<FlowNodeData>[]): { minX: number; minY: number } {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  for (const n of nodes) {
    minX = Math.min(minX, n.position.x);
    minY = Math.min(minY, n.position.y);
  }
  if (!Number.isFinite(minX)) minX = 0;
  if (!Number.isFinite(minY)) minY = 0;
  return { minX, minY };
}

export const useFlowStore = create<FlowState>((set, get) => ({
  // Initial state
  flowId: null,
  flowName: 'Untitled Flow',
  flowInterfaces: [],
  nodes: [],
  edges: [],
  selectedNode: null,
  selectedEdge: null,
  executingNodeId: null,
  isRunning: false,
  recentNodeIds: {},
  recentEdgeIds: {},
  loopProgressByNodeId: {},
  lastLoopProgress: null,
  preflightIssues: [],
  clipboard: null,
  clipboardPasteCount: 0,

  // Setters
  setFlowId: (id) => set({ flowId: id }),
  setFlowName: (name) => set({ flowName: name }),
  setFlowInterfaces: (interfaces) => set({ flowInterfaces: Array.isArray(interfaces) ? interfaces : [] }),
  setNodes: (nodes) => set({ nodes }),
  setEdges: (edges) => set({ edges }),

  // React Flow change handlers
  onNodesChange: (changes) => {
    const state = get();
    const removedNodeIds = changes
      .filter((c) => c.type === 'remove')
      .map((c) => c.id);

    const updatedNodes = applyNodeChanges(changes, state.nodes);

    // Keep PropertiesPanel selection in sync with ReactFlow's `node.selected` flags.
    // This avoids "double click to select" glitches when a click becomes a tiny drag,
    // or when selection happens through handles/marquee instead of onNodeClick.
    const selectedNodes = updatedNodes.filter((n) => Boolean(n.selected));
    let lastSelectedId: string | null = null;
    for (const c of changes) {
      if (c.type === 'select' && (c as any).selected) lastSelectedId = c.id;
    }

    const nextSelectedNode = (() => {
      if (lastSelectedId) return updatedNodes.find((n) => n.id === lastSelectedId) || null;
      if (selectedNodes.length === 0) return null;
      const curId = state.selectedNode?.id;
      if (curId && selectedNodes.some((n) => n.id === curId)) {
        return updatedNodes.find((n) => n.id === curId) || selectedNodes[selectedNodes.length - 1] || null;
      }
      return selectedNodes[selectedNodes.length - 1] || null;
    })();

    if (removedNodeIds.length === 0) {
      set({
        nodes: updatedNodes,
        selectedNode: nextSelectedNode,
        // Clear edge selection when a node is selected; otherwise preserve.
        selectedEdge: nextSelectedNode ? null : state.selectedEdge,
      });
      return;
    }

    const removed = new Set(removedNodeIds);
    const remainingEdges = state.edges.filter(
      (e) => !removed.has(e.source) && !removed.has(e.target)
    );

    const selectedNode = nextSelectedNode && removed.has(nextSelectedNode.id) ? null : nextSelectedNode;

    const selectedEdge =
      (selectedNode ? null : state.selectedEdge) &&
      !remainingEdges.some((e) => e.id === state.selectedEdge?.id)
        ? null
        : (selectedNode ? null : state.selectedEdge);

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

    // Keep PropertiesPanel selection in sync with ReactFlow's `edge.selected` flags.
    const selectedEdges = updatedEdges.filter((e) => Boolean((e as any).selected));
    let lastSelectedEdgeId: string | null = null;
    for (const c of changes) {
      if (c.type === 'select' && (c as any).selected) lastSelectedEdgeId = c.id;
    }

    const nextSelectedEdge = (() => {
      if (lastSelectedEdgeId) return updatedEdges.find((e) => e.id === lastSelectedEdgeId) || null;
      if (selectedEdges.length === 0) return null;
      const curId = state.selectedEdge?.id;
      if (curId && selectedEdges.some((e) => e.id === curId)) {
        return updatedEdges.find((e) => e.id === curId) || selectedEdges[selectedEdges.length - 1] || null;
      }
      return selectedEdges[selectedEdges.length - 1] || null;
    })();

    if (removedEdgeIds.length === 0) {
      set({
        edges: updatedEdges,
        selectedEdge: nextSelectedEdge,
        // Clear node selection when an edge is selected; otherwise preserve.
        selectedNode: nextSelectedEdge ? null : state.selectedNode,
      });
      return;
    }

    const removed = new Set(removedEdgeIds);
    const selectedEdge =
      nextSelectedEdge && removed.has(nextSelectedEdge.id) ? null : nextSelectedEdge;

    set({
      edges: updatedEdges,
      selectedEdge,
    });
  },

  onConnect: (connection) => {
    const state = get();
    if (!validateConnection(state.nodes, state.edges, connection)) return;

    const sourceNode = state.nodes.find((n) => n.id === connection.source);
    const sourcePin = sourceNode?.data.outputs.find((p) => p.id === connection.sourceHandle);
    const animated = sourcePin?.type === 'execution';

    const newEdge = {
      ...connection,
      id: `edge-${Date.now()}`,
      animated,
    };

    set({
      edges: addEdge(newEdge, state.edges),
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

  copySelectionToClipboard: () => {
    const state = get();
    const selected = getSelection(state);
    if (selected.length === 0) return 0;

    const { minX, minY } = getBounds(selected);
    const items: NodeClipboardItem[] = selected.map((n) => ({
      type: n.type || 'custom',
      data: deepClone(n.data),
      relPosition: { x: n.position.x - minX, y: n.position.y - minY },
    }));

    set({
      clipboard: {
        origin: { x: minX, y: minY },
        items,
        ts: Date.now(),
      },
      clipboardPasteCount: 0,
    });
    return items.length;
  },

  pasteClipboard: () => {
    const state = get();
    const clipboard = state.clipboard;
    if (!clipboard || clipboard.items.length === 0) return 0;

    const pasteIdx = (state.clipboardPasteCount || 0) + 1;
    const dx = DEFAULT_CLONE_OFFSET.x * pasteIdx;
    const dy = DEFAULT_CLONE_OFFSET.y * pasteIdx;
    const origin = { x: clipboard.origin.x + dx, y: clipboard.origin.y + dy };

    const newNodes = clipboard.items.map((item) => {
      const id = `node-${++nodeIdCounter}`;
      return {
        id,
        type: item.type,
        position: { x: origin.x + item.relPosition.x, y: origin.y + item.relPosition.y },
        data: deepClone(item.data),
        selected: true,
      } as Node<FlowNodeData>;
    });

    const deselectedExisting = state.nodes.map((n) => (n.selected ? { ...n, selected: false } : n));
    const last = newNodes[newNodes.length - 1] || null;

    set({
      nodes: [...deselectedExisting, ...newNodes],
      selectedNode: last,
      selectedEdge: null,
      clipboardPasteCount: pasteIdx,
    });
    return newNodes.length;
  },

  duplicateSelection: () => {
    const state = get();
    const selected = getSelection(state);
    if (selected.length === 0) return 0;

    const newNodes = selected.map((n) => {
      const id = `node-${++nodeIdCounter}`;
      return {
        id,
        type: n.type || 'custom',
        position: { x: n.position.x + DEFAULT_CLONE_OFFSET.x, y: n.position.y + DEFAULT_CLONE_OFFSET.y },
        data: deepClone(n.data),
        selected: true,
      } as Node<FlowNodeData>;
    });

    const deselectedExisting = state.nodes.map((n) => (n.selected ? { ...n, selected: false } : n));
    const last = newNodes[newNodes.length - 1] || null;

    set({
      nodes: [...deselectedExisting, ...newNodes],
      selectedNode: last,
      selectedEdge: null,
    });
    return newNodes.length;
  },

  // Execution state
  setExecutingNodeId: (nodeId) => set({ executingNodeId: nodeId }),
  setIsRunning: (running) =>
    set({ isRunning: running, executingNodeId: running ? null : null }),
  resetExecutionDecorations: () =>
    set({
      recentNodeIds: {},
      recentEdgeIds: {},
      loopProgressByNodeId: {},
      lastLoopProgress: null,
    }),
  markRecentNode: (nodeId) =>
    set((s) => (nodeId ? { recentNodeIds: { ...s.recentNodeIds, [nodeId]: true } } : s)),
  unmarkRecentNode: (nodeId) =>
    set((s) => {
      if (!nodeId || !s.recentNodeIds[nodeId]) return s;
      const next = { ...s.recentNodeIds };
      delete next[nodeId];
      return { recentNodeIds: next };
    }),
  markRecentEdge: (edgeId) =>
    set((s) => (edgeId ? { recentEdgeIds: { ...s.recentEdgeIds, [edgeId]: true } } : s)),
  unmarkRecentEdge: (edgeId) =>
    set((s) => {
      if (!edgeId || !s.recentEdgeIds[edgeId]) return s;
      const next = { ...s.recentEdgeIds };
      delete next[edgeId];
      return { recentEdgeIds: next };
    }),
  setLoopProgress: (nodeId, index, total) =>
    set((s) => {
      if (!nodeId) return s;
      const next = { ...s.loopProgressByNodeId, [nodeId]: { index, total } };
      return { loopProgressByNodeId: next, lastLoopProgress: { nodeId, index, total } };
    }),

  setPreflightIssues: (issues) => set({ preflightIssues: Array.isArray(issues) ? issues : [] }),
  clearPreflightIssues: () => set({ preflightIssues: [] }),

  // Load a flow from API
  loadFlow: (flow) => {
    const nodes: Node<FlowNodeData>[] = flow.nodes.map((vn) => {
      const template = getNodeTemplate(vn.type);
      let data: FlowNodeData = template
        ? { ...createNodeData(template), ...vn.data }
        : (vn.data as FlowNodeData);

      // Backward-compat + canonical ordering for Agent and LLM Call nodes.
      // Pins are addressable by id (edges), so reordering is safe.
      if (data.nodeType === 'agent' || data.nodeType === 'llm_call') {
        const existingInputs = Array.isArray(data.inputs) ? data.inputs : [];
        const byId = new Map(existingInputs.map((p) => [p.id, p] as const));
        const used = new Set<string>();

        const want = (pin: Pin): Pin => {
          const prev = byId.get(pin.id);
          used.add(pin.id);
          if (!prev) return pin;
          if (prev.label === pin.label && prev.type === pin.type) return prev;
          return { ...prev, label: pin.label, type: pin.type };
        };

        const execIn = want({ id: 'exec-in', label: '', type: 'execution' });

        const canonicalInputs: Pin[] =
          data.nodeType === 'llm_call'
            ? [
                execIn,
                want({ id: 'include_context', label: 'use_context', type: 'boolean' }),
                want({ id: 'max_input_tokens', label: 'max_input_tokens', type: 'number' }),
                want({ id: 'provider', label: 'provider', type: 'provider' }),
                want({ id: 'model', label: 'model', type: 'model' }),
                want({ id: 'temperature', label: 'temperature', type: 'number' }),
                want({ id: 'seed', label: 'seed', type: 'number' }),
                want({ id: 'system', label: 'system', type: 'string' }),
                want({ id: 'prompt', label: 'prompt', type: 'string' }),
                want({ id: 'tools', label: 'tools', type: 'tools' }),
                want({ id: 'response_schema', label: 'structured_output', type: 'object' }),
              ]
            : [
                execIn,
                want({ id: 'include_context', label: 'use_context', type: 'boolean' }),
                want({ id: 'provider', label: 'provider', type: 'provider' }),
                want({ id: 'model', label: 'model', type: 'model' }),
                want({ id: 'temperature', label: 'temperature', type: 'number' }),
                want({ id: 'seed', label: 'seed', type: 'number' }),
                want({ id: 'max_iterations', label: 'max_iterations', type: 'number' }),
                want({ id: 'max_input_tokens', label: 'max_input_tokens', type: 'number' }),
                want({ id: 'system', label: 'system', type: 'string' }),
                want({ id: 'task', label: 'prompt', type: 'string' }),
                want({ id: 'tools', label: 'tools', type: 'tools' }),
                want({ id: 'response_schema', label: 'structured_output', type: 'object' }),
                want({ id: 'context', label: 'context', type: 'object' }),
              ];

        // Drop truly deprecated pins (kept for backward compat in old flows).
        // - `write_context` was an experimental feature and is not part of the durable contract.
        const dropIds = data.nodeType === 'llm_call' ? new Set(['write_context', 'writeContext']) : new Set<string>();
        const extras = existingInputs.filter((p) => !used.has(p.id) && !dropIds.has(p.id));
        data = { ...data, inputs: [...canonicalInputs, ...extras] };

        // Canonical ordering for Agent output pins.
        // Pins are addressable by id (edges), so reordering is safe.
        if (data.nodeType === 'agent') {
          const existingOutputs = Array.isArray(data.outputs) ? data.outputs : [];
          const byOutId = new Map(existingOutputs.map((p) => [p.id, p] as const));
          const usedOut = new Set<string>();

          const wantOut = (pin: Pin): Pin => {
            const prev = byOutId.get(pin.id);
            usedOut.add(pin.id);
            if (!prev) return pin;
            if (prev.label === pin.label && prev.type === pin.type) return prev;
            return { ...prev, label: pin.label, type: pin.type };
          };

          const execOut = wantOut({ id: 'exec-out', label: '', type: 'execution' });
          const canonicalOutputs: Pin[] = [
            execOut,
            wantOut({ id: 'response', label: 'response', type: 'string' }),
            wantOut({ id: 'meta', label: 'meta', type: 'object' }),
            wantOut({ id: 'scratchpad', label: 'scratchpad', type: 'object' }),
            wantOut({ id: 'result', label: 'result', type: 'object' }),
          ];

          const extraOutputs = existingOutputs.filter((p) => !usedOut.has(p.id));
          data = { ...data, outputs: [...canonicalOutputs, ...extraOutputs] };
        }

        // Migration: legacy config booleans -> pinDefaults
        //
        // These booleans are now represented as *input pins* so they can be driven by the graph
        // (programmatic control) and still edited via the pin-default checkbox when unconnected.
        //
        // Older flows may have stored the value inside agentConfig/effectConfig. If we don't
        // migrate it, the UI would show an unchecked pin (default false) while execution would
        // still follow the legacy config (surprising and unsafe).
        const prevDefaults = data.pinDefaults && typeof data.pinDefaults === 'object' ? data.pinDefaults : undefined;
        const nextDefaults: Record<string, JsonValue> = { ...(prevDefaults || {}) };

        if (data.nodeType === 'llm_call') {
          const cfg = data.effectConfig && typeof data.effectConfig === 'object' ? (data.effectConfig as any) : null;
          const legacy =
            cfg && typeof cfg.include_context === 'boolean'
              ? cfg.include_context
              : cfg && typeof cfg.use_context === 'boolean'
                ? cfg.use_context
                : cfg && typeof cfg.useContext === 'boolean'
                  ? cfg.useContext
                  : undefined;
          if (typeof nextDefaults.include_context !== 'boolean' && typeof legacy === 'boolean') {
            nextDefaults.include_context = legacy;
          }
          if (cfg && ('include_context' in cfg || 'use_context' in cfg || 'useContext' in cfg)) {
            // Remove legacy key to keep a single source of truth (pinDefaults).
            const { include_context, use_context, useContext, ...rest } = cfg;
            data = { ...data, effectConfig: rest, pinDefaults: nextDefaults };
          } else if (prevDefaults !== nextDefaults) {
            data = { ...data, pinDefaults: nextDefaults };
          }
        } else {
          const cfg = data.agentConfig && typeof data.agentConfig === 'object' ? (data.agentConfig as any) : null;
          const legacy =
            cfg && typeof cfg.include_context === 'boolean'
              ? cfg.include_context
              : cfg && typeof cfg.use_context === 'boolean'
                ? cfg.use_context
                : cfg && typeof cfg.useContext === 'boolean'
                  ? cfg.useContext
                  : undefined;
          if (typeof nextDefaults.include_context !== 'boolean' && typeof legacy === 'boolean') {
            nextDefaults.include_context = legacy;
          }
          if (cfg && ('include_context' in cfg || 'use_context' in cfg || 'useContext' in cfg)) {
            const { include_context, use_context, useContext, ...rest } = cfg;
            data = { ...data, agentConfig: rest, pinDefaults: nextDefaults };
          } else if (prevDefaults !== nextDefaults) {
            data = { ...data, pinDefaults: nextDefaults };
          }
        }
      }

      // Backward-compat + canonical ordering for Subflow nodes.
      // Add the inherit_context pin (default false via node config) so it can be driven via data edges.
      if (data.nodeType === 'subflow') {
        const existingInputs = Array.isArray(data.inputs) ? data.inputs : [];
        const byId = new Map(existingInputs.map((p) => [p.id, p] as const));
        const used = new Set<string>();

        const want = (pin: Pin): Pin => {
          const prev = byId.get(pin.id);
          used.add(pin.id);
          if (!prev) return pin;
          if (prev.label === pin.label && prev.type === pin.type) return prev;
          return { ...prev, label: pin.label, type: pin.type };
        };

        const canonicalInputs: Pin[] = [
          want({ id: 'exec-in', label: '', type: 'execution' }),
          want({ id: 'inherit_context', label: 'inherit_context', type: 'boolean' }),
          want({ id: 'input', label: 'input', type: 'object' }),
        ];

        const extras = existingInputs.filter((p) => !used.has(p.id));
        data = { ...data, inputs: [...canonicalInputs, ...extras] };

        // Migration: legacy effectConfig.inherit_context -> pinDefaults.inherit_context
        const prevDefaults = data.pinDefaults && typeof data.pinDefaults === 'object' ? data.pinDefaults : undefined;
        const nextDefaults: Record<string, JsonValue> = { ...(prevDefaults || {}) };
        const cfg = data.effectConfig && typeof data.effectConfig === 'object' ? (data.effectConfig as any) : null;
        const legacy =
          cfg && typeof cfg.inherit_context === 'boolean'
            ? cfg.inherit_context
            : cfg && typeof cfg.inheritContext === 'boolean'
              ? cfg.inheritContext
              : undefined;
        if (typeof nextDefaults.inherit_context !== 'boolean' && typeof legacy === 'boolean') {
          nextDefaults.inherit_context = legacy;
        }
        if (cfg && ('inherit_context' in cfg || 'inheritContext' in cfg)) {
          const { inherit_context, inheritContext, ...rest } = cfg;
          data = { ...data, effectConfig: rest, pinDefaults: nextDefaults };
        } else if (prevDefaults !== nextDefaults) {
          data = { ...data, pinDefaults: nextDefaults };
        }
      }

      // Backward-compat + canonical ordering for durable custom event nodes.
      if (data.nodeType === 'emit_event' || data.nodeType === 'on_event') {
        const existingInputs = Array.isArray(data.inputs) ? data.inputs : [];
        const byId = new Map(existingInputs.map((p) => [p.id, p] as const));
        const used = new Set<string>();

        const want = (pin: Pin): Pin => {
          const prev = byId.get(pin.id);
          used.add(pin.id);
          if (!prev) return pin;
          if (prev.label === pin.label && prev.type === pin.type) return prev;
          return { ...prev, label: pin.label, type: pin.type };
        };

        const canonicalInputs: Pin[] =
          data.nodeType === 'emit_event'
            ? [
                want({ id: 'exec-in', label: '', type: 'execution' }),
                want({ id: 'name', label: 'name', type: 'string' }),
                want({ id: 'scope', label: 'scope', type: 'string' }),
                want({ id: 'payload', label: 'payload', type: 'any' }),
                want({ id: 'session_id', label: 'session_id', type: 'string' }),
              ]
            : [
                want({ id: 'scope', label: 'scope', type: 'string' }),
              ];

        const extras = existingInputs.filter((p) => !used.has(p.id));
        data = { ...data, inputs: [...canonicalInputs, ...extras] };
      }

      // Backward-compat + canonical ordering for memory nodes.
      //
      // Keep pins addressable by id (edges), so reordering/adding pins is safe.
      if (
        data.nodeType === 'memory_note' ||
        data.nodeType === 'memory_query' ||
        data.nodeType === 'memory_tag' ||
        data.nodeType === 'memory_compact' ||
        data.nodeType === 'memory_rehydrate' ||
        data.nodeType === 'memory_kg_assert' ||
        data.nodeType === 'memory_kg_query'
      ) {
        const existingInputs = Array.isArray(data.inputs) ? data.inputs : [];
        const byInputId = new Map(existingInputs.map((p) => [p.id, p] as const));
        const usedInputs = new Set<string>();

        const wantInput = (pin: Pin): Pin => {
          const prev = byInputId.get(pin.id);
          usedInputs.add(pin.id);
          if (!prev) return pin;
          if (prev.label === pin.label && prev.type === pin.type) return prev;
          return { ...prev, label: pin.label, type: pin.type };
        };

        const canonicalInputs: Pin[] =
          data.nodeType === 'memory_note'
            ? [
                wantInput({ id: 'exec-in', label: '', type: 'execution' }),
                wantInput({ id: 'keep_in_context', label: 'in_context', type: 'boolean' }),
                wantInput({ id: 'scope', label: 'scope', type: 'string' }),
                wantInput({ id: 'content', label: 'content', type: 'string' }),
                wantInput({ id: 'location', label: 'location', type: 'string' }),
                wantInput({ id: 'tags', label: 'tags', type: 'object' }),
                wantInput({ id: 'sources', label: 'sources', type: 'object' }),
              ]
            : data.nodeType === 'memory_query'
              ? [
                  wantInput({ id: 'exec-in', label: '', type: 'execution' }),
                  wantInput({ id: 'query', label: 'query', type: 'string' }),
                  wantInput({ id: 'limit', label: 'limit', type: 'number' }),
                  wantInput({ id: 'tags', label: 'tags', type: 'object' }),
                  wantInput({ id: 'tags_mode', label: 'tags_mode', type: 'string' }),
                  wantInput({ id: 'usernames', label: 'usernames', type: 'array' }),
                  wantInput({ id: 'locations', label: 'locations', type: 'array' }),
                  wantInput({ id: 'since', label: 'since', type: 'string' }),
                  wantInput({ id: 'until', label: 'until', type: 'string' }),
                  wantInput({ id: 'scope', label: 'scope', type: 'string' }),
                ]
              : data.nodeType === 'memory_tag'
                ? [
                    wantInput({ id: 'exec-in', label: '', type: 'execution' }),
                    wantInput({ id: 'span_id', label: 'span_id', type: 'string' }),
                    wantInput({ id: 'scope', label: 'scope', type: 'string' }),
                    wantInput({ id: 'tags', label: 'tags', type: 'object' }),
                    wantInput({ id: 'merge', label: 'merge', type: 'boolean' }),
                  ]
              : data.nodeType === 'memory_compact'
                  ? [
                      wantInput({ id: 'exec-in', label: '', type: 'execution' }),
                      wantInput({ id: 'preserve_recent', label: 'preserve_recent', type: 'number' }),
                      wantInput({ id: 'compression_mode', label: 'compression_mode', type: 'string' }),
                      wantInput({ id: 'focus', label: 'focus', type: 'string' }),
                    ]
                  : data.nodeType === 'memory_rehydrate'
                    ? [
                        wantInput({ id: 'exec-in', label: '', type: 'execution' }),
                        wantInput({ id: 'span_ids', label: 'span_ids', type: 'array' }),
                        wantInput({ id: 'placement', label: 'placement', type: 'string' }),
                        wantInput({ id: 'max_messages', label: 'max_messages', type: 'number' }),
                      ]
                    : data.nodeType === 'memory_kg_assert'
                      ? [
                          wantInput({ id: 'exec-in', label: '', type: 'execution' }),
                          wantInput({ id: 'assertions', label: 'assertions', type: 'array' }),
                          wantInput({ id: 'scope', label: 'scope', type: 'string' }),
                          wantInput({ id: 'span_id', label: 'span_id', type: 'string' }),
                          wantInput({ id: 'owner_id', label: 'owner_id', type: 'string' }),
                        ]
                      : [
                          wantInput({ id: 'exec-in', label: '', type: 'execution' }),
                          wantInput({ id: 'query_text', label: 'query_text', type: 'string' }),
                          wantInput({ id: 'subject', label: 'subject', type: 'string' }),
                          wantInput({ id: 'predicate', label: 'predicate', type: 'string' }),
                          wantInput({ id: 'object', label: 'object', type: 'string' }),
                          wantInput({ id: 'since', label: 'since', type: 'string' }),
                          wantInput({ id: 'until', label: 'until', type: 'string' }),
                          wantInput({ id: 'active_at', label: 'active_at', type: 'string' }),
                          wantInput({ id: 'scope', label: 'scope', type: 'string' }),
                          wantInput({ id: 'owner_id', label: 'owner_id', type: 'string' }),
                          wantInput({ id: 'limit', label: 'limit', type: 'number' }),
                        ];

        const inputExtras = existingInputs.filter((p) => !usedInputs.has(p.id));

        const existingOutputs = Array.isArray(data.outputs) ? data.outputs : [];
        const byOutputId = new Map(existingOutputs.map((p) => [p.id, p] as const));
        const usedOutputs = new Set<string>();

        const wantOutput = (pin: Pin): Pin => {
          const prev = byOutputId.get(pin.id);
          usedOutputs.add(pin.id);
          if (!prev) return pin;
          if (prev.label === pin.label && prev.type === pin.type) return prev;
          return { ...prev, label: pin.label, type: pin.type };
        };

        const canonicalOutputs: Pin[] =
          data.nodeType === 'memory_note'
            ? [
                wantOutput({ id: 'exec-out', label: '', type: 'execution' }),
                wantOutput({ id: 'note_id', label: 'note_id', type: 'string' }),
              ]
            : data.nodeType === 'memory_query'
              ? [
                  wantOutput({ id: 'exec-out', label: '', type: 'execution' }),
                  wantOutput({ id: 'results', label: 'results', type: 'array' }),
                  wantOutput({ id: 'rendered', label: 'rendered', type: 'string' }),
                ]
              : data.nodeType === 'memory_tag'
                ? [
                    wantOutput({ id: 'exec-out', label: '', type: 'execution' }),
                    wantOutput({ id: 'success', label: 'success', type: 'boolean' }),
                    wantOutput({ id: 'rendered', label: 'rendered', type: 'string' }),
                  ]
                : data.nodeType === 'memory_compact'
                  ? [
                      wantOutput({ id: 'exec-out', label: '', type: 'execution' }),
                      wantOutput({ id: 'span_id', label: 'span_id', type: 'string' }),
                    ]
                  : data.nodeType === 'memory_rehydrate'
                    ? [
                        wantOutput({ id: 'exec-out', label: '', type: 'execution' }),
                        wantOutput({ id: 'inserted', label: 'inserted', type: 'number' }),
                        wantOutput({ id: 'skipped', label: 'skipped', type: 'number' }),
                      ]
                    : data.nodeType === 'memory_kg_assert'
                      ? [
                          wantOutput({ id: 'exec-out', label: '', type: 'execution' }),
                          wantOutput({ id: 'assertion_ids', label: 'assertion_ids', type: 'array' }),
                          wantOutput({ id: 'count', label: 'count', type: 'number' }),
                          wantOutput({ id: 'ok', label: 'ok', type: 'boolean' }),
                        ]
                      : [
                          wantOutput({ id: 'exec-out', label: '', type: 'execution' }),
                          wantOutput({ id: 'items', label: 'items', type: 'array' }),
                          wantOutput({ id: 'count', label: 'count', type: 'number' }),
                          wantOutput({ id: 'ok', label: 'ok', type: 'boolean' }),
                        ];

        const outputExtras = existingOutputs.filter((p) => !usedOutputs.has(p.id));

        // UX label migration (don’t stomp user-custom labels).
        //
        // We only update labels if they are empty OR still one of our historical defaults
        // (so user-renamed nodes stay user-renamed).
        const legacyLabels =
          data.nodeType === 'memory_note'
            ? new Set(['Add Note', 'Remember'])
            : data.nodeType === 'memory_query'
              ? new Set(['Query Memory'])
              : data.nodeType === 'memory_tag'
                ? new Set(['Tag Memory', 'Memory Tag'])
                : data.nodeType === 'memory_compact'
                  ? new Set(['Compact', 'Compaction'])
                  : data.nodeType === 'memory_rehydrate'
                    ? new Set(['Memory Rehydrate'])
                    : data.nodeType === 'memory_kg_assert'
                      ? new Set(['Memory KG Assert', 'KG Assert'])
                      : new Set(['Memory KG Query', 'KG Query']);
        if (template && typeof data.label === 'string') {
          const cur = data.label.trim();
          if (!cur || legacyLabels.has(cur)) {
            data = { ...data, label: template.label };
          }
        }

        data = { ...data, inputs: [...canonicalInputs, ...inputExtras], outputs: [...canonicalOutputs, ...outputExtras] };

        // Migration: legacy memory_note keep_in_context -> pinDefaults.keep_in_context
        if (data.nodeType === 'memory_note') {
          const prevDefaults = data.pinDefaults && typeof data.pinDefaults === 'object' ? data.pinDefaults : undefined;
          const nextDefaults: Record<string, JsonValue> = { ...(prevDefaults || {}) };
          const cfg = data.effectConfig && typeof data.effectConfig === 'object' ? (data.effectConfig as any) : null;
          const legacy =
            cfg && typeof cfg.keep_in_context === 'boolean'
              ? cfg.keep_in_context
              : cfg && typeof cfg.keepInContext === 'boolean'
                ? cfg.keepInContext
                : undefined;
          if (typeof nextDefaults.keep_in_context !== 'boolean' && typeof legacy === 'boolean') {
            nextDefaults.keep_in_context = legacy;
          }
          if (cfg && ('keep_in_context' in cfg || 'keepInContext' in cfg)) {
            const { keep_in_context, keepInContext, ...rest } = cfg;
            data = { ...data, effectConfig: rest, pinDefaults: nextDefaults };
          } else if (prevDefaults !== nextDefaults) {
            data = { ...data, pinDefaults: nextDefaults };
          }
        }
      }

      // Backward-compat: On Schedule pins (schedule/recurrent inputs, time output).
      if (data.nodeType === 'on_schedule') {
        const existingInputs = Array.isArray(data.inputs) ? data.inputs : [];
        const byInputId = new Map(existingInputs.map((p) => [p.id, p] as const));
        const usedInputs = new Set<string>();

        const wantInput = (pin: Pin): Pin => {
          const prev = byInputId.get(pin.id);
          usedInputs.add(pin.id);
          if (!prev) return pin;
          if (prev.label === pin.label && prev.type === pin.type) return prev;
          return { ...prev, label: pin.label, type: pin.type };
        };

        const canonicalInputs: Pin[] = [
          wantInput({ id: 'schedule', label: 'timestamp', type: 'string' }),
          wantInput({ id: 'recurrent', label: 'recurrent', type: 'boolean' }),
        ];

        const inputExtras = existingInputs.filter((p) => !usedInputs.has(p.id));

        const existingOutputs = Array.isArray(data.outputs) ? data.outputs : [];
        const byId = new Map(existingOutputs.map((p) => [p.id, p] as const));
        const used = new Set<string>();

        const want = (pin: Pin): Pin => {
          const prev = byId.get(pin.id);
          used.add(pin.id);
          if (!prev) return pin;
          if (prev.label === pin.label && prev.type === pin.type) return prev;
          return { ...prev, label: pin.label, type: pin.type };
        };

        const canonicalOutputs: Pin[] = [
          want({ id: 'exec-out', label: '', type: 'execution' }),
          want({ id: 'timestamp', label: 'time', type: 'string' }),
        ];

        const extras = existingOutputs.filter((p) => !used.has(p.id) && p.id !== 'recurrent');
        const prevCfg = data.eventConfig && typeof data.eventConfig === 'object' ? data.eventConfig : undefined;
        const schedule =
          typeof prevCfg?.schedule === 'string' && prevCfg.schedule.trim().length > 0 ? prevCfg.schedule : '15s';
        const recurrent = typeof prevCfg?.recurrent === 'boolean' ? prevCfg.recurrent : true;

        data = {
          ...data,
          inputs: [...canonicalInputs, ...inputExtras],
          outputs: [...canonicalOutputs, ...extras],
          eventConfig: { ...(prevCfg || {}), schedule, recurrent },
        };
      }

      // UX migration: promote well-known LLM routing pins to dedicated types.
      // (Provider/model are string-like, but typed pins enable dropdowns + edge coloring.)
      const upgradePins = (pins: Pin[] | undefined): Pin[] | undefined => {
        if (!Array.isArray(pins) || pins.length === 0) return pins;
        let changed = false;
        const next = pins.map((p) => {
          if (p && p.type === 'string') {
            const id = String(p.id || '').trim();
            const label = String(p.label || '').trim();
            if (id === 'provider' && label === 'provider') {
              changed = true;
              return { ...p, type: 'provider' as const };
            }
            if (id === 'model' && label === 'model') {
              changed = true;
              return { ...p, type: 'model' as const };
            }
          }
          return p;
        });
        return changed ? next : pins;
      };
      const upgradedInputs = upgradePins(data.inputs);
      const upgradedOutputs = upgradePins(data.outputs);
      if (upgradedInputs !== data.inputs || upgradedOutputs !== data.outputs) {
        data = { ...data, inputs: upgradedInputs || data.inputs, outputs: upgradedOutputs || data.outputs };
      }

      // Backward-compat + canonical ordering for Models Catalog node.
      // Remove deprecated `allowed_models` pin (selection is now stored in providerModelsConfig.allowedModels).
      if (data.nodeType === 'provider_models') {
        const existingInputs = Array.isArray(data.inputs) ? data.inputs : [];
        const byId = new Map(existingInputs.map((p) => [p.id, p] as const));

        const dropIds = new Set(['allowed_models', 'allowedModels']);
        const extras = existingInputs.filter((p) => p.id !== 'provider' && !dropIds.has(p.id));

        const prevProvider = byId.get('provider');
        const providerPin: Pin = !prevProvider
          ? { id: 'provider', label: 'provider', type: 'provider' }
          : prevProvider.label === 'provider' && prevProvider.type === 'provider'
            ? prevProvider
            : { ...prevProvider, label: 'provider', type: 'provider' };

        data = { ...data, inputs: [providerPin, ...extras] };
      }

      // Backward-compat + canonical ordering for file IO nodes (remove deprecated `file_type` pin).
      if (data.nodeType === 'read_file' || data.nodeType === 'write_file') {
        const existingInputs = Array.isArray(data.inputs) ? data.inputs : [];
        const byId = new Map(existingInputs.map((p) => [p.id, p] as const));
        const used = new Set<string>();

        const want = (pin: Pin): Pin => {
          const prev = byId.get(pin.id);
          used.add(pin.id);
          if (!prev) return pin;
          if (prev.label === pin.label && prev.type === pin.type) return prev;
          return { ...prev, label: pin.label, type: pin.type };
        };

        const canonicalInputs: Pin[] =
          data.nodeType === 'read_file'
            ? [
                want({ id: 'exec-in', label: '', type: 'execution' }),
                want({ id: 'file_path', label: 'file_path', type: 'string' }),
              ]
            : [
                want({ id: 'exec-in', label: '', type: 'execution' }),
                want({ id: 'file_path', label: 'file_path', type: 'string' }),
                want({ id: 'content', label: 'content', type: 'any' }),
              ];

        const extras = existingInputs.filter((p) => !used.has(p.id) && p.id !== 'file_type');

        const nextDefaults = (() => {
          const prev = data.pinDefaults;
          if (!prev || typeof prev !== 'object') return prev;
          if (!('file_type' in prev)) return prev;
          const { file_type: _unused, ...rest } = prev as any;
          return rest;
        })();

        data = { ...data, pinDefaults: nextDefaults, inputs: [...canonicalInputs, ...extras] };
      }

      // Canonical ordering for JSON render nodes.
      // Backward-compat: older flows may have `indent`/`sort_keys` pins; ensure `mode` exists so the inline dropdown is available.
      if (data.nodeType === 'stringify_json') {
        const existingInputs = Array.isArray(data.inputs) ? data.inputs : [];
        const byId = new Map(existingInputs.map((p) => [p.id, p] as const));
        const used = new Set<string>();

        const want = (pin: Pin): Pin => {
          const prev = byId.get(pin.id);
          used.add(pin.id);
          if (!prev) return pin;
          if (prev.label === pin.label && prev.type === pin.type) return prev;
          return { ...prev, label: pin.label, type: pin.type };
        };

        const canonicalInputs: Pin[] = [
          want({ id: 'value', label: 'value', type: 'any' }),
          want({ id: 'mode', label: 'mode', type: 'string' }),
        ];

        const extras = existingInputs.filter((p) => !used.has(p.id));

        const existingOutputs = Array.isArray(data.outputs) ? data.outputs : [];
        const outById = new Map(existingOutputs.map((p) => [p.id, p] as const));
        const usedOut = new Set<string>();
        const wantOut = (pin: Pin): Pin => {
          const prev = outById.get(pin.id);
          usedOut.add(pin.id);
          if (!prev) return pin;
          if (prev.label === pin.label && prev.type === pin.type) return prev;
          return { ...prev, label: pin.label, type: pin.type };
        };
        const canonicalOutputs: Pin[] = [wantOut({ id: 'result', label: 'result', type: 'string' })];
        const extraOutputs = existingOutputs.filter((p) => !usedOut.has(p.id));

        const nextDefaults = (() => {
          const prev = data.pinDefaults;
          if (!prev || typeof prev !== 'object') return prev;
          const anyPrev = prev as any;
          if (typeof anyPrev.mode === 'string' && anyPrev.mode.trim()) return prev;
          const rawIndent = anyPrev.indent;
          const indent = typeof rawIndent === 'number' ? rawIndent : Number.isFinite(Number(rawIndent)) ? Number(rawIndent) : null;
          if (indent === null) return prev;
          return { ...anyPrev, mode: indent <= 0 ? 'minified' : 'beautify' };
        })();

        data = {
          ...data,
          pinDefaults: nextDefaults,
          inputs: [...canonicalInputs, ...extras],
          outputs: [...canonicalOutputs, ...extraOutputs],
        };
      }

      // Canonical ordering for Tool Calls node pins.
      // Keep `tool_calls` typed as `array` (explicit list of calls).
      if (data.nodeType === 'tool_calls') {
        const existingInputs = Array.isArray(data.inputs) ? data.inputs : [];
        const byId = new Map(existingInputs.map((p) => [p.id, p] as const));
        const used = new Set<string>();

        const want = (pin: Pin): Pin => {
          const prev = byId.get(pin.id);
          used.add(pin.id);
          if (!prev) return pin;
          if (prev.label === pin.label && prev.type === pin.type) return prev;
          return { ...prev, label: pin.label, type: pin.type };
        };

        const canonicalInputs: Pin[] = [
          want({ id: 'exec-in', label: '', type: 'execution' }),
          want({ id: 'tool_calls', label: 'tool_calls', type: 'array' }),
          want({ id: 'allowed_tools', label: 'allowed_tools', type: 'array' }),
        ];

        const extraInputs = existingInputs.filter((p) => !used.has(p.id));

        const existingOutputs = Array.isArray(data.outputs) ? data.outputs : [];
        const outById = new Map(existingOutputs.map((p) => [p.id, p] as const));
        const usedOut = new Set<string>();
        const wantOut = (pin: Pin): Pin => {
          const prev = outById.get(pin.id);
          usedOut.add(pin.id);
          if (!prev) return pin;
          if (prev.label === pin.label && prev.type === pin.type) return prev;
          return { ...prev, label: pin.label, type: pin.type };
        };
        const canonicalOutputs: Pin[] = [
          wantOut({ id: 'exec-out', label: '', type: 'execution' }),
          wantOut({ id: 'results', label: 'results', type: 'array' }),
          wantOut({ id: 'success', label: 'success', type: 'boolean' }),
        ];
        const extraOutputs = existingOutputs.filter((p) => !usedOut.has(p.id));

        data = {
          ...data,
          inputs: [...canonicalInputs, ...extraInputs],
          outputs: [...canonicalOutputs, ...extraOutputs],
        };
      }

      // Normalize Switch nodes: execution outputs only (cases + default).
      if (data.nodeType === 'switch') {
        const existingExecPins = data.outputs.filter((p) => p.type === 'execution');
        const existingById = new Map(existingExecPins.map((p) => [p.id, p]));

        const cases = data.switchConfig?.cases ?? [];
        const nextCasePins = cases
          .filter((c): c is { id: string; value: string } => !!c && typeof c.id === 'string')
          .map((c) => {
            const id = `case:${c.id}`;
            const existing = existingById.get(id);
            return {
              id,
              label: c.value || existing?.label || 'case',
              type: 'execution' as const,
            };
          });

        const defaultPin = existingById.get('default');
        const nextDefaultPin = {
          id: 'default',
          label: defaultPin?.label || 'default',
          type: 'execution' as const,
        };

        // Preserve any extra execution pins to avoid silently dropping edges,
        // but strip all non-execution outputs (e.g. legacy `value`).
        const reserved = new Set<string>([...nextCasePins.map((p) => p.id), 'default']);
        const extraExecPins = existingExecPins.filter((p) => !reserved.has(p.id));

        data = {
          ...data,
          outputs: [...nextCasePins, nextDefaultPin, ...extraExecPins],
        };
      }

      // Backward-compat + canonical ordering for While nodes:
      // ensure `item:any` exists (parity with ForEach / Loop).
      if (data.nodeType === 'while') {
        const existingOutputs = Array.isArray(data.outputs) ? data.outputs : [];
        const byId = new Map(existingOutputs.map((p) => [p.id, p] as const));
        const used = new Set<string>();

        const want = (pin: Pin): Pin => {
          const prev = byId.get(pin.id);
          used.add(pin.id);
          if (!prev) return pin;
          if (prev.label === pin.label && prev.type === pin.type) return prev;
          return { ...prev, label: pin.label, type: pin.type };
        };

        const canonicalOutputs: Pin[] = [
          want({ id: 'loop', label: 'loop', type: 'execution' }),
          want({ id: 'done', label: 'done', type: 'execution' }),
          want({ id: 'item', label: 'item', type: 'any' }),
          want({ id: 'index', label: 'index', type: 'number' }),
        ];

        const extras = existingOutputs.filter((p) => !used.has(p.id));
        data = { ...data, outputs: [...canonicalOutputs, ...extras] };
      }

      // Backfill template pin documentation (tooltip text) for legacy flows.
      // This intentionally runs after all canonical ordering / pin insertion above.
      if (template) {
        data = mergePinDocsFromTemplate(createNodeData(template), data);
      }

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

    // Drop edges that reference missing pins (prevents invisible edges).
    const nodeById = new Map(nodes.map((n) => [n.id, n]));
    const validEdges = edges.filter((e) => {
      const source = nodeById.get(e.source);
      const target = nodeById.get(e.target);
      if (!source || !target) return false;
      if (!e.sourceHandle || !e.targetHandle) return false;
      const sourceHasHandle = source.data.outputs.some((p) => p.id === e.sourceHandle);
      const targetHasHandle = target.data.inputs.some((p) => p.id === e.targetHandle);
      return sourceHasHandle && targetHasHandle;
    });

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
      flowInterfaces: Array.isArray(flow.interfaces) ? flow.interfaces : [],
      nodes,
      edges: validEdges,
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
      interfaces: Array.isArray(state.flowInterfaces) ? state.flowInterfaces : [],
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
      flowInterfaces: [],
      nodes: [],
      edges: [],
      selectedNode: null,
      selectedEdge: null,
      clipboard: null,
      clipboardPasteCount: 0,
    });
    nodeIdCounter = 0;
  },
}));
