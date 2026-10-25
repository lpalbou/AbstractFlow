// Framework ADR-0039 on Flow's screens: a spinner and an animated "Loading…"
// where the content will be until the read answered, never an empty state or
// a count; an error with the reason and Retry only once every try failed.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { VisualFlow } from '../types/flow';
import { LoadingLine, ReadFailed } from './ReadState';
import { FlowLibraryModal } from './FlowLibraryModal';
import { TriggeredRunPanel } from './automation/TriggeredRunPanel';
import { RunHistoryModal } from './RunHistoryModal';
import { pickerSupport } from './automation/TriggerPicker';

const SPINNER = 'class="read-loading__spinner"';

describe('LoadingLine / ReadFailed', () => {
  it('a spinner and the text with animated dots, announced politely', () => {
    const html = renderToStaticMarkup(createElement(LoadingLine, { text: 'Loading your saved flows' }));
    expect(html).toContain('role="status"');
    expect(html).toContain(SPINNER);
    expect(html).toContain('Loading your saved flows<span class="read-loading__dots" aria-hidden="true"></span>');
  });

  it('the reason and Retry', () => {
    const html = renderToStaticMarkup(createElement(ReadFailed, { onRetry: () => {}, children: 'Could not read: HTTP 503' }));
    expect(html).toContain('role="alert"');
    expect(html).toContain('Could not read: HTTP 503');
    expect(html).toContain('>Retry</button>');
  });
});

describe('Flow Library', () => {
  const base = {
    isOpen: true,
    currentFlowId: null,
    onClose: () => undefined,
    onRefresh: () => undefined,
    onLoadFlow: () => undefined,
    onRenameFlow: () => undefined,
    onUpdateDescription: () => undefined,
    onUpdateInterfaces: () => undefined,
    onUpdateAutomationDefaults: () => undefined,
    gatewayContracts: null,
    onDuplicateFlow: () => undefined,
    onDeleteFlow: () => undefined,
  };
  const example = { id: 'ex1', name: 'An example', nodes: [], edges: [] } as unknown as VisualFlow;

  it('before the saved flows answer: a spinner, no counts, no "No flows yet"; the examples stay listed', () => {
    const empty = renderToStaticMarkup(createElement(FlowLibraryModal, { ...base, flows: [], savedPending: true }));
    expect(empty).toContain('Loading saved flows');
    expect(empty).toContain('Loading your saved flows');
    expect(empty).toContain(SPINNER);
    expect(empty).not.toContain('No flows yet');
    expect(empty).not.toMatch(/\d+ flows?:/);
    expect(empty).not.toMatch(/class="flow-library-kind-count">\d/);
    const withExamples = renderToStaticMarkup(createElement(FlowLibraryModal, { ...base, flows: [example], readonlyFlowIds: ['ex1'], savedPending: true }));
    expect(withExamples).toContain('Loading your saved flows');
    expect(withExamples).toContain('An example');
  });

  it('answered: counts; failed after every try: the reason and Retry', () => {
    const answered = renderToStaticMarkup(createElement(FlowLibraryModal, { ...base, flows: [] }));
    expect(answered).not.toContain(SPINNER);
    expect(answered).toContain('No flows yet');
    const failed = renderToStaticMarkup(createElement(FlowLibraryModal, { ...base, flows: [], error: new Error('HTTP 503') }));
    expect(failed).toContain('Could not load your saved flows: HTTP 503.');
    expect(failed).toContain('>Retry</button>');
    expect(failed).toContain('role="alert"');
  });
});

describe('Run as if triggered', () => {
  const trigger = { source_id: 'feed.item', source_version: 1, connection_id: 'c1', config: {} } as never;
  const props = { trigger, count: 3, onCount: () => {}, edited: false, onUseSample: () => {} };

  it('reading the sample: a spinner, not the plan or an error', () => {
    const html = renderToStaticMarkup(createElement(TriggeredRunPanel, { ...props, busy: true, error: 'old' }));
    expect(html).toContain(SPINNER);
    expect(html).toContain('Reading what would arrive');
    expect(html).not.toContain('Run reads the last');
    expect(html).not.toContain('old');
  });

  it('failed after every try: the reason, and Run tries again (the dialog has one Run)', () => {
    const html = renderToStaticMarkup(createElement(TriggeredRunPanel, { ...props, busy: false, error: 'Could not read what would arrive: HTTP 502' }));
    expect(html.replace(/<!-- -->/g, '')).toContain('Could not read what would arrive: HTTP 502. Press Run to try again.');
    expect(html).toContain('role="alert"');
    expect(html).not.toContain('<button');
    expect(html).not.toContain(SPINNER);
  });
});

describe('Run history', () => {
  it('opens on a spinner, never "No runs found" before the list answered', () => {
    const html = renderToStaticMarkup(createElement(RunHistoryModal, { isOpen: true, workflowId: 'wf', onClose: () => {}, onSelectRun: () => {} }));
    expect(html).toContain('Loading runs');
    expect(html).toContain(SPINNER);
    expect(html).not.toContain('No runs found');
  });
});

describe('the trigger picker read state', () => {
  const LOADING = { state: 'loading' } as const;
  const OK_SOURCES = { state: 'ok' as const, value: { status: 'ok' as const, endpoint: 'x', items: [] } };
  const NO_MAIL = { state: 'ok' as const, value: { status: 'ok' as const, mailboxes: [] } };
  const NO_CONN = { state: 'ok' as const, value: { status: 'ok' as const, connections: [] } };

  it('loading until sources, mailboxes and connections have all answered', () => {
    expect(pickerSupport({ sources: LOADING, mailboxes: NO_MAIL, connections: NO_CONN }).arrivalsRead).toEqual({ state: 'loading' });
    expect(pickerSupport({ sources: OK_SOURCES, mailboxes: LOADING, connections: NO_CONN }).arrivalsRead).toEqual({ state: 'loading' });
    expect(pickerSupport({ sources: OK_SOURCES, mailboxes: NO_MAIL, connections: LOADING }).arrivalsRead).toEqual({ state: 'loading' });
    expect(pickerSupport({ sources: OK_SOURCES, mailboxes: NO_MAIL, connections: NO_CONN }).arrivalsRead).toEqual({ state: 'answered', failures: [] });
  });

  it('each failure, with what its Retry reloads', () => {
    const out = pickerSupport({
      sources: { state: 'error', message: 'HTTP 502' },
      mailboxes: { state: 'error', message: 'HTTP 503' },
      connections: { state: 'error', message: 'timeout' },
    });
    expect(out.arrivalsRead).toEqual({
      state: 'answered',
      failures: [
        { text: 'The gateway could not say what can start a flow: HTTP 502', retry: 'sources' },
        { text: 'Your mailboxes could not be read: HTTP 503', retry: 'arrivals' },
        { text: 'Your feeds and webhooks could not be read: timeout', retry: 'arrivals' },
      ],
    });
  });
});
