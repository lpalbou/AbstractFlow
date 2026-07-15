/**
 * Browser harness for visually checking the Run modal (launch + execution
 * views) against the real RunFlowModal and a real saved workflow fixture.
 *
 * Usage:
 *   npx vite --port 3015 --strictPort
 *   open http://localhost:3015/scripts/runmodal_check.html                 (launch form)
 *   open http://localhost:3015/scripts/runmodal_check.html?view=exec      (execution view)
 *   open http://localhost:3015/scripts/runmodal_check.html?theme=light    (light theme)
 */

import React, { useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { applyTheme } from '@abstractframework/ui-kit';
import { RunFlowModal } from '../src/components/RunFlowModal';
import { useFlowStore } from '../src/hooks/useFlow';
import type { VisualFlow, ExecutionEvent, FlowRunResult } from '../src/types/flow';
import fixture from './route_check_fixture.json';
import '@abstractframework/ui-kit/theme.css';
import '../src/styles/index.css';
import '../src/styles/nodes.css';
import '../src/styles/palette.css';
import '../src/styles/tooltip.css';

const params = new URLSearchParams(window.location.search);
useFlowStore.getState().loadFlow(fixture as unknown as VisualFlow);
applyTheme(params.get('theme') || 'dark');

const view = params.get('view') || 'launch';
const T0 = '2026-07-11T10:00:00.000Z';
const T1 = '2026-07-11T10:00:04.200Z';
const T2 = '2026-07-11T10:00:09.800Z';

const execEvents: ExecutionEvent[] = [
  { type: 'flow_start', ts: T0, runId: 'run-check-0001' },
  { type: 'node_start', ts: T0, runId: 'run-check-0001', nodeId: 'node-1' },
  { type: 'node_complete', ts: T1, runId: 'run-check-0001', nodeId: 'node-1', result: { prompt: 'Write my resume' }, meta: { duration_ms: 320 } },
  { type: 'node_start', ts: T1, runId: 'run-check-0001', nodeId: 'node-4' },
  {
    type: 'node_complete',
    ts: T2,
    runId: 'run-check-0001',
    nodeId: 'node-4',
    result: { content: 'Introduction drafted with a warm, direct tone.', model: 'qwen3.5-4b', provider: 'lmstudio' },
    meta: { duration_ms: 5600, input_tokens: 1421, output_tokens: 380, tokens_per_s: 42.1 },
  },
  { type: 'node_start', ts: T2, runId: 'run-check-0001', nodeId: 'node-7' },
  { type: 'flow_error', ts: T2, runId: 'run-check-0001', nodeId: 'node-7', error: 'Provider timeout after 30s (llm_call)' },
  { type: 'node_start', ts: T2, runId: 'run-check-0001', nodeId: 'node-6' },
  {
    type: 'node_progress',
    ts: T2,
    runId: 'run-check-0001',
    nodeId: 'node-6',
    progress: { summary: 'streaming tokens', percent: 62.5 },
  },
];

// Terminal run (view=final): two completed llm steps with token metrics + a
// flow_complete, so the Final Result panel + aggregate run-stats bar render.
const T3 = '2026-07-11T10:00:15.500Z';
const finalEvents: ExecutionEvent[] = [
  { type: 'flow_start', ts: T0, runId: 'run-final-0001' },
  { type: 'node_start', ts: T0, runId: 'run-final-0001', nodeId: 'node-1' },
  { type: 'node_complete', ts: T1, runId: 'run-final-0001', nodeId: 'node-1', result: { prompt: 'Write my resume' }, meta: { duration_ms: 320 } },
  { type: 'node_start', ts: T1, runId: 'run-final-0001', nodeId: 'node-4' },
  {
    type: 'node_complete',
    ts: T2,
    runId: 'run-final-0001',
    nodeId: 'node-4',
    result: { content: 'Draft one.', model: 'gpt-oss-120b', provider: 'endpoint:ovh-provider' },
    meta: { duration_ms: 5600, input_tokens: 1421, output_tokens: 380, tokens_per_s: 42.1 },
  },
  { type: 'node_start', ts: T2, runId: 'run-final-0001', nodeId: 'node-6' },
  {
    type: 'node_complete',
    ts: T3,
    runId: 'run-final-0001',
    nodeId: 'node-6',
    result: { content: 'Final synthesized answer.', model: 'gpt-oss-120b', provider: 'endpoint:ovh-provider' },
    meta: { duration_ms: 5700, input_tokens: 2050, output_tokens: 640, tokens_per_s: 39.4 },
  },
  { type: 'flow_complete', ts: T3, runId: 'run-final-0001', result: { content: 'Final synthesized answer.' } },
];
const finalResult: FlowRunResult = { success: true, result: { content: 'Final synthesized answer.' }, run_id: 'run-final-0001' };

declare global {
  interface Window {
    __RUNMODAL_CHECK_READY?: boolean;
  }
}

function Harness() {
  useEffect(() => {
    window.__RUNMODAL_CHECK_READY = true;
  }, []);
  const noop = () => undefined;
  return (
    <div style={{ width: '100vw', height: '100vh' }}>
      <RunFlowModal
        isOpen
        onClose={noop}
        onRun={noop}
        isRunning={view === 'exec'}
        result={view === 'final' ? finalResult : null}
        events={view === 'exec' ? execEvents : view === 'final' ? finalEvents : []}
        runTargetLabel={String((fixture as { flow_name?: string }).flow_name || 'workflow')}
      />
    </div>
  );
}

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={queryClient}>
    <Harness />
  </QueryClientProvider>
);
