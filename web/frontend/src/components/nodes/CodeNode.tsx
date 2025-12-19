/**
 * Code node with Monaco editor for custom Python code.
 */

import { memo, useState, useCallback } from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import Editor from '@monaco-editor/react';
import { clsx } from 'clsx';
import type { FlowNodeData } from '../../types/flow';
import { PIN_COLORS } from '../../types/flow';
import { useFlowStore } from '../../hooks/useFlow';

export const CodeNode = memo(function CodeNode({
  id,
  data,
  selected,
}: NodeProps<FlowNodeData>) {
  const { updateNodeData, executingNodeId } = useFlowStore();
  const isExecuting = executingNodeId === id;

  const [code, setCode] = useState(
    data.code || 'def transform(input):\n    return input'
  );
  const [isEditing, setIsEditing] = useState(false);

  const handleCodeChange = useCallback(
    (value: string | undefined) => {
      const newCode = value || '';
      setCode(newCode);
      updateNodeData(id, { code: newCode });
    },
    [id, updateNodeData]
  );

  return (
    <div
      className={clsx(
        'flow-node code-node',
        selected && 'selected',
        isExecuting && 'executing'
      )}
    >
      {/* Header */}
      <div
        className="node-header"
        style={{ backgroundColor: '#9B59B6' }}
      >
        <span className="node-icon">🐍</span>
        <span className="node-title">{data.label || 'Python Code'}</span>
      </div>

      {/* Body */}
      <div className="node-body code-body">
        {/* Execution pins */}
        <Handle
          type="target"
          position={Position.Left}
          id="exec-in"
          className="pin execution"
          style={{ top: 44, background: PIN_COLORS.execution }}
        />
        <Handle
          type="source"
          position={Position.Right}
          id="exec-out"
          className="pin execution"
          style={{ top: 44, background: PIN_COLORS.execution }}
        />

        {/* Code editor */}
        <div
          className="code-editor-wrapper"
          onDoubleClick={() => setIsEditing(true)}
        >
          {isEditing ? (
            <Editor
              height="120px"
              width="280px"
              language="python"
              theme="vs-dark"
              value={code}
              onChange={handleCodeChange}
              onMount={(editor) => {
                editor.onDidBlurEditorWidget(() => setIsEditing(false));
              }}
              options={{
                minimap: { enabled: false },
                fontSize: 11,
                lineNumbers: 'off',
                scrollBeyondLastLine: false,
                folding: false,
                lineDecorationsWidth: 0,
                lineNumbersMinChars: 0,
                glyphMargin: false,
                padding: { top: 4, bottom: 4 },
              }}
            />
          ) : (
            <pre className="code-preview">
              {code.split('\n').slice(0, 5).join('\n')}
              {code.split('\n').length > 5 && '\n...'}
            </pre>
          )}
        </div>

        {/* Data pins */}
        <div className="pins-left">
          <div className="pin-row input">
            <Handle
              type="target"
              position={Position.Left}
              id="input"
              className="pin any"
              style={{ top: 180, background: PIN_COLORS.any }}
            />
            <span className="pin-label">input</span>
          </div>
        </div>

        <div className="pins-right">
          <div className="pin-row output">
            <span className="pin-label">output</span>
            <Handle
              type="source"
              position={Position.Right}
              id="output"
              className="pin any"
              style={{ top: 180, background: PIN_COLORS.any }}
            />
          </div>
        </div>
      </div>
    </div>
  );
});

export default CodeNode;
