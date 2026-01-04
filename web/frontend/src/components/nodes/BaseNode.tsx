/**
 * Base node component with Blueprint-style pins.
 * Follows UE4 Blueprint visual patterns:
 * - Execution pins at top of node (in/out)
 * - Data pins below with labels
 * - Empty shapes = not connected, Filled = connected
 */

import { memo, type MouseEvent, type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { Handle, Position, NodeProps, useEdges, useUpdateNodeInternals } from 'reactflow';
import { clsx } from 'clsx';
import type { FlowNodeData, PinType } from '../../types/flow';
import { PIN_COLORS, isEntryNodeType } from '../../types/flow';
import { PinShape } from '../pins/PinShape';
import { useFlowStore } from '../../hooks/useFlow';
import { useModels, useProviders } from '../../hooks/useProviders';
import { useTools } from '../../hooks/useTools';
import { collectCustomEventNames } from '../../utils/events';
import { extractFunctionBody, generatePythonTransformCode } from '../../utils/codegen';
import AfSelect from '../inputs/AfSelect';
import AfMultiSelect from '../inputs/AfMultiSelect';
import { getNodeTemplate } from '../../types/nodes';
import { AfTooltip } from '../AfTooltip';
import { CodeEditorModal } from '../CodeEditorModal';

const OnEventNameInline = memo(function OnEventNameInline({
  nodeId,
  value,
  eventConfig,
  updateNodeData,
}: {
  nodeId: string;
  value: string;
  eventConfig: FlowNodeData['eventConfig'] | undefined;
  updateNodeData: (nodeId: string, data: Partial<FlowNodeData>) => void;
}) {
  const nodes = useFlowStore((s) => s.nodes);
  const options = useMemo(() => collectCustomEventNames(nodes), [nodes]);
  const listId = `af-on-event-names-${nodeId}`;

  return (
    <div className="node-inline-config nodrag">
      {options.length > 0 ? (
        <datalist id={listId}>
          {options.map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>
      ) : null}

      <div className="node-config-row">
        <span className="node-config-label">name</span>
        <input
          className="af-pin-input nodrag"
          type="text"
          value={value}
          list={options.length > 0 ? listId : undefined}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) =>
            updateNodeData(nodeId, {
              eventConfig: { ...(eventConfig || {}), name: e.target.value },
            })
          }
          placeholder={options.length > 0 ? 'Pick…' : 'e.g., my_event'}
        />
      </div>
    </div>
  );
});

const ToolsAllowlistInline = memo(function ToolsAllowlistInline({
  tools,
  toolOptions,
  loading,
  onChange,
}: {
  tools: string[];
  toolOptions: Array<{ value: string; label: string }>;
  loading: boolean;
  onChange: (next: string[]) => void;
}) {
  return (
    <div className="node-inline-config nodrag">
      <div className="node-config-row">
        <span className="node-config-label">tools</span>
        <AfMultiSelect
          variant="pin"
          values={tools}
          placeholder={loading ? 'Loading…' : 'Select…'}
          options={toolOptions}
          disabled={loading}
          loading={loading}
          searchable
          searchPlaceholder="Search tools…"
          clearable
          minPopoverWidth={340}
          onChange={onChange}
        />
      </div>
    </div>
  );
});

const BoolVarInline = memo(function BoolVarInline({
  nodeId,
  name,
  defaultValue,
  options,
  onChange,
}: {
  nodeId: string;
  name: string;
  defaultValue: boolean;
  options: string[];
  onChange: (next: { name: string; default: boolean }) => void;
}) {
  const listId = `af-bool-var-names-${nodeId}`;
  return (
    <div className="node-inline-config nodrag">
      {options.length > 0 ? (
        <datalist id={listId}>
          {options.map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>
      ) : null}

      <div className="node-config-row">
        <span className="node-config-label">name</span>
        <input
          className="af-pin-input nodrag"
          type="text"
          value={name}
          list={options.length > 0 ? listId : undefined}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => onChange({ name: e.target.value, default: defaultValue })}
          placeholder="e.g., is_ready"
        />
      </div>

      <div className="node-config-row">
        <span className="node-config-label">default</span>
        <label
          className="af-pin-checkbox nodrag"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <input
            className="af-pin-checkbox-input"
            type="checkbox"
            checked={defaultValue}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => onChange({ name, default: e.target.checked })}
          />
          <span className="af-pin-checkbox-box" aria-hidden="true" />
        </label>
      </div>
    </div>
  );
});

const VarDeclInline = memo(function VarDeclInline({
  nodeId,
  name,
  varType,
  defaultValue,
  nameOptions,
  onChange,
}: {
  nodeId: string;
  name: string;
  varType: Exclude<PinType, 'execution'>;
  defaultValue: unknown;
  nameOptions: string[];
  onChange: (next: { name: string; type: Exclude<PinType, 'execution'>; default: unknown }) => void;
}) {
  const listId = `af-var-decl-names-${nodeId}`;

  const typeOptions: Array<{ value: string; label: string }> = [
    { value: 'boolean', label: 'boolean' },
    { value: 'number', label: 'number' },
    { value: 'string', label: 'string' },
    { value: 'provider', label: 'provider' },
    { value: 'model', label: 'model' },
    { value: 'object', label: 'object' },
    { value: 'array', label: 'array' },
    { value: 'any', label: 'any' },
  ];

  const defaultUi = (() => {
    if (varType === 'boolean') {
      return (
        <label
          className="af-pin-checkbox nodrag"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <input
            className="af-pin-checkbox-input"
            type="checkbox"
            checked={typeof defaultValue === 'boolean' ? defaultValue : false}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => onChange({ name, type: varType, default: e.target.checked })}
          />
          <span className="af-pin-checkbox-box" aria-hidden="true" />
        </label>
      );
    }

    if (varType === 'number') {
      const v = typeof defaultValue === 'number' && Number.isFinite(defaultValue) ? String(defaultValue) : '';
      return (
        <input
          className="af-pin-input nodrag"
          type="number"
          value={v}
          placeholder="0"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => {
            const raw = e.target.value;
            if (!raw) {
              onChange({ name, type: varType, default: 0 });
              return;
            }
            const n = Number(raw);
            if (!Number.isFinite(n)) return;
            onChange({ name, type: varType, default: n });
          }}
        />
      );
    }

    if (varType === 'string' || varType === 'provider' || varType === 'model') {
      return (
        <input
          className="af-pin-input nodrag"
          type="text"
          value={typeof defaultValue === 'string' ? defaultValue : ''}
          placeholder=""
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => onChange({ name, type: varType, default: e.target.value })}
        />
      );
    }

    const preview = varType === 'array' ? '[]' : varType === 'object' ? '{}' : 'null';
    return (
      <input
        className="af-pin-input nodrag"
        type="text"
        value={preview}
        disabled
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        readOnly
      />
    );
  })();

  return (
    <div className="node-inline-config nodrag">
      {nameOptions.length > 0 ? (
        <datalist id={listId}>
          {nameOptions.map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>
      ) : null}

      <div className="node-config-row">
        <span className="node-config-label">name</span>
        <input
          className="af-pin-input nodrag"
          type="text"
          value={name}
          list={nameOptions.length > 0 ? listId : undefined}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => onChange({ name: e.target.value, type: varType, default: defaultValue })}
          placeholder="e.g., is_ready"
        />
      </div>

      <div className="node-config-row">
        <span className="node-config-label">type</span>
        <AfSelect
          variant="pin"
          value={varType}
          options={typeOptions}
          onChange={(v) => {
            const nextType = (v || 'any') as Exclude<PinType, 'execution'>;
            const nextDefault =
              nextType === 'boolean'
                ? false
                : nextType === 'number'
                  ? 0
                  : nextType === 'string' || nextType === 'provider' || nextType === 'model'
                    ? ''
                    : nextType === 'array'
                      ? []
                      : nextType === 'object'
                        ? {}
                        : null;
            onChange({ name, type: nextType, default: nextDefault });
          }}
        />
      </div>

      <div className="node-config-row">
        <span className="node-config-label">default</span>
        {defaultUi}
      </div>
    </div>
  );
});

