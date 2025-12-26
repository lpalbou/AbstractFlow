/**
 * Base node component with Blueprint-style pins.
 * Follows UE4 Blueprint visual patterns:
 * - Execution pins at top of node (in/out)
 * - Data pins below with labels
 * - Empty shapes = not connected, Filled = connected
 */

import { memo, type MouseEvent, type ReactNode, useCallback, useEffect, useMemo } from 'react';
import { Handle, Position, NodeProps, useEdges, useUpdateNodeInternals } from 'reactflow';
import { clsx } from 'clsx';
import type { FlowNodeData } from '../../types/flow';
import { PIN_COLORS, isEntryNodeType } from '../../types/flow';
import { PinShape } from '../pins/PinShape';
import { useFlowStore } from '../../hooks/useFlow';
import { useModels, useProviders } from '../../hooks/useProviders';
import { useTools } from '../../hooks/useTools';
import { collectCustomEventNames } from '../../utils/events';
import AfSelect from '../inputs/AfSelect';
import AfMultiSelect from '../inputs/AfMultiSelect';

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

export const BaseNode = memo(function BaseNode({
  id,
  data,
  selected,
}: NodeProps<FlowNodeData>) {
  const { executingNodeId, disconnectPin, updateNodeData } = useFlowStore();
  const isExecuting = executingNodeId === id;
  const edges = useEdges();
  const updateNodeInternals = useUpdateNodeInternals();

  const isTriggerNode = isEntryNodeType(data.nodeType);
  const pinDefaults = data.pinDefaults || {};

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

  const isLlmNode = data.nodeType === 'llm_call';
  const isAgentNode = data.nodeType === 'agent';
  const isProviderModelsNode = data.nodeType === 'provider_models';
  const isDelayNode = data.nodeType === 'wait_until';
  const isOnEventNode = data.nodeType === 'on_event';
  const isOnScheduleNode = data.nodeType === 'on_schedule';
  const isWriteFileNode = data.nodeType === 'write_file';

  const hasModelControls = isLlmNode || isAgentNode;
  const hasProviderDropdown = hasModelControls || isProviderModelsNode;

  const providerConnected = hasProviderDropdown ? isPinConnected('provider', true) : false;
  const modelConnected = hasModelControls ? isPinConnected('model', true) : false;
  const toolsConnected = isAgentNode ? isPinConnected('tools', true) : false;

  const selectedProvider = isAgentNode
    ? data.agentConfig?.provider
    : isLlmNode
      ? data.effectConfig?.provider
      : data.providerModelsConfig?.provider;
  const selectedModel = isAgentNode ? data.agentConfig?.model : data.effectConfig?.model;

  const providersQuery = useProviders(hasProviderDropdown && (!providerConnected || !modelConnected));
  const modelsQuery = useModels(selectedProvider, hasModelControls && !modelConnected);
  const toolsQuery = useTools(isAgentNode && !toolsConnected);

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
    if (!isAgentNode) return [];
    const raw = data.agentConfig?.tools;
    if (!Array.isArray(raw)) return [];
    const cleaned = raw
      .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
      .map((t) => t.trim());
    return Array.from(new Set(cleaned));
  }, [data.agentConfig?.tools, isAgentNode]);

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

  const setAgentTools = useCallback(
    (nextTools: string[]) => {
      if (!isAgentNode) return;
      const cleaned = nextTools
        .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
        .map((t) => t.trim());
      const unique = Array.from(new Set(cleaned));
      const prev = data.agentConfig || {};
      updateNodeData(id, { agentConfig: { ...prev, tools: unique.length > 0 ? unique : undefined } });
    },
    [data.agentConfig, id, isAgentNode, updateNodeData]
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
  const isConcatNode = data.nodeType === 'concat';
  const isArrayConcatNode = data.nodeType === 'array_concat';

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
      if (!isConcatNode && !isArrayConcatNode) return;

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

      const nextPinType = isArrayConcatNode ? ('array' as const) : ('string' as const);
      updateNodeData(id, {
        inputs: [...data.inputs, { id: nextId, label: nextId, type: nextPinType }],
      });
    },
    [data.inputs, id, isArrayConcatNode, isConcatNode, updateNodeData]
  );

  const overlayHandleStyle = {
    position: 'absolute' as const,
    inset: 0,
    width: '100%',
    height: '100%',
    transform: 'none',
  };

  return (
    <div
      className={clsx(
        'flow-node',
        selected && 'selected',
        isExecuting && 'executing'
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

        {/* Data input pins */}
        <div className="pins-left" style={{ ['--pin-label-width' as any]: inputLabelWidth }}>
          {inputData.map((pin) => (
            <div key={pin.id} className="pin-row input">
              <span
                className="pin-shape"
                style={{ color: PIN_COLORS[pin.type] }}
                title={`Type: ${pin.type}`}
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
              <span className="pin-label">{pin.label}</span>
              {(() => {
                const connected = isPinConnected(pin.id, true);
                const controls: ReactNode[] = [];

                const isPrimitive = pin.type === 'string' || pin.type === 'number' || pin.type === 'boolean';
                const isEmitEventName = isEmitEventNode && pin.id === 'name';
                const isEmitEventScopePin = isEmitEventNode && pin.id === 'scope';
                const isOnEventScopePin = isOnEventNode && pin.id === 'scope';
                const isOnScheduleTimestampPin = isOnScheduleNode && pin.id === 'schedule';
                const isOnScheduleRecurrentPin = isOnScheduleNode && pin.id === 'recurrent';
                const isWriteFileContentPin = isWriteFileNode && pin.id === 'content';
                const hasSpecialControl =
                  (hasProviderDropdown && pin.id === 'provider') ||
                  (hasModelControls && pin.id === 'model') ||
                  (isAgentNode && pin.id === 'tools') ||
                  isEmitEventName ||
                  isEmitEventScopePin ||
                  isOnEventScopePin ||
                  isOnScheduleTimestampPin ||
                  isOnScheduleRecurrentPin ||
                  isWriteFileContentPin;

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

                if (!connected && isPrimitive && !hasSpecialControl) {
                  const raw = pinDefaults[pin.id];
                  if (pin.type === 'string') {
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

                if (isAgentNode && pin.id === 'tools' && !toolsConnected) {
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
                      onChange={setAgentTools}
                    />
                  );
                }

                if (controls.length === 0) return null;
                return <div className="pin-inline-controls nodrag">{controls}</div>;
              })()}
            </div>
          ))}

          {(isConcatNode || isArrayConcatNode) && (
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
              <span
                className="pin-shape"
                style={{ color: PIN_COLORS[pin.type] }}
                title={`Type: ${pin.type}`}
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
            </div>
          ))}
        </div>
      </div>
    </div>
  );
});

export default BaseNode;
