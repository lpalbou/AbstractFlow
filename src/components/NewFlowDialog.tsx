import { useState } from 'react';
import { InterfacePicker } from './InterfacePicker';
import { IconFilePlus } from './ToolbarIcons';
import { normalizeInterfaces } from '../utils/flowFamilies';
import type { AutomationDefaults } from '../types/flow';
import type { GatewayContracts } from '../utils/gatewayClient';
import { AutomationChoiceError, automationFromChoice } from '../utils/automationChoice';
import { choiceFromPicker, emptyPicker, type PickerState } from '../utils/automationPicker';
import { TriggerPicker, pickerSupport } from './automation/TriggerPicker';
import { useAutomationFacts } from './automation/useAutomationFacts';

export interface NewFlowValues {
  name: string;
  description: string;
  interfaces: string[];
  /**
   * What starts it, when it is an automation (operator 2026-10-25): the
   * flow is created with On Flow Start, the Trigger event node wired to it,
   * and these defaults. Absent: a flow for chat.
   */
  automation?: AutomationDefaults;
}


/** The values a New flow dialog creates with, or the reason Create is unavailable. */
export function newFlowValues(
  name: string,
  description: string,
  interfaces: string[],
  start: { automation: AutomationDefaults | null; problem?: string } = { automation: null }
): NewFlowValues | { error: string } {
  const title = name.trim();
  if (!title) return { error: 'A title is required.' };
  if (start.problem) return { error: start.problem };
  return {
    name: title,
    description: description.trim(),
    interfaces: normalizeInterfaces(interfaces),
    ...(start.automation ? { automation: start.automation } : {}),
  };
}

/**
 * Creating a workflow starts here (operator 2026-10-11): its title, an optional
 * description and the optional interfaces it declares — before an empty canvas.
 * When the open flow has unsaved changes, the dialog says they will be lost.
 */
