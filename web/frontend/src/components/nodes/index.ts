/**
 * Node component exports.
 */

export { BaseNode } from './BaseNode';
export { CodeNode } from './CodeNode';

// Node type map for React Flow
import { BaseNode } from './BaseNode';
import { CodeNode } from './CodeNode';

export const nodeTypes = {
  custom: BaseNode,
  code: CodeNode,
};
