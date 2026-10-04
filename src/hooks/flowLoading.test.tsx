// Round 8 (R8.3): one loading screen while a flow opens (deep link or Open),
// with the flow's name and a Cancel that aborts the gateway requests.
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { deepLinkLoadingName, isAbortError, useFlowLoading } from './flowLoading';
import { FlowLoadingScreen, FlowLoadingView } from '../components/FlowLoadingScreen';

const screenSource = readFileSync(resolve(__dirname, '../components/FlowLoadingScreen.tsx'), 'utf8');

const toolbar = readFileSync(resolve(__dirname, '../components/Toolbar.tsx'), 'utf8');
const app = readFileSync(resolve(__dirname, '../App.tsx'), 'utf8');

afterEach(() => useFlowLoading.getState().cancel());

describe('flow loading state', () => {
  it('begin shows the name; finish clears only the current load', () => {
    const first = useFlowLoading.getState().begin('Deep research');
    expect(useFlowLoading.getState().name).toBe('Deep research');
    const second = useFlowLoading.getState().begin('Coding agent');
    expect(first.aborted).toBe(true); // a newer open cancels the older one
    useFlowLoading.getState().finish(first);
    expect(useFlowLoading.getState().name).toBe('Coding agent');
    useFlowLoading.getState().finish(second);
    expect(useFlowLoading.getState().name).toBeNull();
    expect(second.aborted).toBe(false);
  });

  it('cancel aborts the requests and hides the screen', () => {
    const signal = useFlowLoading.getState().begin('My flow');
    useFlowLoading.getState().cancel();
    expect(signal.aborted).toBe(true);
    expect(useFlowLoading.getState().name).toBeNull();
    expect(isAbortError(new DOMException('x', 'AbortError'))).toBe(true);
    expect(isAbortError(new Error('boom'))).toBe(false);
  });

  it('names a deep link before its manifest is read', () => {
    expect(deepLinkLoadingName({ bundleId: 'deep-research', version: '0.1.8', flowId: '' })).toBe('deep-research@0.1.8');
    expect(deepLinkLoadingName({ bundleId: 'b', version: '', flowId: 'f1' })).toBe('f1 · b');
  });
});

describe('FlowLoadingScreen', () => {
  it('renders nothing when no flow is loading', () => {
    expect(renderToStaticMarkup(createElement(FlowLoadingScreen))).toBe('');
  });
  it('shows the flow name and a Cancel button while loading', () => {
    const html = renderToStaticMarkup(createElement(FlowLoadingView, { name: 'Deep research', onCancel: () => {} }));
    expect(html).toContain('flow-loading');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('Opening <strong class="flow-loading__name">Deep research</strong>');
    expect(html).toMatch(/<button[^>]*class="flow-loading__cancel"[^>]*>Cancel<\/button>/);
  });
  it('the screen reads the shared store and its Cancel is the store cancel', () => {
    expect(screenSource).toContain('useFlowLoading((s) => s.name)');
    expect(screenSource).toContain('<FlowLoadingView name={name} onCancel={cancel} />');
  });
  it('is mounted over the editor, and both loaders use it with a cancellable signal', () => {
    expect(app).toContain('<FlowLoadingScreen />');
    // Open (flow library): the screen + the signal into the gateway request.
    expect(toolbar).toContain('const signal = beginFlowLoading(loadingName);');
    expect(toolbar).toContain('await fetchFlow(selectedFlowId, gatewayContracts, signal)');
    // Deep link: same screen, signal on every request of the loader.
    expect(toolbar).toContain('const loadingName = deepLinkLoadingName(link);');
    // The screen shows from the first render of a deep link (before the capability probe).
    expect(toolbar).toContain('deepLinkSignalRef.current = beginFlowLoading(deepLinkLoadingName(link));');
    expect(toolbar).toContain('const signal = deepLinkSignalRef.current || beginFlowLoading(loadingName);');
    expect((toolbar.match(/\{ signal \}/g) || []).length).toBeGreaterThanOrEqual(2);
    expect(toolbar).toContain('return await fetchFlow(flowId, gatewayContracts, signal);');
    expect((toolbar.match(/finishFlowLoading\(signal\)/g) || []).length).toBe(2);
  });
});
