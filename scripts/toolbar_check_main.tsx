/**
 * Browser harness for visually checking the REAL app header + Toolbar
 * (segmented groups, SVG icons, connection button). Gateway calls fail in
 * this harness, so gateway-dependent buttons render their disabled state —
 * that is part of what we want to inspect.
 *
 * Usage:
 *   npx vite --port 3015 --strictPort
 *   node scripts/toolbar_check_shot.mjs
 */

import React, { useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toolbar } from '../src/components/Toolbar';
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

declare global {
  interface Window {
    __TOOLBAR_CHECK_READY?: boolean;
  }
}

function Harness() {
  useEffect(() => {
    window.__TOOLBAR_CHECK_READY = true;
  }, []);
  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <span className="logo-icon">&#x1F300;</span>
          <span className="logo-text">AbstractFlow</span>
        </div>
        <Toolbar gatewayConnected />
      </header>
      <header className="app-header">
        <div className="logo">
          <span className="logo-icon">&#x1F300;</span>
          <span className="logo-text">AbstractFlow</span>
        </div>
        <Toolbar gatewayConnected={false} />
      </header>
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
