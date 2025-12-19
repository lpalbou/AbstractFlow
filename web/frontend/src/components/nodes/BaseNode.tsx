/**
 * Base node component with Blueprint-style pins.
 */

import { memo } from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { clsx } from 'clsx';
import type { FlowNodeData } from '../../types/flow';
import { PIN_COLORS } from '../../types/flow';
import { PinShape } from '../pins/PinShape';
import { useFlowStore } from '../../hooks/useFlow';

// Calculate pin position offset
function getPinOffset(index: number, isExecution: boolean): number {
  const headerHeight = 32;
  const executionPinY = headerHeight + 12;
  if (isExecution) return executionPinY;
  return headerHeight + 36 + index * 24;
}

export const BaseNode = memo(function BaseNode({
  id,
  data,
  selected,
}: NodeProps<FlowNodeData>) {
  const { executingNodeId } = useFlowStore();
  const isExecuting = executingNodeId === id;

  // Separate execution pins from data pins
  const inputExec = data.inputs.find((p) => p.type === 'execution');
  const outputExec = data.outputs.find((p) => p.type === 'execution');
  const inputData = data.inputs.filter((p) => p.type !== 'execution');
  const outputData = data.outputs.filter((p) => p.type !== 'execution');

  return (
    <div
      className={clsx(
        'flow-node',
        selected && 'selected',
        isExecuting && 'executing'
      )}
    >
      {/* Header */}
      <div
        className="node-header"
        style={{ backgroundColor: data.headerColor }}
      >
        <span
          className="node-icon"
          dangerouslySetInnerHTML={{ __html: data.icon }}
        />
        <span className="node-title">{data.label}</span>
      </div>

      {/* Body with pins */}
      <div className="node-body">
        {/* Execution input pin */}
        {inputExec && (
          <Handle
            type="target"
            position={Position.Left}
            id={inputExec.id}
            className="pin execution"
            title="Execution: Flow control input"
            style={{
              top: getPinOffset(0, true),
              background: PIN_COLORS.execution,
            }}
          />
        )}

        {/* Execution output pin */}
        {outputExec && (
          <Handle
            type="source"
            position={Position.Right}
            id={outputExec.id}
            className="pin execution"
            title="Execution: Flow control output"
            style={{
              top: getPinOffset(0, true),
              background: PIN_COLORS.execution,
            }}
          />
        )}

        {/* Data input pins */}
        <div className="pins-left">
          {inputData.map((pin) => (
            <div key={pin.id} className="pin-row input">
              <Handle
                type="target"
                position={Position.Left}
                id={pin.id}
                className={`pin ${pin.type}`}
                title={`${pin.label} (${pin.type})`}
                style={{ background: PIN_COLORS[pin.type] }}
              />
              <span
                className="pin-shape"
                style={{ color: PIN_COLORS[pin.type] }}
                title={`Type: ${pin.type}`}
              >
                <PinShape type={pin.type} size={10} />
              </span>
              <span className="pin-label">{pin.label}</span>
            </div>
          ))}
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
              >
                <PinShape type={pin.type} size={10} />
              </span>
              <Handle
                type="source"
                position={Position.Right}
                id={pin.id}
                className={`pin ${pin.type}`}
                title={`${pin.label} (${pin.type})`}
                style={{ background: PIN_COLORS[pin.type] }}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
});

export default BaseNode;
