import { useState } from 'react';
import { InterfacePicker } from './InterfacePicker';
import { IconFilePlus } from './ToolbarIcons';
import { normalizeInterfaces } from '../utils/flowFamilies';

export interface NewFlowValues {
  name: string;
  description: string;
  interfaces: string[];
}

/** The values a New flow dialog creates with, or the reason Create is unavailable. */
export function newFlowValues(name: string, description: string, interfaces: string[]): NewFlowValues | { error: string } {
  const title = name.trim();
  if (!title) return { error: 'A title is required.' };
  return { name: title, description: description.trim(), interfaces: normalizeInterfaces(interfaces) };
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
}: {
  unsavedChanges: boolean;
  onCreate: (values: NewFlowValues) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [interfaces, setInterfaces] = useState<string[]>([]);
  const result = newFlowValues(name, description, interfaces);
  const error = 'error' in result ? result.error : '';
  const create = () => {
    if (!('error' in result)) onCreate(result);
  };
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
            <p className="new-flow-subtitle">Name it now; the description and interfaces can wait.</p>
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
                      placeholder="What this workflow does, for whoever picks it in a list."
                    />
                  </div>
                </section>
              }
            />
          </div>
          <div className="modal-actions">
            <button type="button" className="modal-button cancel" onClick={onCancel}>
              Cancel
            </button>
            <button
              type="submit"
              className={`modal-button ${unsavedChanges ? 'danger' : 'primary'}`}
              disabled={Boolean(error)}
              title={error || undefined}
            >
              Create flow
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
