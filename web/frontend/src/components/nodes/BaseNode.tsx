/**
 * Base node component with Blueprint-style pins.
 * Follows UE4 Blueprint visual patterns:
 * - Execution pins at top of node (in/out)
 * - Data pins below with labels
 * - Empty shapes = not connected, Filled = connected
 */

import { memo, type MouseEvent } from 'react';
import { Handle, Position, NodeProps, useEdges } from 'reactflow';
import { clsx } from 'clsx';
import type { FlowNodeData } from '../../types/flow';
import { PIN_COLORS } from '../../types/flow';
import { PinShape } from '../pins/PinShape';
import { useFlowStore } from '../../hooks/useFlow';

export const BaseNode = memo(function BaseNode({
  id,
  data,
  selected,
}: NodeProps<FlowNodeData>) {
  const { executingNodeId, disconnectPin } = useFlowStore();
  const isExecuting = executingNodeId === id;
  const edges = useEdges();

  const isTriggerNode = data.nodeType.startsWith('on_');

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
      {/* Header with execution pins */}
      <div
        className="node-header"
        style={{ backgroundColor: data.headerColor }}
      >
        {/* Execution input pin (left side of header) */}
        {inputExec && (
          <div className="exec-pin exec-pin-in">
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
        {outputExecs.length === 1 && (
          <div className="exec-pin exec-pin-out">
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
        {outputExecs.length > 1 && (
          <div className="pins-right exec-branches">
            {outputExecs.map((pin) => (
              <div key={pin.id} className="pin-row output exec-branch">
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
          </div>
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
                onMouseDownCapture={(e) => handlePinClick(e, pin.id, true)}
              />
              <span
                className="pin-shape"
                style={{ color: PIN_COLORS[pin.type] }}
                title={`Type: ${pin.type}`}
                onClick={(e) => handlePinClick(e, pin.id, true)}
              >
                <PinShape
                  type={pin.type}
                  size={10}
                  filled={isPinConnected(pin.id, true)}
                />
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
                onClick={(e) => handlePinClick(e, pin.id, false)}
              >
                <PinShape
                  type={pin.type}
                  size={10}
                  filled={isPinConnected(pin.id, false)}
                />
              </span>
              <Handle
                type="source"
                position={Position.Right}
                id={pin.id}
                className={`pin ${pin.type}`}
                onMouseDownCapture={(e) => handlePinClick(e, pin.id, false)}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
});

export default BaseNode;
