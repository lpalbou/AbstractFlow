/**
 * Wait for Event > Advanced (operator 2026-10-25): the palette offers one Wait
 * for Event node; this switch moves a node between its two forms, the
 * runtime's two ways of waiting for an event (both WAIT_EVENT):
 *
 * - on its own branch, for a named event (`on_event`: name + scope; Emit Event
 *   wakes it; it waits again when the branch ends);
 * - at this step, for an event key (`wait_event`: event_key, an optional
 *   question with choices, a deadline and wait details).
 *
 * One `updateNodeData` call: one undo step; wires to pins the other form does
 * not have are dropped (the hint says how many before you switch).
 */
import type { Edge } from 'reactflow';
import type { FlowNodeData } from '../types/flow';
import { switchWaitForEventForm, wiresDroppedBySwitch, type WaitForEventForm } from '../utils/waitNodes';

const FORMS: { form: WaitForEventForm; title: string; sub: string }[] = [
  {
    form: 'on_event',
    title: 'For a named event, on its own branch',
    sub: 'Name and scope pick the event; Emit Event wakes it. Its branch runs with the event and its payload, then it waits again.',
  },
  {
    form: 'wait_event',
    title: 'At this step, for an event key',
    sub: 'The run stops here until the key arrives, then goes on with event_data. Optional: a question with choices for whoever runs it, a deadline (until), wait details.',
  },
];

export function WaitForEventAdvanced({
  nodeId,
  data,
  edges,
  updateNodeData,
}: {
  nodeId: string;
  data: FlowNodeData;
  edges: Edge[];
  updateNodeData: (nodeId: string, data: Partial<FlowNodeData>) => void;
}) {
  const current = data.nodeType as WaitForEventForm;
  const other: WaitForEventForm = current === 'on_event' ? 'wait_event' : 'on_event';
  const dropped = wiresDroppedBySwitch(nodeId, other, edges);
  return (
    <div className="property-section">
      <details className="automation-more">
        <summary>Advanced</summary>
        <div className="automation-more-body" role="radiogroup" aria-label="How it waits">
          <span className="property-sublabel">How it waits</span>
          {FORMS.map((f) => (
            <label key={f.form} className="automation-arrival">
              <input
                type="radio"
                name={`wait-form-${nodeId}`}
                value={f.form}
                checked={current === f.form}
                onChange={() => {
                  if (f.form !== current) updateNodeData(nodeId, switchWaitForEventForm(data, f.form));
                }}
              />
              <span>
                {f.title}
                <span className="automation-muted"> · {f.sub}</span>
              </span>
            </label>
          ))}
          <span className="property-hint">
            {dropped > 0
              ? `Switching removes ${dropped === 1 ? '1 wire' : `${dropped} wires`} to pins the other form does not have. Undo brings ${dropped === 1 ? 'it' : 'them'} back.`
              : 'Switching keeps every wire of this node.'}
          </span>
        </div>
      </details>
    </div>
  );
}
