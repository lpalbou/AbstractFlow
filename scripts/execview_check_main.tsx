/**
 * Browser harness for visually checking the condensed execution view against
 * the REAL Canvas and a real saved workflow (route_check_fixture.json).
 *
 * Usage:
 *   npx vite --port 3015 --strictPort
 *   open http://localhost:3015/scripts/execview_check.html        (full view)
 *   open http://localhost:3015/scripts/execview_check.html?exec=1 (exec view)
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
if (new URLSearchParams(window.location.search).get('exec') === '1') {
  useFlowStore.getState().setExecView(true);
}

declare global {
  interface Window {
    __EXECVIEW_CHECK_READY?: boolean;
  }
}

function Harness() {
  useEffect(() => {
    window.__EXECVIEW_CHECK_READY = true;
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
