/**
 * The new automation flow's next step, over the canvas (UX review #20):
 * "Next: tell the Agent what to do with the new items under Automation →
 * What each run is asked to do." Automation… opens the dialog; × dismisses.
 */
import { useFlowStore } from '../../hooks/useFlow';

/** The Toolbar opens the open flow's Automation dialog on this window event. */
export const OPEN_AUTOMATION_EVENT = 'abstractflow:open-automation';

export function CanvasNote() {
  const note = useFlowStore((s) => s.canvasNote);
  const setNote = useFlowStore((s) => s.setCanvasNote);
  if (!note) return null;
  return (
    <div className="canvas-note" role="note">
      <span className="canvas-note-text">{note}</span>
      <button type="button" className="canvas-note-action" onClick={() => window.dispatchEvent(new Event(OPEN_AUTOMATION_EVENT))}>
        Automation…
      </button>
      <button type="button" className="canvas-note-dismiss" aria-label="Dismiss" title="Dismiss" onClick={() => setNote(null)}>
        ×
      </button>
    </div>
  );
}
