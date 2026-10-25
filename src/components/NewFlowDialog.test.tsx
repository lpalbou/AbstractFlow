// Operator 2026-10-11: creating a workflow starts with a screen for its title,
// an optional description and optional interfaces.
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { NewFlowDialog, newFlowValues } from './NewFlowDialog';
import { interfaceScaffoldTypes, useFlowStore } from '../hooks/useFlow';
import { descriptionFromPutResponse, updateOpenFlowMetadata } from '../hooks/openFlowMetadata';
import type { VisualFlow } from '../types/flow';

describe('New flow dialog', () => {
  it('a title is required; the description and interfaces are optional and normalized', () => {
    expect(newFlowValues('   ', 'x', [])).toEqual({ error: 'A title is required.' });
    expect(newFlowValues('  Release reviewer ', '  Reads release notes. ', [])).toEqual({
      name: 'Release reviewer',
      description: 'Reads release notes.',
      interfaces: [],
    });
    expect(newFlowValues('A', '', ['abstractcode.agent.v1', 'abstractcode.agent.v1'])).toEqual({ name: 'A', description: '', interfaces: ['abstractcode.agent.v1'] });
  });

  it('shows title, description and interfaces; warns only when unsaved changes would be lost', () => {
    const clean = renderToStaticMarkup(createElement(NewFlowDialog, { unsavedChanges: false, onCreate: () => {}, onCancel: () => {} }));
    expect(clean).toContain('>Title</label>');
    expect(clean).toContain('Description <span class="new-flow-optional">optional</span>');
    expect(clean).toContain('Interfaces <span class="new-flow-optional">optional</span>');
    expect(clean).toContain('Runnable agent (v1)');
    expect(clean).not.toContain('unsaved changes');
    // Create is unavailable until a title is typed.
    expect(clean).toMatch(/<button type="submit"[^>]*disabled=""/);
    const dirty = renderToStaticMarkup(createElement(NewFlowDialog, { unsavedChanges: true, onCreate: () => {}, onCancel: () => {} }));
    expect(dirty).toContain('creating a new flow discards them');
  });

  // Operator ruling 2026-10-25: a schedule is a property of an automation, set in Observer or the
  // Assistant, never in Flow. What starts it: a chat, something arriving, or by hand.
  it('What starts it? offers a chat, something arriving or by hand, never a schedule', () => {
    const html = renderToStaticMarkup(createElement(NewFlowDialog, { unsavedChanges: false, onCreate: () => {}, onCancel: () => {} }));
    const choices = Array.from(html.matchAll(/role="radio"[^>]*>[\s\S]*?class="automation-choice-title">([^<]+)</g)).map((m) => m[1]);
    expect(choices).toEqual(['A person, in a chat', 'When something arrives', 'By hand (Run now only)']);
    expect(html).toContain('On a schedule? Schedules are set in Observer or the Assistant.');
    expect(html).not.toMatch(/Every day, every week|Time zone/);
  });

  it('New Flow always opens the dialog, and Create sets the title, description and interfaces', () => {
    const toolbar = readFileSync(new URL('./Toolbar.tsx', import.meta.url), 'utf8');
    expect(toolbar).toMatch(/const handleNew = useCallback\(\(\) => \{\s*setNewFlowTrigger\(null\);\s*setShowNewFlowModal\(true\);\s*\}, \[\]\);/);
    expect(toolbar).toContain('useFlowStore.getState().createFlow(values);');
  });
});

describe('the flow description travels with the document', () => {
  it('is loaded, sent by getFlow (so Save stores it), and cleared for a new flow', () => {
    const store = useFlowStore.getState();
    store.clearFlow();
    store.loadFlow({ id: 'f1', name: 'Reviewer', description: 'Reads release notes.', interfaces: [], nodes: [], edges: [] } as VisualFlow);
    expect(useFlowStore.getState().getFlow().description).toBe('Reads release notes.');
    useFlowStore.getState().setFlowDescription('Second line of work.');
    expect(useFlowStore.getState().getFlow().description).toBe('Second line of work.');
    useFlowStore.getState().clearFlow();
    expect(useFlowStore.getState().getFlow().description).toBeUndefined();
  });

  it('a library edit of the OPEN flow patches its description (the next Save sends the new one)', async () => {
    const store = useFlowStore.getState();
    store.clearFlow();
    store.loadFlow({ id: 'f2', name: 'Reviewer', description: 'old', interfaces: [], nodes: [], edges: [] } as VisualFlow);
    const out = await updateOpenFlowMetadata({
      id: 'f2',
      hasUnsavedChanges: false,
      request: async () => ({ id: 'f2', name: 'Reviewer', description: 'new', interfaces: [], nodes: [], edges: [] }) as VisualFlow,
      patchFrom: (updated) => ({ description: descriptionFromPutResponse(updated) }),
    });
    expect(out.applied).toBe(true);
    expect(useFlowStore.getState().getFlow().description).toBe('new');
    expect(out.baseline?.description).toBe('new');
  });

  it('a description answer without a description is an error, never a guess', () => {
    expect(() => descriptionFromPutResponse({ id: 'x', name: 'n', nodes: [], edges: [] } as VisualFlow)).toThrow(/without a description/);
    expect(descriptionFromPutResponse({ id: 'x', name: 'n', description: '', nodes: [], edges: [] } as VisualFlow)).toBe('');
  });
});

describe('creating a flow with interfaces puts their nodes in place', () => {
  it('places On Flow Start and On Flow End with the interface pins, as the starting point (no undo step)', () => {
    useFlowStore.getState().createFlow({ name: 'Reviewer', description: 'Reads notes.', interfaces: ['abstractcode.agent.v1'] });
    const st = useFlowStore.getState();
    expect(st.flowName).toBe('Reviewer');
    expect(st.flowDescription).toBe('Reads notes.');
    expect(st.flowInterfaces).toEqual(['abstractcode.agent.v1']);
    const start = st.nodes.find((n) => n.data.nodeType === 'on_flow_start')!;
    const end = st.nodes.find((n) => n.data.nodeType === 'on_flow_end')!;
    expect(st.nodes).toHaveLength(2);
    expect(start.data.outputs.map((p) => p.id)).toEqual(['exec-out', 'provider', 'model', 'prompt']);
    expect(end.data.inputs.map((p) => p.id)).toEqual(['exec-in', 'response', 'success', 'meta']);
    expect(start.position.x).toBeLessThan(end.position.x);
    expect(st.edges).toEqual([]);
    expect(st.past).toEqual([]);
  });

  it('places nothing for a flow without interfaces, and only what the interfaces need', () => {
    useFlowStore.getState().createFlow({ name: 'Plain', description: '', interfaces: [] });
    expect(useFlowStore.getState().nodes).toEqual([]);
    expect(interfaceScaffoldTypes([])).toEqual([]);
    expect(interfaceScaffoldTypes(['abstractcode.agent.v1'])).toEqual(['on_flow_start', 'on_flow_end']);
  });

  it('starts from a cleared document', () => {
    useFlowStore.getState().createFlow({ name: 'A', description: '', interfaces: ['abstractcode.agent.v1'] });
    useFlowStore.getState().setFlowId('flow-a');
    useFlowStore.getState().createFlow({ name: 'B', description: '', interfaces: [] });
    const st = useFlowStore.getState();
    expect(st.flowId).toBeNull();
    expect(st.nodes).toEqual([]);
    expect(st.flowInterfaces).toEqual([]);
  });
});
