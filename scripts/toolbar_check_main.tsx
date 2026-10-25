/**
 * Browser harness for visually checking the REAL app header + Toolbar
 * (segmented groups, SVG icons, the New / Open / Save states, the connection
 * button). Three headers, one per Save state:
 *
 *   Saved    mounted after an edit, so its baseline is the edited flow;
 *   Unsaved  mounted before the edit (the edit makes it dirty);
 *   Saving   mounted before the edit, then its Save is clicked and the
 *            stubbed gateway never answers the write.
 *
 * Gateway discovery is seeded with a minimal client contract that makes
 * VisualFlow storage (Open, Save) available; everything else the gateway
 * would answer is a 503, so Run and the other gateway buttons render their
 * disabled state. The stylesheet stack is the app's own (src/main.tsx), so the
 * responsive breakpoints apply.
 *
 * Usage (no dev server needed):
 *   npx vite build --config <a config with this page as input, base './'>
 *   TOOLBAR_CHECK_URL=file://…/scripts/toolbar_check.html node scripts/toolbar_check_shot.mjs
 * or with a dev server:
 *   npx vite --port 3015 --strictPort
 *   node scripts/toolbar_check_shot.mjs
 *   (append ?theme=light to check light themes)
 */

import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AfTopBarActions, applyTheme } from '@abstractframework/ui-kit';
import { Toolbar } from '../src/components/Toolbar';
import { useFlowStore } from '../src/hooks/useFlow';
import type { VisualFlow } from '../src/types/flow';
import fixture from './route_check_fixture.json';
import 'reactflow/dist/style.css';
import '@abstractframework/ui-kit/theme.css';
import '../src/styles/index.css';
import '../src/styles/categories.css';
import '../src/styles/nodes.css';
import '../src/styles/palette.css';
import '../src/styles/tooltip.css';
import '../src/styles/responsive.css';
import '../src/styles/space.css';

// Gateway stub: writes never answer (the Saving header stays saving), every
// other request is a 503 (no gateway in this harness).
window.fetch = ((_input: RequestInfo | URL, init?: RequestInit) => {
  const method = String(init?.method || 'GET').toUpperCase();
  if (method === 'POST' || method === 'PUT') return new Promise<Response>(() => undefined);
  return Promise.resolve(new Response('{"detail":"no gateway in the toolbar harness"}', { status: 503 }));
}) as typeof window.fetch;

useFlowStore.getState().loadFlow(fixture as unknown as VisualFlow);
applyTheme(new URLSearchParams(window.location.search).get('theme') || 'dark');

declare global {
  interface Window {
    __TOOLBAR_CHECK_READY?: boolean;
  }
}

function Header({ id, caption, connected }: { id: string; caption: string; connected: boolean }) {
  return (
    <>
      <div className="toolbar-check-caption">{caption}</div>
      <header className="app-header" data-check={id}>
        <div className="logo">
          <span className="logo-icon">&#x1F300;</span>
          <span className="logo-text">AbstractFlow</span>
        </div>
        <Toolbar />
        <AfTopBarActions
          assistant={{ open: !connected, onToggle: () => undefined, label: 'Authoring assistant' }}
          appearance={{ onOpen: () => undefined }}
          connection={{
            phase: connected ? 'connected' : 'disconnected',
            onConnect: () => undefined,
            onDisconnect: () => undefined,
          }}
        />
      </header>
    </>
  );
}

function Harness() {
  const [edited, setEdited] = useState(false);
  useEffect(() => {
    // Let the Unsaved and Saving toolbars take their baseline, then edit.
    const t = window.setTimeout(() => {
      useFlowStore.getState().setFlowName('Weekly inbox digest');
      setEdited(true);
    }, 50);
    return () => window.clearTimeout(t);
  }, []);
  useEffect(() => {
    if (!edited) return;
    const t = window.setTimeout(() => {
      const save = document.querySelector<HTMLButtonElement>('[data-check="saving"] .save-button');
      save?.click();
      window.__TOOLBAR_CHECK_READY = true;
    }, 100);
    return () => window.clearTimeout(t);
  }, [edited]);
  return (
    <div className="app-container" style={{ height: 'auto' }}>
      {edited ? <Header id="saved" caption="Saved" connected /> : null}
      <Header id="unsaved" caption="Unsaved changes" connected />
      <Header id="saving" caption="Saving" connected={false} />
    </div>
  );
}

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});
// Minimal client contract: VisualFlow storage is available (Open, Save).
queryClient.setQueryData(['gateway', 'capabilities'], {
  contracts: {
    version: 1,
    flow_editor: {
      available: true,
      visualflows: {
        crud: { available: true, collection_endpoint: 'api/gateway/visualflows', item_endpoint: 'api/gateway/visualflows/{flow_id}' },
      },
    },
  },
});

const style = document.createElement('style');
style.textContent =
  '.toolbar-check-caption{font:600 11px/1 system-ui;letter-spacing:.04em;text-transform:uppercase;padding:8px 16px 4px;color:var(--text-muted);background:var(--bg-primary)}';
document.head.appendChild(style);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={queryClient}>
    <Harness />
  </QueryClientProvider>
);
