import { AUTHORING_CYCLE_OPTIONS, normalizeMaxCycles } from './assistantSettings';
import { IconClear, IconCopy, IconUndo } from './icons';
import { ChatComposer } from '@abstractframework/panel-chat';

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
      <ChatComposer
        value={draft}
        onChange={onDraftChange}
        onSubmit={onSubmit}
        submitKey="mod-enter"
        busy={busy}
        busyLabel={stopRequested ? 'Stopping…' : 'Working…'}
        ariaLabel="Message to workflow assistant"
        placeholder="Create an internet research workflow…"
        actions={
        <>
        <div className="assistant-actions-icons">
          <button
            type="button"
            className="assistant-icon-button pc-workflow-chat__icon-button"
            onClick={onCopyConversation}
            title="Copy conversation"
            aria-label="Copy assistant conversation"
          >
            <IconCopy />
          </button>
          <button
            type="button"
            className="assistant-icon-button pc-workflow-chat__icon-button"
            onClick={onClearConversation}
            disabled={busy}
            title="Clear conversation"
            aria-label="Clear assistant conversation"
          >
            <IconClear />
          </button>
          <button
            type="button"
            className="assistant-icon-button pc-workflow-chat__icon-button"
            onClick={onUndo}
            disabled={!canUndo || busy}
            title="Undo last assistant turn"
            aria-label="Undo last assistant turn"
          >
            <IconUndo />
          </button>
        </div>
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
        </>
        }
        trailingActions={busy ? (
            <button type="button" className="pc-workflow-chat__stop" onClick={onStop} disabled={stopRequested}>
              {stopRequested ? 'Stopping…' : 'Stop'}
            </button>
          ) : null}
      />
    </div>
  );
}
