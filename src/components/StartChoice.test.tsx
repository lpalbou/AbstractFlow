// Operator 2026-10-11: AbstractFlow opens on two buttons, Create Flow and Open
// Flow, that lead to the New flow dialog and the Flow Library.
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StartChoice } from './StartChoice';
import { NewFlowDialog } from './NewFlowDialog';
import { isBlankStartDocument, useFlowStore } from '../hooks/useFlow';
import { NEW_FLOW_EVENT, OPEN_FLOW_EVENT, requestNewFlow, requestOpenFlow } from '../utils/flowStart';

afterEach(() => {
  vi.unstubAllGlobals();
  useFlowStore.getState().clearFlow();
});

describe('start screen', () => {
  it('shows only on the blank start document', () => {
    const store = useFlowStore.getState();
    store.clearFlow();
    expect(isBlankStartDocument(useFlowStore.getState())).toBe(true);
    for (const change of [
      () => useFlowStore.getState().setFlowName('Release notes reviewer'),
      () => useFlowStore.getState().setFlowDescription('Reads release notes.'),
      () => useFlowStore.getState().setFlowInterfaces(['abstractcode.agent.v1']),
      () => useFlowStore.getState().setFlowId('flow-1'),
    ]) {
      useFlowStore.getState().clearFlow();
      change();
      expect(isBlankStartDocument(useFlowStore.getState())).toBe(false);
    }
  });

  it('offers Create Flow and Open Flow side by side', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } });
    const html = renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(StartChoice)));
    expect(html).toContain('Create Flow');
    expect(html).toContain('Open Flow');
    expect(html.match(/<button type="button"/g)).toHaveLength(2);
    expect(html).toContain('From the Flow Library');
    expect(html).toContain('aria-busy="false"');
  });

  it('each button asks the toolbar for its dialog', () => {
    const target = new EventTarget();
    vi.stubGlobal('window', target);
    const heard: string[] = [];
    target.addEventListener(NEW_FLOW_EVENT, () => heard.push('new'));
    target.addEventListener(OPEN_FLOW_EVENT, () => heard.push('open'));
    requestNewFlow();
    requestOpenFlow();
    expect(heard).toEqual(['new', 'open']);
    const toolbar = readFileSync(new URL('./Toolbar.tsx', import.meta.url), 'utf8');
    expect(toolbar).toContain('window.addEventListener(NEW_FLOW_EVENT, openNew);');
    expect(toolbar).toContain('window.addEventListener(OPEN_FLOW_EVENT, openLibrary);');
    const canvas = readFileSync(new URL('./Canvas.tsx', import.meta.url), 'utf8');
    expect(canvas).toMatch(/\{blankStart \? \(\s*<StartChoice \/>/);
  });

  it('the New flow window is the Flow Library window', () => {
    const html = renderToStaticMarkup(createElement(NewFlowDialog, { unsavedChanges: false, onCreate: () => {}, onCancel: () => {} }));
    expect(html).toContain('class="modal flow-library-modal new-flow-dialog"');
  });
});

describe('Flow Library inline edits', () => {
  it('the always-visible footer carries the edit’s Cancel / Save (no in-panel action row below the fold)', () => {
    const library = readFileSync(new URL('./FlowLibraryModal.tsx', import.meta.url), 'utf8');
    expect(library).not.toContain('flow-library-preview-actions');
    expect(library).toMatch(/\{inlineEdit && selectedFlow \? \(/);
    expect(library).toContain("Save {inlineEdit === 'name' ? 'Name' : inlineEdit === 'description' ? 'Description' : 'Interfaces'}");
    // Editing interfaces gives the picker the whole body (the list | preview body is hidden).
    expect(library).toMatch(/\{isEditingInterfaces && selectedFlow \? \(\s*<div className="flow-library-interfaces-edit"[^>]*>\s*<InterfacePicker/);
    expect(library).toContain('<div className="flow-library-body" hidden={isEditingInterfaces && Boolean(selectedFlow)}>');
  });
});
