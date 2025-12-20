/**
 * Modal for user prompts during flow execution (Ask User effect).
 */

import { useCallback, useState } from 'react';

interface UserPromptModalProps {
  isOpen: boolean;
  prompt: string;
  choices: string[];
  allowFreeText: boolean;
  onSubmit: (response: string) => void;
}

export function UserPromptModal({
  isOpen,
  prompt,
  choices,
  allowFreeText,
  onSubmit,
}: UserPromptModalProps) {
  const [response, setResponse] = useState('');

  const handleSubmit = useCallback(() => {
    if (response.trim()) {
      onSubmit(response.trim());
      setResponse('');
    }
  }, [response, onSubmit]);

  const handleChoiceClick = useCallback(
    (choice: string) => {
      onSubmit(choice);
      setResponse('');
    },
    [onSubmit]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey && allowFreeText) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit, allowFreeText]
  );

  if (!isOpen) return null;

  return (
    <div className="modal-overlay">
      <div className="modal user-prompt-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Input Required</h3>
        </div>

        <div className="modal-body">
          <p className="prompt-text">{prompt}</p>

          {/* Choice buttons */}
          {choices.length > 0 && (
            <div className="choices-container">
              {choices.map((choice, index) => (
                <button
                  key={index}
                  className="choice-button"
                  onClick={() => handleChoiceClick(choice)}
                >
                  {choice}
                </button>
              ))}
            </div>
          )}

          {/* Free text input */}
          {allowFreeText && (
            <div className="free-text-container">
              {choices.length > 0 && (
                <p className="or-divider">or enter your response:</p>
              )}
              <textarea
                className="prompt-input"
                value={response}
                onChange={(e) => setResponse(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Type your response..."
                rows={3}
                autoFocus
              />
            </div>
          )}
        </div>

        <div className="modal-actions">
          {allowFreeText && (
            <button
              className="modal-button primary"
              onClick={handleSubmit}
              disabled={!response.trim()}
            >
              Submit
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default UserPromptModal;
