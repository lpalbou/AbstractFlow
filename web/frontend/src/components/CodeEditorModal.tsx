/**
 * Monaco-based editor modal for Python Code node body.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Editor from '@monaco-editor/react';

interface CodeEditorModalProps {
  isOpen: boolean;
  title?: string;
  body: string;
  params: string[];
  onClose: () => void;
  onSave: (body: string) => void;
}

export function CodeEditorModal({ isOpen, title, body, params, onClose, onSave }: CodeEditorModalProps) {
  const [value, setValue] = useState(body);

  useEffect(() => {
    if (isOpen) setValue(body);
  }, [isOpen, body]);

  const hint = useMemo(() => {
    if (params.length === 0) return 'Inputs: _input (dict)';
    return `Inputs: _input (dict), ${params.join(', ')}`;
  }, [params]);

  const handleSave = useCallback(() => {
    onSave(value);
  }, [onSave, value]);

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal code-editor-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{title || 'Edit Python Code'}</h3>
        </div>

        <div className="modal-body">
          <p className="property-hint">
            Write the body of <code>transform(_input)</code>. {hint}
          </p>
          <div className="code-editor-container">
            <Editor
              height="420px"
              defaultLanguage="python"
              theme="vs-dark"
              value={value}
              onChange={(v) => setValue(v ?? '')}
              options={{
                minimap: { enabled: false },
                fontSize: 13,
                wordWrap: 'on',
                scrollBeyondLastLine: false,
              }}
            />
          </div>
        </div>

        <div className="modal-actions">
          <button className="modal-button" onClick={onClose}>
            Cancel
          </button>
          <button className="modal-button primary" onClick={handleSave}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

export default CodeEditorModal;

