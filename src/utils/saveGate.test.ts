import { describe, expect, it } from 'vitest';
import {
  dirtyFlowHasClickableSave,
  saveButtonDisabled,
  saveGateTooltip,
  type SaveGateInput,
} from './saveGate';

function gate(overrides: Partial<SaveGateInput> = {}): SaveGateInput {
  return {
    savePending: false,
    isEmptyFlow: false,
    hasUnsavedChanges: true,
    crudUnavailable: false,
    crudUnavailableReason: '',
    bundledReadOnly: false,
    ...overrides,
  };
}

describe('saveButtonDisabled', () => {
  it('enables save on a dirty flow', () => {
    expect(saveButtonDisabled(gate())).toBe(false);
  });

  it('disables save while a save is in flight', () => {
    expect(saveButtonDisabled(gate({ savePending: true }))).toBe(true);
  });

  it('disables save when nothing changed', () => {
    expect(saveButtonDisabled(gate({ hasUnsavedChanges: false }))).toBe(true);
  });

  it('disables save on an empty canvas', () => {
    expect(saveButtonDisabled(gate({ isEmptyFlow: true, hasUnsavedChanges: false }))).toBe(true);
  });

  // The regression: a disconnected/degraded gateway used to disable the button,
  // which made handleSave's explaining toast unreachable — the user saw an
  // orange dirty dot over a control that ate every click without a word.
  it('keeps save clickable when gateway CRUD is unavailable, so the reason can be shown', () => {
    expect(
      saveButtonDisabled(gate({ crudUnavailable: true, crudUnavailableReason: 'Gateway sign-in required' }))
    ).toBe(false);
  });

  it('keeps save clickable on a read-only bundled family, so the reason can be shown', () => {
    expect(saveButtonDisabled(gate({ bundledReadOnly: true }))).toBe(false);
  });
});

describe('dirtyFlowHasClickableSave', () => {
  it('holds for every combination of blocking reasons', () => {
    for (const crudUnavailable of [false, true]) {
      for (const bundledReadOnly of [false, true]) {
        for (const isEmptyFlow of [false, true]) {
          const input = gate({
            crudUnavailable,
            crudUnavailableReason: crudUnavailable ? 'Gateway sign-in required' : '',
            bundledReadOnly,
            // An empty canvas cannot be dirty; the store ties the two together.
            hasUnsavedChanges: !isEmptyFlow,
            isEmptyFlow,
          });
          expect(dirtyFlowHasClickableSave(input)).toBe(true);
        }
      }
    }
  });
});

describe('saveGateTooltip', () => {
  it('names the gateway reason first', () => {
    expect(
      saveGateTooltip(gate({ crudUnavailable: true, crudUnavailableReason: 'Gateway sign-in required' }))
    ).toBe('Gateway sign-in required');
  });

  it('falls back to a generic gateway reason when none is supplied', () => {
    expect(saveGateTooltip(gate({ crudUnavailable: true }))).toBe(
      'Gateway VisualFlow storage is unavailable'
    );
  });

  it('explains a read-only bundled family', () => {
    expect(saveGateTooltip(gate({ bundledReadOnly: true }))).toMatch(/read-only/);
  });

  it('explains an empty canvas', () => {
    expect(saveGateTooltip(gate({ isEmptyFlow: true, hasUnsavedChanges: false }))).toBe(
      'Add at least one node before saving'
    );
  });

  it('reports a clean flow', () => {
    expect(saveGateTooltip(gate({ hasUnsavedChanges: false }))).toBe('No unsaved changes');
  });

  it('offers the shortcut when a save is possible', () => {
    expect(saveGateTooltip(gate())).toBe('Save Flow (Ctrl/⌘+S)');
  });
});
