/**
 * Browser harness: render any example flow on the REAL Canvas, no gateway.
 *   npx vite --port 3000
 *   open http://localhost:3000/scripts/flow_view.html?flow=multiagent-coding
 */
import React, { useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Canvas } from '../src/components/Canvas';
import { useFlowStore } from '../src/hooks/useFlow';
import type { VisualFlow } from '../src/types/flow';
import 'reactflow/dist/style.css';
import '@abstractframework/ui-kit/theme.css';
import '../src/styles/index.css';
import '../src/styles/nodes.css';
import '../src/styles/palette.css';
import '../src/styles/tooltip.css';

const flows = import.meta.glob('../examples/flows/*.json', { eager: true }) as Record<string, { default: VisualFlow }>;
const name = new URLSearchParams(location.search).get('flow') || 'multiagent-coding';
const hit = Object.entries(flows).find(([p]) => p.endsWith(`/${name}.json`));
if (hit) useFlowStore.getState().loadFlow(hit[1].default as VisualFlow);

function Harness() {
  useEffect(() => {
    (window as any).__FLOW_VIEW_READY = true;
    // Adversary probes drive real store actions from the console.
    (window as any).__flowStore = useFlowStore;
  }, []);
  return <div style={{ width: '100vw', height: '100vh' }}><Canvas /></div>;
}
const qc = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
ReactDOM.createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={qc}><Harness /></QueryClientProvider>
);
