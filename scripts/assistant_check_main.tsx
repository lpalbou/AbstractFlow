/**
 * Browser harness for visually checking the Authoring Assistant drawer chrome:
 * bottom icon actions (copy/clear/undo + Send), and the collapsible live
 * activity status card. The left pane mounts the REAL drawer (idle state;
 * gateway calls fail by design in this harness). The right pane shows static
 * replicas of the busy and finished status card states using the exact
 * production class names, because those states require a live Gateway run.
 *
 * Usage:
 *   npx vite --port 3015 --strictPort
 *   node scripts/assistant_check_shot.mjs
 *   (append ?theme=one-light to check light themes)
 */

import { useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { applyTheme } from '@abstractframework/ui-kit';
import { AuthoringAssistantDrawer } from '../src/components/AuthoringAssistantDrawer';
import { useFlowStore } from '../src/hooks/useFlow';
import type { VisualFlow } from '../src/types/flow';
import fixture from './route_check_fixture.json';
import 'reactflow/dist/style.css';
import '@abstractframework/ui-kit/theme.css';
import '../src/styles/index.css';
import '../src/styles/nodes.css';
import '../src/styles/palette.css';
import '../src/styles/tooltip.css';

useFlowStore.getState().loadFlow(fixture as unknown as VisualFlow);
applyTheme(new URLSearchParams(window.location.search).get('theme') || 'dark');

declare global {
  interface Window {
    __ASSISTANT_CHECK_READY?: boolean;
  }
}

const SAMPLE_ACTIVITY = [
  { id: 'a1', kind: 'info', time: '0:00', text: 'Turn started (request 412 chars)' },
  { id: 'a2', kind: 'model', time: '0:01', text: 'Cycle 1: sending plan request (28k chars prompt)' },
  { id: 'a3', kind: 'model', time: '0:42', text: 'Cycle 1: response received (6k chars)' },
  { id: 'a4', kind: 'model', time: '0:42', text: 'Cycle 1: plan status "continue" with 24 commands' },
  { id: 'a5', kind: 'apply', time: '0:43', text: 'Cycle 1: applied 22 changes — Added On Flow Start; Added Boucle des cycles; Added LLM Call; +19 more' },
  { id: 'a6', kind: 'error', time: '0:43', text: 'Cycle 1: skipped 2 invalid commands (kept the rest): connect refused invalid edge x.y -> z.w | …' },
  { id: 'a7', kind: 'review', time: '1:58', text: 'Acceptance review 1/3: checking graph against the request…' },
];

function Chevron({ collapsed }: { collapsed: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width={14} height={14} style={{ transform: collapsed ? 'rotate(-90deg)' : 'none', flex: '0 0 auto' }}>
      <path d="M6 9.5 12 15.5 18 9.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ActivityLog() {
  return (
    <div className="assistant-activity-log">
      {SAMPLE_ACTIVITY.map((entry) => (
        <div key={entry.id} className={`assistant-activity-entry ${entry.kind}`}>
          <span className="assistant-activity-time">{entry.time}</span>
          <span className="assistant-activity-text">{entry.text}</span>
        </div>
      ))}
    </div>
  );
}

function StatusCardReplica() {
  return (
    <div className="assistant-run-status active" style={{ marginTop: 10 }}>
      <button type="button" className="assistant-run-status-header">
        <span className="assistant-run-spinner" aria-hidden="true" />
        <span className="assistant-run-status-label">Planning workflow graph (cycle 2)</span>
        <span className="assistant-run-status-meta">2:14</span>
        <span role="button" tabIndex={0} className="assistant-stop-button">
          Stop
        </span>
        <Chevron collapsed={false} />
      </button>
      <ActivityLog />
      <div className="assistant-run-status-footer">
        <span>22 changes applied</span>
        <span>Readiness checks passed</span>
      </div>
    </div>
  );
}

/** Finished turn: card persists with a status dot, no spinner/stop. */
function FinishedCardReplica() {
  return (
    <div className="assistant-run-status active" style={{ marginTop: 10 }}>
      <button type="button" className="assistant-run-status-header">
        <span className="assistant-run-status-dot done" aria-hidden="true" />
        <span className="assistant-run-status-label">Draft graph updated</span>
        <span className="assistant-run-status-meta">3:41</span>
        <Chevron collapsed={false} />
      </button>
      <ActivityLog />
      <div className="assistant-run-status-footer">
        <span>31 changes applied</span>
        <span>Readiness checks passed</span>
      </div>
    </div>
  );
}

/** Collapsed finished turn: header only. */
function CollapsedCardReplica() {
  return (
    <div className="assistant-run-status blocked" style={{ marginTop: 10 }}>
      <button type="button" className="assistant-run-status-header">
        <span className="assistant-run-status-dot blocked" aria-hidden="true" />
        <span className="assistant-run-status-label">Interrupted by user</span>
        <span className="assistant-run-status-meta">1:07</span>
        <Chevron collapsed />
      </button>
    </div>
  );
}

function Harness() {
  useEffect(() => {
    window.__ASSISTANT_CHECK_READY = true;
  }, []);
  return (
    <div style={{ display: 'flex', height: '100%', background: 'var(--bg-primary)' }}>
      <div style={{ width: 420, height: '100%', borderRight: '1px solid var(--border-color)' }}>
        <AuthoringAssistantDrawer isOpen />
      </div>
      <div style={{ width: 420, padding: '10px 0', overflowY: 'auto' }}>
        <StatusCardReplica />
        <FinishedCardReplica />
        <CollapsedCardReplica />
      </div>
    </div>
  );
}

const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <QueryClientProvider client={client}>
    <Harness />
  </QueryClientProvider>
);
