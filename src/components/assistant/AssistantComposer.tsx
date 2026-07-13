import { AUTHORING_CYCLE_OPTIONS, normalizeMaxCycles } from './assistantSettings';
import { IconClear, IconCopy, IconUndo } from './icons';

interface AssistantComposerProps {
  draft: string;
  onDraftChange: (value: string) => void;
  busy: boolean;
  stopRequested: boolean;
  onSubmit: () => void;
  onStop: () => void;
  onCopyConversation: () => void;
  onClearConversation: () => void;
  onUndo: () => void;
  canUndo: boolean;
  maxCycles: number;
  onMaxCyclesChange: (value: number) => void;
}

/** Prompt textarea + control row of the assistant drawer (pure render). */
export function AssistantComposer({
  draft,
  onDraftChange,
  busy,
  stopRequested,
  onSubmit,
  onStop,
  onCopyConversation,
  onClearConversation,
  onUndo,
  canUndo,
  maxCycles,
  onMaxCyclesChange,
}: AssistantComposerProps) {
  return (
    <div className="assistant-input-area">
      <textarea
        value={draft}
        onChange={(event) => onDraftChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            onSubmit();
          }
        }}
        placeholder="Create an internet research workflow…"
        rows={4}
      />
      <div className="assistant-actions">
        <div className="assistant-actions-icons">
          <button
            type="button"
            className="assistant-icon-button"
            onClick={onCopyConversation}
            title="Copy conversation"
            aria-label="Copy assistant conversation"
          >
            <IconCopy />
          </button>
          <button
            type="button"
            className="assistant-icon-button"
            onClick={onClearConversation}
            disabled={busy}
            title="Clear conversation"
            aria-label="Clear assistant conversation"
          >
            <IconClear />
          </button>
          <button
            type="button"
            className="assistant-icon-button"
            onClick={onUndo}
            disabled={!canUndo || busy}
            title="Undo last assistant turn"
            aria-label="Undo last assistant turn"
          >
            <IconUndo />
          </button>
        </div>
        <div className="assistant-actions-send">
          <select
            className="assistant-cycles-select"
            value={maxCycles}
            onChange={(event) => onMaxCyclesChange(normalizeMaxCycles(event.target.value))}
            disabled={busy}
            title="Maximum autonomous planning cycles per turn"
            aria-label="Maximum autonomous planning cycles per turn"
          >
            {AUTHORING_CYCLE_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option} cycles
              </option>
            ))}
          </select>
          {busy ? (
            <button type="button" className="danger" onClick={onStop} disabled={stopRequested}>
              {stopRequested ? 'Stopping…' : 'Stop'}
            </button>
          ) : (
            <button type="button" className="primary" onClick={onSubmit} disabled={!draft.trim()}>
              Send
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
