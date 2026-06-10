/**
 * Browser harness for verifying edge routing against the REAL Canvas:
 * real node components (with inset pin handles), real WorkflowEdge, real
 * store, and a REAL saved workflow (route_check_fixture.json — extracted
 * from the create-resume-v2 gateway bundle). The headless-Chrome assertion
 * script (route_check_browser.mjs) samples every rendered edge path.
 */

import React, { useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Canvas } from '../src/components/Canvas';
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
    __ROUTE_CHECK_READY?: boolean;
    __ROUTE_CHECK_EDGES?: Array<{ id: string; source: string; target: string; kind: string }>;
  }
}

window.__ROUTE_CHECK_EDGES = useFlowStore.getState().edges.map((e) => ({
  id: e.id,
  source: e.source,
  target: e.target,
  kind: String((e.data as Record<string, unknown> | undefined)?.routeKind ?? 'data'),
}));

function Harness() {
  useEffect(() => {
    window.__ROUTE_CHECK_READY = true;
  }, []);
  return (
    <div style={{ width: '100vw', height: '100vh' }}>
      <Canvas />
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
