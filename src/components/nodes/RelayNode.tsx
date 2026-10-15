import { memo } from 'react';
import { Handle, Position, type NodeProps } from 'reactflow';
import { PIN_COLORS, type FlowNodeData, type PinType } from '../../types/flow';

/**
 * A relay (utils/relays.ts): a dot with one input on its left and one output on
 * its right, coloured by the type it carries. Visual only: the runtime wires
 * the source straight to every input the relay feeds.
 */
export const RelayNode = memo(function RelayNode({ data, selected }: NodeProps<FlowNodeData>) {
  const type = (data.outputs[0]?.type || 'any') as PinType;
  const color = PIN_COLORS[type] || PIN_COLORS.any;
  return (
    <div
      className={selected ? 'relay-node selected' : 'relay-node'}
      style={{ ['--relay-color' as string]: color }}
      title={`Relay · ${type}`}
      aria-label={`Relay carrying ${type}`}
    >
      <Handle type="target" position={Position.Left} id="in" className="relay-handle relay-handle--in" />
      <Handle type="source" position={Position.Right} id="out" className="relay-handle relay-handle--out" />
    </div>
  );
});
