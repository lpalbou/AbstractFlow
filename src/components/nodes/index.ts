/**
 * Node component exports.
 */

export { BaseNode } from './BaseNode';
export { ExecViewNode } from './ExecViewNode';

// Node type map for React Flow
import { createElement, memo } from 'react';
import type { NodeProps } from 'reactflow';
import type { FlowNodeData } from '../../types/flow';
import { isCollapsedOperator } from '../../utils/operatorNodes';
import { BaseNode } from './BaseNode';
import { CollapsedOperatorNode } from './CollapsedOperatorNode';
import { ExecViewNode } from './ExecViewNode';
import { RelayNode } from './RelayNode';
import { LoopLimitNode } from './LoopLimitNode';
import { isRelay } from '../../utils/relays';

/** A relay dot, the Loop Limit circle, the full card, or the collapsed operator (a double click toggles it). */
const FlowNode = memo(function FlowNode(props: NodeProps<FlowNodeData>) {
  if (isRelay(props)) return createElement(RelayNode, props);
  if (props.data.nodeType === 'loop_limit') return createElement(LoopLimitNode, props);
  return createElement(isCollapsedOperator(props.data) ? CollapsedOperatorNode : BaseNode, props);
});

export const nodeTypes = {
  custom: FlowNode,
  code: FlowNode,
  // Condensed execution-flow rendering (Canvas swaps node type in exec view).
  execView: ExecViewNode,
};