export const BaseNode = memo(function BaseNode({
  id,
  data,
  selected,
}: NodeProps<FlowNodeData>) {
  const nodeDescription = useMemo(() => {
    try {
      const t = getNodeTemplate(data.nodeType);
      const raw = t?.description;
      return typeof raw === 'string' ? raw.trim() : '';
    } catch {
      return '';
    }
  }, [data.nodeType]);

  const { executingNodeId, disconnectPin, updateNodeData, recentNodeIds, loopProgressByNodeId } = useFlowStore();
  const allNodes = useFlowStore((s) => s.nodes);
  const isExecuting = executingNodeId === id;
  const isRecent = Boolean(recentNodeIds && (recentNodeIds as Record<string, true>)[id]);
  const edges = useEdges();
  const updateNodeInternals = useUpdateNodeInternals();

  const isTriggerNode = isEntryNodeType(data.nodeType);
  const pinDefaults = data.pinDefaults || {};
  const isVarNode = data.nodeType === 'get_var' || data.nodeType === 'set_var';
  const isCodeNode = data.nodeType === 'code';
  const [showCodeEditor, setShowCodeEditor] = useState(false);
  const loopProgress = (data.nodeType === 'loop' || data.nodeType === 'for')
    ? (loopProgressByNodeId ? loopProgressByNodeId[id] : undefined)
    : undefined;
  const loopBadge = loopProgress && typeof loopProgress.total === 'number' && loopProgress.total > 0
    ? `${Math.min(loopProgress.index + 1, loopProgress.total)}/${loopProgress.total}`
    : null;

  const variableMeta = useMemo(() => {
    // Best-effort list of “flow vars” to help users pick names (Blueprint-style).
    // This is deliberately heuristic: users can still type/create new names.
    const vars = new Set<string>();
    const declaredTypes = new Map<string, Exclude<PinType, 'execution'>>();

    for (const n of allNodes) {
      const d = n.data;
      if (!d) continue;

      // On Flow Start parameters are initial vars.
      if (d.nodeType === 'on_flow_start') {
        for (const p of d.outputs || []) {
          if (p.type === 'execution') continue;
          const pid = typeof p.id === 'string' ? p.id.trim() : '';
          if (!pid) continue;
          vars.add(pid);
          // Prefer explicit declarations (var_decl/bool_var) over entrypoint pins.
          if (!declaredTypes.has(pid)) declaredTypes.set(pid, p.type as Exclude<PinType, 'execution'>);
        }
      }

      const ok = typeof d.outputKey === 'string' ? d.outputKey.trim() : '';
      if (ok) vars.add(ok);

      const ik = typeof d.inputKey === 'string' ? d.inputKey.trim() : '';
      if (ik) vars.add(ik);

      if ((d.nodeType === 'get_var' || d.nodeType === 'set_var') && typeof d.pinDefaults?.name === 'string') {
        const vn = d.pinDefaults.name.trim();
        if (vn) vars.add(vn);
      }

      if (d.nodeType === 'bool_var') {
        const raw = d.literalValue;
        let vn = '';
        if (typeof raw === 'string') vn = raw.trim();
        else if (raw && typeof raw === 'object' && typeof (raw as any).name === 'string') vn = String((raw as any).name).trim();
        if (vn) {
          vars.add(vn);
          declaredTypes.set(vn, 'boolean');
        }
      }

      if (d.nodeType === 'var_decl') {
        const raw = d.literalValue;
        if (raw && typeof raw === 'object') {
          const vn = typeof (raw as any).name === 'string' ? String((raw as any).name).trim() : '';
          const t = typeof (raw as any).type === 'string' ? String((raw as any).type).trim() : '';
          const vt =
            t === 'boolean' ||
            t === 'number' ||
            t === 'string' ||
            t === 'provider' ||
            t === 'model' ||
            t === 'object' ||
            t === 'array' ||
            t === 'any'
              ? (t as Exclude<PinType, 'execution'>)
              : 'any';
          if (vn) {
            vars.add(vn);
            declaredTypes.set(vn, vt);
          }
        }
      }
    }

    const options = Array.from(vars)
      .filter((v) => v.length > 0)
      .sort((a, b) => a.localeCompare(b))
      .map((v) => {
        const t = declaredTypes.get(v);
        return { value: v, label: t ? `${v} (${t})` : v };
      });

    return { options, declaredTypes };
  }, [allNodes]);

  const variableOptions = variableMeta.options;
  const declaredVarTypes = variableMeta.declaredTypes;

  // ReactFlow needs an explicit nudge when handles change (dynamic pins),
  // otherwise newly created edges can exist in state but fail to render.
  const handlesKey = useMemo(() => {
    const inputs = data.inputs.map((p) => p.id).join('|');
    const outputs = data.outputs.map((p) => p.id).join('|');
    return `${inputs}__${outputs}`;
  }, [data.inputs, data.outputs]);

  // Node width can change when pin connections toggle inline controls (quick defaults),
  // so nudge ReactFlow to re-measure when connections for this node change.
  const connectedInputsKey = useMemo(() => {
    const connected = edges
      .filter((e) => e.target === id && typeof e.targetHandle === 'string' && e.targetHandle !== 'exec-in')
      .map((e) => e.targetHandle as string)
      .sort()
      .join('|');
    return connected;
  }, [edges, id]);

  useEffect(() => {
    updateNodeInternals(id);
  }, [id, handlesKey, connectedInputsKey, updateNodeInternals]);

  // Check if a pin is connected
  const isPinConnected = (pinId: string, isInput: boolean): boolean => {
    if (isInput) {
      return edges.some((e) => e.target === id && e.targetHandle === pinId);
    }
    return edges.some((e) => e.source === id && e.sourceHandle === pinId);
  };

  const handlePinClick = (e: MouseEvent, pinId: string, isInput: boolean) => {
    if (!isPinConnected(pinId, isInput)) return;
    e.preventDefault();
    e.stopPropagation();
    disconnectPin(id, pinId, isInput);
  };

  // Separate execution pins from data pins
  const inputExec = isTriggerNode ? undefined : data.inputs.find((p) => p.type === 'execution');
  const outputExecs = data.outputs.filter((p) => p.type === 'execution');
  const isEmitEventNode = data.nodeType === 'emit_event';
  const inputData = data.inputs.filter((p) => {
    if (p.type === 'execution') return false;
    // Keep emit_event "session_id" as an advanced pin: hide it unless connected.
    if (isEmitEventNode && p.id === 'session_id' && !isPinConnected('session_id', true)) {
      return false;
    }
    return true;
  });
  const outputData = data.outputs.filter((p) => p.type !== 'execution');

  const codeParams = useMemo(() => data.inputs.filter((p) => p.type !== 'execution'), [data.inputs]);
  const currentCodeBody = useMemo(() => {
    if (typeof data.codeBody === 'string') return data.codeBody;
    if (typeof data.code === 'string') return extractFunctionBody(data.code, data.functionName || 'transform') ?? '';
    return '';
  }, [data.code, data.codeBody, data.functionName]);

  const isLlmNode = data.nodeType === 'llm_call';
  const isAgentNode = data.nodeType === 'agent';
  const isToolsAllowlistNode = data.nodeType === 'tools_allowlist';
  const isBoolVarNode = data.nodeType === 'bool_var';
  const isVarDeclNode = data.nodeType === 'var_decl';
  const isProviderModelsNode = data.nodeType === 'provider_models';
  const isDelayNode = data.nodeType === 'wait_until';
  const isOnEventNode = data.nodeType === 'on_event';
  const isOnScheduleNode = data.nodeType === 'on_schedule';
  const isWriteFileNode = data.nodeType === 'write_file';
  const isMemoryNoteNode = data.nodeType === 'memory_note';
  const isMemoryQueryNode = data.nodeType === 'memory_query';
  const isMemoryRehydrateNode = data.nodeType === 'memory_rehydrate';
  // NOTE: Subflow control pins (inherit_context) are configured via pin defaults on the pin row.
  // We intentionally avoid a separate non-pin checkbox to keep the UI single-source-of-truth.

  const hasModelControls = isLlmNode || isAgentNode;
  const hasProviderDropdown = hasModelControls || isProviderModelsNode;

  const providerConnected = hasProviderDropdown ? isPinConnected('provider', true) : false;
  const modelConnected = hasModelControls ? isPinConnected('model', true) : false;
  const toolsConnected = (isAgentNode || isLlmNode) ? isPinConnected('tools', true) : false;

  const selectedProvider = isAgentNode
    ? data.agentConfig?.provider
    : isLlmNode
      ? data.effectConfig?.provider
      : data.providerModelsConfig?.provider;
  const selectedModel = isAgentNode ? data.agentConfig?.model : data.effectConfig?.model;


  const providersQuery = useProviders(hasProviderDropdown && (!providerConnected || !modelConnected));
  const modelsQuery = useModels(selectedProvider, hasModelControls && !modelConnected);
  const toolsQuery = useTools((isAgentNode || isLlmNode || isToolsAllowlistNode) && !toolsConnected);

  const providers = Array.isArray(providersQuery.data) ? providersQuery.data : [];
  const models = Array.isArray(modelsQuery.data) ? modelsQuery.data : [];
  const tools = Array.isArray(toolsQuery.data) ? toolsQuery.data : [];

  const toolOptions = useMemo(() => {
    const out = tools
      .filter((t) => t && typeof t.name === 'string' && t.name.trim())
      .map((t) => ({
        value: t.name.trim(),
        label: t.name.trim(),
      }));
    out.sort((a, b) => a.label.localeCompare(b.label));
    return out;
  }, [tools]);

  const selectedTools = useMemo(() => {
    if (isAgentNode) {
      const raw = data.agentConfig?.tools;
      if (!Array.isArray(raw)) return [];
      const cleaned = raw
        .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
        .map((t) => t.trim());
      return Array.from(new Set(cleaned));
    }

    if (isLlmNode) {
      const raw = data.effectConfig?.tools;
      if (!Array.isArray(raw)) return [];
      const cleaned = raw
        .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
        .map((t) => t.trim());
      return Array.from(new Set(cleaned));
    }

    if (isToolsAllowlistNode) {
      const raw = data.literalValue;
      if (!Array.isArray(raw)) return [];
      const cleaned = raw
        .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
        .map((t) => t.trim());
      return Array.from(new Set(cleaned));
    }

    return [];
  }, [data.agentConfig?.tools, data.effectConfig?.tools, data.literalValue, isAgentNode, isLlmNode, isToolsAllowlistNode]);

  const setProviderModel = useCallback(
    (provider: string | undefined, model: string | undefined) => {
      if (isAgentNode) {
        const prev = data.agentConfig || {};
        updateNodeData(id, { agentConfig: { ...prev, provider: provider || undefined, model: model || undefined } });
        return;
      }
      if (isLlmNode) {
        const prev = data.effectConfig || {};
        updateNodeData(id, { effectConfig: { ...prev, provider: provider || undefined, model: model || undefined } });
        return;
      }
      if (isProviderModelsNode) {
        const prev = data.providerModelsConfig || {};
        updateNodeData(id, { providerModelsConfig: { ...prev, provider: provider || undefined, allowedModels: [] } });
      }
    },
    [data.agentConfig, data.effectConfig, data.providerModelsConfig, id, isAgentNode, isLlmNode, isProviderModelsNode, updateNodeData]
  );

  const setNodeTools = useCallback(
    (nextTools: string[]) => {
      const cleaned = nextTools
        .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
        .map((t) => t.trim());
      const unique = Array.from(new Set(cleaned));

      if (isAgentNode) {
        const prev = data.agentConfig || {};
        updateNodeData(id, { agentConfig: { ...prev, tools: unique.length > 0 ? unique : undefined } });
        return;
      }

      if (isLlmNode) {
        const prev = data.effectConfig || {};
        updateNodeData(id, { effectConfig: { ...prev, tools: unique.length > 0 ? unique : undefined } });
        return;
      }

      if (isToolsAllowlistNode) {
        updateNodeData(id, { literalValue: unique });
      }
    },
    [data.agentConfig, data.effectConfig, id, isAgentNode, isLlmNode, isToolsAllowlistNode, updateNodeData]
  );

  const boolVarConfig = useMemo(() => {
    if (!isBoolVarNode) return { name: '', default: false };
    const raw = data.literalValue;
    if (typeof raw === 'string') return { name: raw.trim(), default: false };
    if (raw && typeof raw === 'object') {
      const name = typeof (raw as any).name === 'string' ? String((raw as any).name).trim() : '';
      const def = typeof (raw as any).default === 'boolean' ? Boolean((raw as any).default) : false;
      return { name, default: def };
    }
    return { name: '', default: false };
  }, [data.literalValue, isBoolVarNode]);

  const setBoolVarConfig = useCallback(
    (next: { name: string; default: boolean }) => {
      if (!isBoolVarNode) return;
      updateNodeData(id, { literalValue: { name: next.name, default: next.default } });
    },
    [id, isBoolVarNode, updateNodeData]
  );

  const varDeclConfig = useMemo(() => {
    if (!isVarDeclNode) return { name: '', type: 'any' as const, default: null as unknown };
    const raw = data.literalValue;
    if (raw && typeof raw === 'object') {
      const name = typeof (raw as any).name === 'string' ? String((raw as any).name).trim() : '';
      const t = typeof (raw as any).type === 'string' ? String((raw as any).type).trim() : '';
      const type =
        t === 'boolean' ||
        t === 'number' ||
        t === 'string' ||
        t === 'provider' ||
        t === 'model' ||
        t === 'object' ||
        t === 'array' ||
        t === 'any'
          ? (t as Exclude<PinType, 'execution'>)
          : ('any' as const);
      const def = (raw as any).default as unknown;
      return { name, type, default: def };
    }
    return { name: '', type: 'any' as const, default: null as unknown };
  }, [data.literalValue, isVarDeclNode]);

  const setVarDeclConfig = useCallback(
    (next: { name: string; type: Exclude<PinType, 'execution'>; default: unknown }) => {
      if (!isVarDeclNode) return;
      const nextOutputs = data.outputs.map((p) => (p.id === 'value' ? { ...p, type: next.type } : p));
      updateNodeData(id, { literalValue: { name: next.name, type: next.type, default: next.default }, outputs: nextOutputs });
    },
    [data.outputs, id, isVarDeclNode, updateNodeData]
  );

  const setPinDefault = useCallback(
    (pinId: string, value: string | number | boolean | undefined) => {
      const prev = data.pinDefaults || {};
      const next: typeof prev = { ...prev };
      if (value === undefined) {
        delete next[pinId];
      } else {
        next[pinId] = value;
      }
      updateNodeData(id, { pinDefaults: next });
    },
    [data.pinDefaults, id, updateNodeData]
  );

  const setVariableName = useCallback(
    (raw: string | null | undefined) => {
      if (!isVarNode) return;
      const name = (raw || '').trim();

      const prevDefaults = data.pinDefaults || {};
      const nextDefaults: typeof prevDefaults = { ...prevDefaults };
      if (!name) {
        delete nextDefaults.name;
      } else {
        nextDefaults.name = name;
      }

      const baseLabel = data.nodeType === 'set_var' ? 'Set Variable' : 'Get Variable';
      const prefix = data.nodeType === 'set_var' ? 'Set ' : 'Get ';

      // Auto-label for readability, but don't stomp explicit user labels.
      const prevLabel = data.label || baseLabel;
      const shouldAuto =
        prevLabel === baseLabel ||
        prevLabel === (prefix + (typeof prevDefaults.name === 'string' ? prevDefaults.name.trim() : '')) ||
        prevLabel.startsWith(prefix);

      const nextLabel = shouldAuto && name ? `${prefix}${name}` : prevLabel;
      const declaredType = name ? declaredVarTypes.get(name) : undefined;
      const nextType = declaredType ?? ('any' as const);

      const nextData: Partial<FlowNodeData> = { pinDefaults: nextDefaults, label: nextLabel };
      if (data.nodeType === 'get_var') {
        nextData.outputs = data.outputs.map((p) => (p.id === 'value' ? { ...p, type: nextType } : p));
      } else if (data.nodeType === 'set_var') {
        nextData.inputs = data.inputs.map((p) => (p.id === 'value' ? { ...p, type: nextType } : p));
        nextData.outputs = data.outputs.map((p) => (p.id === 'value' ? { ...p, type: nextType } : p));
      }

      updateNodeData(id, nextData);
    },
    [data.inputs, data.label, data.nodeType, data.outputs, data.pinDefaults, declaredVarTypes, id, isVarNode, updateNodeData]
  );

  const setEmitEventName = useCallback(
    (raw: string) => {
      if (!isEmitEventNode) return;
      const nextName = raw.trim();

      const prevDefaults = data.pinDefaults || {};
      const nextDefaults: typeof prevDefaults = { ...prevDefaults };
      if (!nextName) {
        delete nextDefaults.name;
      } else {
        nextDefaults.name = nextName;
      }

      const prevCfg = data.effectConfig || {};
      const nextCfg = { ...prevCfg, name: nextName || undefined };

      updateNodeData(id, { pinDefaults: nextDefaults, effectConfig: nextCfg });
    },
    [data.effectConfig, data.pinDefaults, id, isEmitEventNode, updateNodeData]
  );

  const emitEventScope = (data.effectConfig?.scope ?? 'session') as 'session' | 'workflow' | 'run' | 'global';
  const setEmitEventScope = useCallback(
    (next: string) => {
      if (!isEmitEventNode) return;
      const v = next === 'workflow' || next === 'run' || next === 'global' ? next : 'session';
      const prev = data.effectConfig || {};
      updateNodeData(id, { effectConfig: { ...prev, scope: v } });
    },
    [data.effectConfig, id, isEmitEventNode, updateNodeData]
  );

  const onEventScope = (data.eventConfig?.scope ?? 'session') as 'session' | 'workflow' | 'run' | 'global';
  const setOnEventScope = useCallback(
    (next: string) => {
      if (!isOnEventNode) return;
      const v = next === 'workflow' || next === 'run' || next === 'global' ? next : 'session';
      const prev = data.eventConfig || {};
      updateNodeData(id, { eventConfig: { ...prev, scope: v } });
    },
    [data.eventConfig, id, isOnEventNode, updateNodeData]
  );

  const onScheduleSchedule = useMemo(() => {
    const raw = data.eventConfig?.schedule;
    const s = typeof raw === 'string' ? raw : '';
    return s.trim().length > 0 ? s : '15s';
  }, [data.eventConfig?.schedule]);

  const onScheduleRecurrent = data.eventConfig?.recurrent ?? true;

  const setOnScheduleSchedule = useCallback(
    (next: string) => {
      if (!isOnScheduleNode) return;
      const prev = data.eventConfig || {};
      updateNodeData(id, { eventConfig: { ...prev, schedule: next } });
    },
    [data.eventConfig, id, isOnScheduleNode, updateNodeData]
  );

  const setOnScheduleRecurrent = useCallback(
    (next: boolean) => {
      if (!isOnScheduleNode) return;
      const prev = data.eventConfig || {};
      updateNodeData(id, { eventConfig: { ...prev, recurrent: next } });
    },
    [data.eventConfig, id, isOnScheduleNode, updateNodeData]
  );

  const isSequenceLike = data.nodeType === 'sequence';
  const isParallelLike = data.nodeType === 'parallel';
  const isSwitchNode = data.nodeType === 'switch';
  const isCompareNode = data.nodeType === 'compare';
  const isConcatNode = data.nodeType === 'concat';
  const isArrayConcatNode = data.nodeType === 'array_concat';
  const isMakeArrayNode = data.nodeType === 'make_array';

  const delayDurationType = (data.effectConfig?.durationType ?? 'seconds') as
    | 'seconds'
    | 'minutes'
    | 'hours'
    | 'timestamp';

  const inputLabelWidth = useMemo(() => {
    let maxLen = 0;
    for (const p of inputData) {
      const label = typeof p.label === 'string' ? p.label : '';
      maxLen = Math.max(maxLen, label.length);
    }
    // Keep pin labels close to the pin (Blueprint-style), while aligning inline controls.
    const minCh = 2;
    const maxCh = 12;
    const clamped = Math.min(maxCh, Math.max(minCh, maxLen || 0));
    return `${clamped}ch`;
  }, [inputData]);

  const setDelayDurationType = useCallback(
    (next: string) => {
      const v =
        next === 'minutes' || next === 'hours' || next === 'timestamp' ? next : 'seconds';
      const prev = data.effectConfig || {};
      updateNodeData(id, { effectConfig: { ...prev, durationType: v } });
    },
    [data.effectConfig, id, updateNodeData]
  );

  const parseThenIndex = (raw: string): number | null => {
    const m = /^then:(\d+)$/.exec(raw);
    if (!m) return null;
    const n = Number(m[1]);
    return Number.isFinite(n) ? n : null;
  };

  const parseCaseId = (raw: string): string | null => {
    if (!raw.startsWith('case:')) return null;
    const id = raw.slice('case:'.length);
    return id ? id : null;
  };

  const addThenPin = useCallback(
    (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const existingExec = data.outputs.filter((p) => p.type === 'execution');
      const thenPins = existingExec.filter((p) => parseThenIndex(p.id) !== null);
      const completedPin = isParallelLike ? existingExec.find((p) => p.id === 'completed') : undefined;

      let maxIdx = -1;
      for (const p of thenPins) {
        const idx = parseThenIndex(p.id);
        if (idx !== null) maxIdx = Math.max(maxIdx, idx);
      }
      const nextIdx = maxIdx + 1;

      const newPin = { id: `then:${nextIdx}`, label: `Then ${nextIdx}`, type: 'execution' as const };

      // Preserve existing ordering, but keep `completed` (Parallel) as the last pin.
      const nextOutputs = (() => {
        const nonExec = data.outputs.filter((p) => p.type !== 'execution');
        const nextExec = isParallelLike
          ? [...thenPins, newPin, ...(completedPin ? [completedPin] : [])]
          : [...existingExec, newPin];
        return [...nonExec, ...nextExec];
      })();

      updateNodeData(id, { outputs: nextOutputs });
    },
    [data.outputs, id, isParallelLike, updateNodeData]
  );

  const addSwitchCasePin = useCallback(
    (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!isSwitchNode) return;

      const existingCases = data.switchConfig?.cases ?? [];

      const newId =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? (crypto.randomUUID() as string).slice(0, 8)
          : `c${Date.now().toString(16)}${Math.random().toString(16).slice(2, 6)}`;

      const nextCases = [...existingCases, { id: newId, value: '' }];

      const existingExec = data.outputs.filter((p) => p.type === 'execution');
      const existingById = new Map(existingExec.map((p) => [p.id, p] as const));

      const nextCasePins = nextCases.map((c) => {
        const pid = `case:${c.id}`;
        const existing = existingById.get(pid);
        return {
          id: pid,
          label: c.value || existing?.label || 'case',
          type: 'execution' as const,
        };
      });

      const defaultExisting = existingById.get('default');
      const defaultPin = { id: 'default', label: defaultExisting?.label || 'default', type: 'execution' as const };

      const reserved = new Set<string>([...nextCasePins.map((p) => p.id), 'default']);
      const extraExecPins = existingExec.filter((p) => !reserved.has(p.id));

      updateNodeData(id, {
        switchConfig: { cases: nextCases },
        outputs: [...nextCasePins, defaultPin, ...extraExecPins],
      });
    },
    [data.outputs, data.switchConfig?.cases, id, isSwitchNode, updateNodeData]
  );

  const addConcatInputPin = useCallback(
    (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!isConcatNode && !isArrayConcatNode && !isMakeArrayNode) return;

      const pins = data.inputs.filter((p) => p.type !== 'execution');
      const ids = new Set(pins.map((p) => p.id));

      let nextId: string | null = null;
      for (let code = 97; code <= 122; code++) {
        const candidate = String.fromCharCode(code);
        if (!ids.has(candidate)) {
          nextId = candidate;
          break;
        }
      }
      if (!nextId) {
        let idx = pins.length + 1;
        while (ids.has(`p${idx}`)) idx++;
        nextId = `p${idx}`;
      }

      const nextPinType = isConcatNode ? ('string' as const) : isArrayConcatNode ? ('array' as const) : ('any' as const);
      updateNodeData(id, {
        inputs: [...data.inputs, { id: nextId, label: nextId, type: nextPinType }],
      });
    },
    [data.inputs, id, isArrayConcatNode, isConcatNode, isMakeArrayNode, updateNodeData]
  );

  const overlayHandleStyle = {
    position: 'absolute' as const,
    inset: 0,
    width: '100%',
    height: '100%',
    transform: 'none',
  };

  return (
    <AfTooltip content={nodeDescription} delayMs={2000}>
      <div
        className={clsx(
          'flow-node',
          `flow-node--${data.nodeType}`,
          selected && 'selected',
          isExecuting && 'executing',
          isRecent && !isExecuting && 'recent'
        )}
      >
      {/* Header with execution pins */}
      <div
        className="node-header"
        style={{ backgroundColor: data.headerColor }}
      >
        {/* Execution input pin (left side of header) */}
        {inputExec && (
          <div className="exec-pin exec-pin-in nodrag">
            <Handle
              type="target"
              position={Position.Left}
              id={inputExec.id}
              className="exec-handle"
              onMouseDownCapture={(e) => handlePinClick(e, inputExec.id, true)}
            />
            <span
              className="exec-shape"
              style={{ color: PIN_COLORS.execution }}
              onClick={(e) => handlePinClick(e, inputExec.id, true)}
            >
              <PinShape
                type="execution"
                size={12}
                filled={isPinConnected(inputExec.id, true)}
              />
            </span>
          </div>
        )}

        <span
          className="node-icon"
          dangerouslySetInnerHTML={{ __html: data.icon }}
        />
        <span className="node-title">{data.label}</span>
        {loopBadge ? <span className="node-progress-badge" title="Loop progress">{loopBadge}</span> : null}

        {/* Execution output pins (right side of header) */}
        {outputExecs.length === 1 && !isSwitchNode && (
          <div className="exec-pin exec-pin-out nodrag">
            <span
              className="exec-shape"
              style={{ color: PIN_COLORS.execution }}
              onClick={(e) => handlePinClick(e, outputExecs[0].id, false)}
            >
              <PinShape
                type="execution"
                size={12}
                filled={isPinConnected(outputExecs[0].id, false)}
              />
            </span>
            <Handle
              type="source"
              position={Position.Right}
              id={outputExecs[0].id}
              className="exec-handle"
              onMouseDownCapture={(e) => handlePinClick(e, outputExecs[0].id, false)}
            />
          </div>
        )}
      </div>

      {/* Body with pins */}
      <div className="node-body">
        {/* Multiple execution outputs (for branch nodes like If/Else) */}
        {(outputExecs.length > 1 || isSwitchNode) && (
          <div className="pins-right exec-branches">
            {(() => {
              // Special layout:
              // - Sequence: Then pins + "Add pin"
              // - Parallel: Then pins + "Add pin" + Completed (bottom-right)
              if (isSequenceLike || isParallelLike) {
                const thenPins = outputExecs
                  .filter((p) => /^then:\d+$/.test(p.id))
                  .sort((a, b) => (parseThenIndex(a.id) ?? 0) - (parseThenIndex(b.id) ?? 0));
                const completed = isParallelLike ? outputExecs.find((p) => p.id === 'completed') : undefined;

                return (
                  <>
                    {thenPins.map((pin) => (
                      <div key={pin.id} className="pin-row output exec-branch nodrag">
                        <span className="pin-label">{pin.label}</span>
                        <span
                          className="pin-shape"
                          style={{ color: PIN_COLORS.execution }}
                          onClick={(e) => handlePinClick(e, pin.id, false)}
                        >
                          <PinShape
                            type="execution"
                            size={12}
                            filled={isPinConnected(pin.id, false)}
                          />
                        </span>
                        <Handle
                          type="source"
                          position={Position.Right}
                          id={pin.id}
                          className="exec-handle"
                          onMouseDownCapture={(e) => handlePinClick(e, pin.id, false)}
                        />
                      </div>
                    ))}

                    <div className="pin-row output exec-add-pin" onClick={addThenPin}>
                      <span className="pin-label">Add pin</span>
                      <span className="exec-add-plus">+</span>
                    </div>

                    {completed ? (
                      <div key={completed.id} className="pin-row output exec-branch exec-completed nodrag">
                        <span className="pin-label">{completed.label}</span>
                        <span
                          className="pin-shape"
                          style={{ color: PIN_COLORS.execution }}
                          onClick={(e) => handlePinClick(e, completed.id, false)}
                        >
                          <PinShape
                            type="execution"
                            size={12}
                            filled={isPinConnected(completed.id, false)}
                          />
                        </span>
                        <Handle
                          type="source"
                          position={Position.Right}
                          id={completed.id}
                          className="exec-handle"
                          onMouseDownCapture={(e) => handlePinClick(e, completed.id, false)}
                        />
                      </div>
                    ) : null}
                  </>
                );
              }

              // Switch: case pins + "Add pin" + Default (always visible)
              if (isSwitchNode) {
                const casePins = outputExecs.filter((p) => parseCaseId(p.id) !== null);
                const defaultPin = outputExecs.find((p) => p.id === 'default');
                const extras = outputExecs.filter((p) => p.id !== 'default' && parseCaseId(p.id) === null);

                return (
                  <>
                    {casePins.map((pin) => (
                      <div key={pin.id} className="pin-row output exec-branch nodrag">
                        <span className="pin-label">{pin.label}</span>
                        <span
                          className="pin-shape"
                          style={{ color: PIN_COLORS.execution }}
                          onClick={(e) => handlePinClick(e, pin.id, false)}
                        >
                          <PinShape type="execution" size={12} filled={isPinConnected(pin.id, false)} />
                        </span>
                        <Handle
                          type="source"
                          position={Position.Right}
                          id={pin.id}
                          className="exec-handle"
                          onMouseDownCapture={(e) => handlePinClick(e, pin.id, false)}
                        />
                      </div>
                    ))}

                    {extras.map((pin) => (
                      <div key={pin.id} className="pin-row output exec-branch nodrag">
                        <span className="pin-label">{pin.label}</span>
                        <span
                          className="pin-shape"
                          style={{ color: PIN_COLORS.execution }}
                          onClick={(e) => handlePinClick(e, pin.id, false)}
                        >
                          <PinShape type="execution" size={12} filled={isPinConnected(pin.id, false)} />
                        </span>
                        <Handle
                          type="source"
                          position={Position.Right}
                          id={pin.id}
                          className="exec-handle"
                          onMouseDownCapture={(e) => handlePinClick(e, pin.id, false)}
                        />
                      </div>
                    ))}

                    {defaultPin ? (
                      <div key={defaultPin.id} className="pin-row output exec-branch nodrag">
                        <span className="pin-label">{defaultPin.label}</span>
                        <span
                          className="pin-shape"
                          style={{ color: PIN_COLORS.execution }}
                          onClick={(e) => handlePinClick(e, defaultPin.id, false)}
                        >
                          <PinShape type="execution" size={12} filled={isPinConnected(defaultPin.id, false)} />
                        </span>
                        <Handle
                          type="source"
                          position={Position.Right}
                          id={defaultPin.id}
                          className="exec-handle"
                          onMouseDownCapture={(e) => handlePinClick(e, defaultPin.id, false)}
                        />
                      </div>
                    ) : null}

                    <div className="pin-row output exec-add-pin" onClick={addSwitchCasePin}>
                      <span className="pin-label">Add pin</span>
                      <span className="exec-add-plus">+</span>
                    </div>
                  </>
                );
              }

              // Default: render all execution outputs in order.
              return outputExecs.map((pin) => (
                <div key={pin.id} className="pin-row output exec-branch nodrag">
                  <span className="pin-label">{pin.label}</span>
                  <span
                    className="pin-shape"
                    style={{ color: PIN_COLORS.execution }}
                    onClick={(e) => handlePinClick(e, pin.id, false)}
                  >
                    <PinShape
                      type="execution"
                      size={12}
                      filled={isPinConnected(pin.id, false)}
                    />
                  </span>
                  <Handle
                    type="source"
                    position={Position.Right}
                    id={pin.id}
                    className="exec-handle"
                    onMouseDownCapture={(e) => handlePinClick(e, pin.id, false)}
                  />
                </div>
              ));
            })()}
          </div>
        )}

        {data.nodeType === 'on_event' && (
          <OnEventNameInline
            nodeId={id}
            value={data.eventConfig?.name || ''}
            eventConfig={data.eventConfig}
            updateNodeData={updateNodeData}
          />
        )}

        {data.nodeType === 'tools_allowlist' && (
          <ToolsAllowlistInline
            tools={selectedTools}
            toolOptions={toolOptions}
            loading={toolsQuery.isLoading}
            onChange={setNodeTools}
          />
        )}

        {data.nodeType === 'bool_var' && (
          <BoolVarInline
            nodeId={id}
            name={boolVarConfig.name}
            defaultValue={boolVarConfig.default}
            options={variableOptions.map((o) => o.value)}
            onChange={setBoolVarConfig}
          />
        )}

        {data.nodeType === 'var_decl' && (
          <VarDeclInline
            nodeId={id}
            name={varDeclConfig.name}
            varType={varDeclConfig.type}
            defaultValue={varDeclConfig.default}
            nameOptions={variableOptions.map((o) => o.value)}
            onChange={setVarDeclConfig}
          />
        )}

        {isCodeNode && (
          <div className="node-code-edit-row nodrag">
            <button
              type="button"
              className="node-code-edit-button nodrag"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                setShowCodeEditor(true);
              }}
              title="Edit Python code"
            >
              ✍️ Edit Code
            </button>
          </div>
        )}

        {/* Data input pins */}
        <div className="pins-left" style={{ ['--pin-label-width' as any]: inputLabelWidth }}>
          {inputData.map((pin) => (
            <div key={pin.id} className="pin-row input">
              <AfTooltip content={pin.description} delayMs={2000}>
                <span
                  className="pin-shape"
                  style={{ color: PIN_COLORS[pin.type] }}
                  onClick={(e) => handlePinClick(e, pin.id, true)}
                  onMouseDownCapture={(e) => handlePinClick(e, pin.id, true)}
                >
                  <PinShape
                    type={pin.type}
                    size={10}
                    filled={isPinConnected(pin.id, true)}
                  />
                  <Handle
                    type="target"
                    position={Position.Left}
                    id={pin.id}
                    className={`pin ${pin.type}`}
                    style={overlayHandleStyle}
                    onMouseDownCapture={(e) => handlePinClick(e, pin.id, true)}
                    onClick={(e) => handlePinClick(e, pin.id, true)}
                  />
                </span>
              </AfTooltip>
              <span className="pin-label">{pin.label}</span>
              {(() => {
                const connected = isPinConnected(pin.id, true);
                const controls: ReactNode[] = [];

                const isPrimitive =
                  pin.type === 'string' ||
                  pin.type === 'number' ||
                  pin.type === 'boolean' ||
                  pin.type === 'provider' ||
                  pin.type === 'model';
                const isEmitEventName = isEmitEventNode && pin.id === 'name';
                const isEmitEventScopePin = isEmitEventNode && pin.id === 'scope';
                const isOnEventScopePin = isOnEventNode && pin.id === 'scope';
                const isOnScheduleTimestampPin = isOnScheduleNode && pin.id === 'schedule';
                const isOnScheduleRecurrentPin = isOnScheduleNode && pin.id === 'recurrent';
                const isWriteFileContentPin = isWriteFileNode && pin.id === 'content';
                const isCompareOpPin = isCompareNode && pin.id === 'op';
                const isMemoryScopePin = (isMemoryNoteNode || isMemoryQueryNode) && pin.id === 'scope';
                const isMemoryTagsModePin = isMemoryQueryNode && pin.id === 'tags_mode';
                const isMemoryPlacementPin = isMemoryRehydrateNode && pin.id === 'placement';
                const hasSpecialControl =
                  (hasProviderDropdown && pin.id === 'provider') ||
                  (hasModelControls && pin.id === 'model') ||
                  ((isAgentNode || isLlmNode) && pin.id === 'tools') ||
                  (isVarNode && pin.id === 'name') ||
                  isCompareOpPin ||
                  isEmitEventName ||
                  isEmitEventScopePin ||
                  isOnEventScopePin ||
                  isOnScheduleTimestampPin ||
                  isOnScheduleRecurrentPin ||
                  isWriteFileContentPin ||
                  isMemoryScopePin ||
                  isMemoryTagsModePin ||
                  isMemoryPlacementPin;

                if (isEmitEventName) {
                  const pinned = pinDefaults.name;
                  const configured = data.effectConfig?.name;
                  const nameValue =
                    (typeof pinned === 'string' ? pinned : undefined) ??
                    (typeof configured === 'string' ? configured : undefined) ??
                    '';

                  if (!connected) {
                    controls.push(
                      <input
                        key="emit-name"
                        className="af-pin-input nodrag"
                        type="text"
                        value={nameValue}
                        placeholder=""
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => setEmitEventName(e.target.value)}
                      />
                    );
                  }
                }

                if ((isEmitEventScopePin || isOnEventScopePin) && !connected) {
                  const value = isEmitEventScopePin ? emitEventScope : onEventScope;
                  const onChange = isEmitEventScopePin ? setEmitEventScope : setOnEventScope;

                  controls.push(
                    <AfSelect
                      key="scope"
                      variant="pin"
                      value={value}
                      placeholder="session"
                      options={[
                        { value: 'session', label: 'session' },
                        { value: 'workflow', label: 'workflow' },
                        { value: 'run', label: 'run' },
                        { value: 'global', label: 'global' },
                      ]}
                      searchable={false}
                      minPopoverWidth={180}
                      onChange={onChange}
                    />
                  );
                }

                if (isMemoryScopePin && !connected) {
                  const raw = pinDefaults.scope;
                  const currentScope =
                    typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : 'run';

                  const options = isMemoryQueryNode
                    ? [
                        { value: 'run', label: 'run' },
                        { value: 'session', label: 'session' },
                        { value: 'global', label: 'global' },
                        { value: 'all', label: 'all' },
                      ]
                    : [
                        { value: 'run', label: 'run' },
                        { value: 'session', label: 'session' },
                        { value: 'global', label: 'global' },
                      ];

                  controls.push(
                    <AfSelect
                      key="memory-scope"
                      variant="pin"
                      value={currentScope}
                      placeholder="run"
                      options={options}
                      searchable={false}
                      minPopoverWidth={180}
                      onChange={(v) => setPinDefault('scope', (v || 'run') as any)}
                    />
                  );
                }

                if (isMemoryTagsModePin && !connected) {
                  const raw = pinDefaults.tags_mode;
                  const current =
                    typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : 'all';
                  controls.push(
                    <AfSelect
                      key="memory-tags-mode"
                      variant="pin"
                      value={current}
                      placeholder="all"
                      options={[
                        { value: 'all', label: 'all (AND)' },
                        { value: 'any', label: 'any (OR)' },
                      ]}
                      searchable={false}
                      minPopoverWidth={180}
                      onChange={(v) => setPinDefault('tags_mode', (v || 'all') as any)}
                    />
                  );
                }

                if (isMemoryPlacementPin && !connected) {
                  const raw = pinDefaults.placement;
                  const currentPlacement =
                    typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : 'after_summary';
                  controls.push(
                    <AfSelect
                      key="memory-placement"
                      variant="pin"
                      value={currentPlacement}
                      placeholder="after_summary"
                      options={[
                        { value: 'after_summary', label: 'after_summary' },
                        { value: 'after_system', label: 'after_system' },
                        { value: 'end', label: 'end' },
                      ]}
                      searchable={false}
                      minPopoverWidth={200}
                      onChange={(v) => setPinDefault('placement', (v || 'after_summary') as any)}
                    />
                  );
                }

                if (isCompareOpPin && !connected) {
                  const raw = pinDefaults.op;
                  const currentOp = typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : '==';
                  controls.push(
                    <AfSelect
                      key="compare-op"
                      variant="pin"
                      value={currentOp}
                      placeholder="=="
                      options={[
                        { value: '==', label: '==' },
                        { value: '>=', label: '>=' },
                        { value: '>', label: '>' },
                        { value: '<=', label: '<=' },
                        { value: '<', label: '<' },
                      ]}
                      searchable={false}
                      minPopoverWidth={120}
                      onChange={(v) => setPinDefault('op', (v || '==') as any)}
                    />
                  );
                }

                if (isOnScheduleTimestampPin && !connected) {
                  controls.push(
                    <input
                      key="on-schedule-timestamp"
                      className="af-pin-input nodrag"
                      type="text"
                      value={onScheduleSchedule}
                      placeholder=""
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => setOnScheduleSchedule(e.target.value)}
                    />
                  );
                }

                if (isOnScheduleRecurrentPin && !connected) {
                  controls.push(
                    <label
                      key="on-schedule-recurrent"
                      className="af-pin-checkbox nodrag"
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        className="af-pin-checkbox-input"
                        type="checkbox"
                        checked={onScheduleRecurrent}
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => setOnScheduleRecurrent(e.target.checked)}
                      />
                      <span className="af-pin-checkbox-box" aria-hidden="true" />
                    </label>
                  );
                }

                if (isWriteFileContentPin && !connected) {
                  const raw = pinDefaults.content;
                  controls.push(
                    <input
                      key="file-content"
                      className="af-pin-input nodrag"
                      type="text"
                      value={typeof raw === 'string' ? raw : ''}
                      placeholder=""
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => setPinDefault('content', e.target.value)}
                    />
                  );
                }

                if (isVarNode && pin.id === 'name') {
                  const raw = pinDefaults.name;
                  const current = typeof raw === 'string' ? raw : '';
                  const CREATE = '__af_create_var__';

                  const options = [...variableOptions, { value: CREATE, label: 'Create new…' }];

                  if (!connected) {
                    controls.push(
                      <AfSelect
                        key="var-name"
                        variant="pin"
                        value={current}
                        placeholder="Select…"
                        options={options}
                        searchable
                        clearable
                        minPopoverWidth={260}
                        onChange={(v) => {
                          if (v === CREATE) {
                            const next = window.prompt('New variable name (dotted paths allowed):', '');
                            if (typeof next === 'string' && next.trim()) setVariableName(next);
                            return;
                          }
                          setVariableName(v || '');
                        }}
                      />
                    );
                  }
                }

                if (!connected && isPrimitive && !hasSpecialControl) {
                  const raw = pinDefaults[pin.id];
                  if (pin.type === 'string' || pin.type === 'provider' || pin.type === 'model') {
                    controls.push(
                      <input
                        key="pin-default"
                        className={clsx(
                          'af-pin-input nodrag',
                          isSwitchNode && pin.id === 'value' && 'af-pin-input--switch-value'
                        )}
                        type="text"
                        value={typeof raw === 'string' ? raw : ''}
                        placeholder=""
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => setPinDefault(pin.id, e.target.value)}
                      />
                    );
                  } else if (pin.type === 'number') {
                    controls.push(
                      <input
                        key="pin-default"
                        className="af-pin-input nodrag"
                        type="number"
                        value={typeof raw === 'number' && Number.isFinite(raw) ? String(raw) : ''}
                        placeholder=""
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (!v) {
                            setPinDefault(pin.id, undefined);
                            return;
                          }
                          const n = Number(v);
                          if (!Number.isFinite(n)) return;
                          setPinDefault(pin.id, n);
                        }}
                      />
                    );
                  } else if (pin.type === 'boolean') {
                    controls.push(
                      <label
                        key="pin-default"
                        className="af-pin-checkbox nodrag"
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          className="af-pin-checkbox-input"
                          type="checkbox"
                          checked={typeof raw === 'boolean' ? raw : false}
                          onMouseDown={(e) => e.stopPropagation()}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => setPinDefault(pin.id, e.target.checked)}
                        />
                        <span className="af-pin-checkbox-box" aria-hidden="true" />
                      </label>
                    );
                  }
                }

                if (isDelayNode && pin.id === 'duration') {
                  // Always show duration interpretation selector (even when duration pin is connected).
                  controls.push(
                    <AfSelect
                      key="duration-type"
                      variant="pin"
                      value={delayDurationType}
                      placeholder="seconds"
                      options={[
                        { value: 'seconds', label: 'seconds' },
                        { value: 'minutes', label: 'minutes' },
                        { value: 'hours', label: 'hours' },
                        { value: 'timestamp', label: 'timestamp' },
                      ]}
                      searchable={false}
                      minPopoverWidth={180}
                      onChange={setDelayDurationType}
                    />
                  );
                }

                if (hasProviderDropdown && pin.id === 'provider' && !providerConnected) {
                  controls.push(
                    <AfSelect
                      key="provider"
                      variant="pin"
                      value={selectedProvider || ''}
                      placeholder={providersQuery.isLoading ? 'Loading…' : 'Select…'}
                      options={providers.map((p) => ({ value: p.name, label: p.display_name || p.name }))}
                      disabled={providersQuery.isLoading}
                      loading={providersQuery.isLoading}
                      searchable
                      searchPlaceholder="Search providers…"
                      clearable
                      minPopoverWidth={260}
                      onChange={(v) => setProviderModel(v || undefined, undefined)}
                    />
                  );
                }

                if (hasModelControls && pin.id === 'model' && !modelConnected) {
                  controls.push(
                    <AfSelect
                      key="model"
                      variant="pin"
                      value={selectedModel || ''}
                      placeholder={!selectedProvider ? 'Pick provider…' : modelsQuery.isLoading ? 'Loading…' : 'Select…'}
                      options={models.map((m) => ({ value: m, label: m }))}
                      disabled={!selectedProvider || modelsQuery.isLoading}
                      loading={modelsQuery.isLoading}
                      searchable
                      searchPlaceholder="Search models…"
                      clearable
                      minPopoverWidth={360}
                      onChange={(v) => setProviderModel(selectedProvider || undefined, v || undefined)}
                    />
                  );
                }

                if ((isAgentNode || isLlmNode) && pin.id === 'tools' && !toolsConnected) {
                  controls.push(
                    <AfMultiSelect
                      key="tools"
                      variant="pin"
                      values={selectedTools}
                      placeholder={toolsQuery.isLoading ? 'Loading…' : 'Select…'}
                      options={toolOptions}
                      disabled={toolsQuery.isLoading}
                      loading={toolsQuery.isLoading}
                      searchable
                      searchPlaceholder="Search tools…"
                      clearable
                      minPopoverWidth={340}
                      onChange={setNodeTools}
                    />
                  );
                }

                if (controls.length === 0) return null;
                return <div className="pin-inline-controls nodrag">{controls}</div>;
              })()}
            </div>
          ))}

          {(isConcatNode || isArrayConcatNode || isMakeArrayNode) && (
            <div className="pin-row exec-add-pin nodrag" onClick={addConcatInputPin}>
              <span className="pin-shape" style={{ opacity: 0 }} aria-hidden="true" />
              <span className="pin-label">Add pin</span>
              <span className="exec-add-plus">+</span>
            </div>
          )}
        </div>

        {/* Data output pins */}
        <div className="pins-right">
          {outputData.map((pin) => (
            <div key={pin.id} className="pin-row output">
              <span className="pin-label">{pin.label}</span>
              <AfTooltip content={pin.description} delayMs={2000}>
                <span
                  className="pin-shape"
                  style={{ color: PIN_COLORS[pin.type] }}
                  onClick={(e) => handlePinClick(e, pin.id, false)}
                >
                  <PinShape
                    type={pin.type}
                    size={10}
                    filled={isPinConnected(pin.id, false)}
                  />
                  <Handle
                    type="source"
                    position={Position.Right}
                    id={pin.id}
                    className={`pin ${pin.type}`}
                    style={overlayHandleStyle}
                    onClick={(e) => handlePinClick(e, pin.id, false)}
                  />
                </span>
              </AfTooltip>
            </div>
          ))}
        </div>
      </div>
      </div>

      {isCodeNode && (
        <CodeEditorModal
          isOpen={showCodeEditor}
          title="Python Code"
          body={currentCodeBody}
          params={codeParams.map((p) => p.id)}
          onClose={() => setShowCodeEditor(false)}
          onSave={(nextBody) => {
            updateNodeData(id, {
              codeBody: nextBody,
              code: generatePythonTransformCode(data.inputs, nextBody),
              functionName: 'transform',
            });
            setShowCodeEditor(false);
          }}
        />
      )}
    </AfTooltip>
  );
});

export default BaseNode;
