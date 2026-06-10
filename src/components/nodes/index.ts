/**
 * Node component exports.
 */

export { BaseNode } from './BaseNode';
export { ExecViewNode } from './ExecViewNode';

// Node type map for React Flow
import { BaseNode } from './BaseNode';
import { ExecViewNode } from './ExecViewNode';

export const nodeTypes = {
  custom: BaseNode,
  code: BaseNode,
  // Condensed execution-flow rendering (Canvas swaps node type in exec view).
  execView: ExecViewNode,
};
