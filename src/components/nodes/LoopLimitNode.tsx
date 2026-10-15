import { memo, useEffect, useState } from 'react';
import { Handle, Position, useUpdateNodeInternals, type NodeProps } from 'reactflow';
import { useFlowStore } from '../../hooks/useFlow';
import { PIN_COLORS, type FlowNodeData, type Pin } from '../../types/flow';
import { categoryColorVar, nodeColorSection } from '../../utils/nodeCategoryColors';
import { PinShape } from '../pins/PinShape';
import { GlimpseCard } from '../GlimpseCard';
import { execGlimpse } from '../../utils/execGlimpse';

const SIZE = 64;
const PIN_GAP = 20;

/** The number of passes a Loop Limit lets through (its `max`; 3 when unset). */
export function loopLimitMax(data: FlowNodeData): number {
  const raw = (data.pinDefaults || {}).max;
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : 3;
}

/**
 * Loop Limit drawn as a circle on the path that repeats (operator 2026-10-11: "a counter in a
 * circle"): ↺3 inside, the way in on the left, `again`, `limit reached` and `count` on the right,
 * under the template's handle ids. Its limit is edited in the Properties panel.
 */
export const LoopLimitNode = memo(function LoopLimitNode({ id, data, selected }: NodeProps<FlowNodeData>) {
  const updateNodeInternals = useUpdateNodeInternals();
  const edges = useFlowStore((s) => s.edges);
  const nodes = useFlowStore((s) => s.nodes);
  const [hovered, setHovered] = useState(false);
  const isExecuting = useFlowStore((s) => s.executingNodeId === id);
  const isFailed = useFlowStore((s) => s.failedNodeId === id);
  const isRecent = useFlowStore((s) => Boolean(s.recentNodeIds && (s.recentNodeIds as Record<string, true>)[id]));
  const maxWired = edges.some((e) => e.target === id && e.targetHandle === 'max');
  const inputs = data.inputs;
  const outputs = data.outputs;
  const height = Math.max(SIZE, outputs.length * PIN_GAP + 8);
  const connected = (pinId: string, isInput: boolean) =>
    edges.some((e) => (isInput ? e.target === id && e.targetHandle === pinId : e.source === id && e.sourceHandle === pinId));

  const pinKey = `${inputs.map((p) => p.id).join('|')}__${outputs.map((p) => p.id).join('|')}`;
  useEffect(() => {
    updateNodeInternals(id);
  }, [id, pinKey, updateNodeInternals]);

  const pinTop = (index: number, count: number) => height / 2 + (index - (count - 1) / 2) * PIN_GAP;
  const renderPin = (pin: Pin, index: number, count: number, isInput: boolean) => (
    <span
      key={`${isInput ? 'in' : 'out'}-${pin.id}`}
      className={`collapsed-operator-pin collapsed-operator-pin--${isInput ? 'in' : 'out'}`}
      style={{ top: pinTop(index, count), color: PIN_COLORS[pin.type] }}
    >
      <PinShape type={pin.type} size={10} filled={connected(pin.id, isInput)} />
      <Handle type={isInput ? 'target' : 'source'} position={isInput ? Position.Left : Position.Right} id={pin.id} className={`pin ${pin.type}`} />
      {!isInput ? <span className="loop-limit-pin-label">{pin.label || pin.id}</span> : null}
    </span>
  );

  const max = loopLimitMax(data);
  return (
    <div
      className={[
        'collapsed-operator',
        'collapsed-operator--circle',
        'loop-limit-node',
        selected && 'selected',
        isExecuting && 'executing',
        isFailed && 'failed',
        isRecent && !isExecuting && !isFailed && 'recent',
      ]
        .filter(Boolean)
        .join(' ')}
      style={{ width: SIZE, height, ['--node-hue' as string]: categoryColorVar(nodeColorSection(data.nodeType, data.label)) }}
      data-node-type={data.nodeType}
      data-run-status={isFailed ? 'failed' : isExecuting ? 'running' : isRecent ? 'done' : undefined}
      aria-label={maxWired ? 'Loop Limit' : `Loop Limit, at most ${max} passes`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {hovered ? (() => { const self = nodes.find((n) => n.id === id); return self ? <GlimpseCard glimpse={execGlimpse(self, nodes, edges)} hue="var(--node-hue)" placement="below-centred" /> : null; })() : null}
      <span className="collapsed-operator-sign">↺{maxWired ? '' : max}</span>
      {inputs.map((pin, index) => renderPin(pin, index, inputs.length, true))}
      {outputs.map((pin, index) => renderPin(pin, index, outputs.length, false))}
    </div>
  );
});