export function NewFlowDialog({
  unsavedChanges,
  onCreate,
  onCancel,
  gatewayContracts = null,
}: {
  unsavedChanges: boolean;
  onCreate: (values: NewFlowValues) => void;
  onCancel: () => void;
  gatewayContracts?: GatewayContracts | null;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [interfaces, setInterfaces] = useState<string[]>([]);
  const [picker, setPicker] = useState<PickerState>(emptyPicker('chat'));
  const isAutomation = picker.start !== null && picker.start !== 'chat';
  // Loaded once a trigger is chosen: a chat flow needs nothing from the gateway here.
  const facts = useAutomationFacts(gatewayContracts, { enabled: isAutomation });
  const support = pickerSupport(facts);
  const start = automationStart(picker, support);
  // An automation flow is the person's own workflow: no interface, no
  // prompt; On Flow Start carries what arrives (operator ruling 2026-10-25).
  const result = newFlowValues(name, description, isAutomation ? [] : interfaces, start);
  const error = 'error' in result ? result.error : '';
  const create = () => {
    if (!('error' in result)) onCreate(result);
  };
  const choosePicker = (next: PickerState) => setPicker(next);
  return (
    <div className="modal-overlay" onClick={onCancel} role="presentation">
      {/* The Flow Library's window (same size at every width): the two are the
          editor's two ways in. */}
      <div
        className="modal flow-library-modal new-flow-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-flow-title"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onCancel();
        }}
      >
        <div className="new-flow-header">
          <span className="new-flow-header-icon" aria-hidden="true">
            <IconFilePlus />
          </span>
          <div>
            <h3 id="new-flow-title">New flow</h3>
            <p className="new-flow-subtitle">
              {isAutomation
                ? 'Runs by itself when its trigger fires: what arrives is on On Flow Start, build the steps on the canvas.'
                : 'A flow for chat. Name it now; the description and interfaces can wait.'}
            </p>
          </div>
        </div>
        {unsavedChanges ? (
          <p className="new-flow-warning" role="note">
            The open flow has unsaved changes: creating a new flow discards them.
          </p>
        ) : null}
        <form
          className="new-flow-form"
          onSubmit={(e) => {
            e.preventDefault();
            create();
          }}
        >
          <div className="new-flow-body">
            {isAutomation ? (
              // An automation flow: no interfaces to choose (On Flow Start carries
              // what arrives, On Flow End the result).
              <div className="new-flow-automation-body">
                <section className="new-flow-details" aria-label="Details">
                  <div className="run-form-field">
                    <span className="run-form-label" id="new-flow-start-label">
                      What starts it?
                    </span>
                    <TriggerPicker
                      value={picker}
                      onChange={choosePicker}
                      data={support.data}
                      includeChat
                      gatewayUrl={facts.gatewayUrl}
                      arrivalsNote={support.arrivalsNote}
                      onRefreshArrivals={facts.reloadArrivals}
                      unavailable={support.unavailable}
                      idPrefix="new-flow-trigger"
                    />
                    {isAutomation && support.sourcesProblem ? <p className="automation-problem">{support.sourcesProblem}</p> : null}
                  </div>
                  <div className="run-form-field">
                    <label className="run-form-label" htmlFor="new-flow-name">
                      Title
                    </label>
                    <input
                      id="new-flow-name"
                      className="run-form-input"
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="e.g. Release notes reviewer"
                      autoFocus
                      required
                    />
                  </div>
                  <div className="run-form-field">
                    <label className="run-form-label" htmlFor="new-flow-description">
                      Description <span className="new-flow-optional">optional</span>
                    </label>
                    <textarea
                      id="new-flow-description"
                      className="run-form-input"
                      rows={3}
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder="What this flow does, for whoever picks it in a list."
                    />
                  </div>
                </section>
              </div>
            ) : (
              <InterfacePicker
                value={interfaces}
                onChange={setInterfaces}
                title={
                  <>
                    Interfaces <span className="new-flow-optional">optional</span>
                  </>
                }
                pinNote="The On Flow Start and On Flow End nodes you add get these pins; wire them so hosts get real values."
                leading={
                  <section className="new-flow-details" aria-label="Details">
                    <div className="run-form-field">
                      <span className="run-form-label" id="new-flow-start-label">
                        What starts it?
                      </span>
                      <TriggerPicker
                        value={picker}
                        onChange={choosePicker}
                        data={support.data}
                        includeChat
                        gatewayUrl={facts.gatewayUrl}
                        arrivalsNote={support.arrivalsNote}
                        onRefreshArrivals={facts.reloadArrivals}
                        unavailable={support.unavailable}
                        idPrefix="new-flow-trigger"
                      />
                      {isAutomation && support.sourcesProblem ? <p className="automation-problem">{support.sourcesProblem}</p> : null}
                    </div>
                    <div className="run-form-field">
                      <label className="run-form-label" htmlFor="new-flow-name">
                        Title
                      </label>
                      <input
                        id="new-flow-name"
                        className="run-form-input"
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="e.g. Release notes reviewer"
                        autoFocus
                        required
                      />
                    </div>
                    <div className="run-form-field">
                      <label className="run-form-label" htmlFor="new-flow-description">
                        Description <span className="new-flow-optional">optional</span>
                      </label>
                      <textarea
                        id="new-flow-description"
                        className="run-form-input"
                        rows={3}
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        placeholder="What this flow does, for whoever picks it in a list."
                      />
                    </div>
                  </section>
                }
              />
            )}
          </div>
          <div className="modal-actions">
            {error && name.trim() ? (
              <span className="modal-actions-note" role="status">
                {error}
              </span>
            ) : null}
            <button type="button" className="modal-button cancel" onClick={onCancel}>
              Cancel
            </button>
            <button
              type="submit"
              className={`modal-button ${unsavedChanges ? 'danger' : 'primary'}`}
              disabled={Boolean(error)}
              title={error || undefined}
            >
              {isAutomation ? 'Create automation flow' : 'Create flow'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/** The automation a picker state creates (null for chat), or why it cannot yet. */
export function automationStart(
  picker: PickerState,
  support: ReturnType<typeof pickerSupport>
): { automation: AutomationDefaults | null; problem?: string } {
  const picked = choiceFromPicker(picker, support.data);
  if ('problem' in picked) return { automation: null, problem: picked.problem };
  if (picked.choice.kind === 'chat') return { automation: null };
  if (support.sourcesProblem) return { automation: null, problem: support.sourcesProblem };
  try {
    return { automation: automationFromChoice(picked.choice, support.data.sources) };
  } catch (error) {
    if (error instanceof AutomationChoiceError) return { automation: null, problem: error.message };
    throw error;
  }
}
