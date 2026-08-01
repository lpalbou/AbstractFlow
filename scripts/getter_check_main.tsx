/**
 * Browser harness for the compact Get Variable render (2026-07-30).
 *
 * Renders the REAL Canvas with getters in both states side by side so the
 * chip form can be eyeballed against the full-chrome form it replaces:
 * a configured getter collapses to a chip, an unconfigured one keeps its
 * name row (there is nothing to collapse to yet), and the config rows come
 * back on hover/selection.
 *
 * Usage:
 *   npx vite --port 3016 --strictPort
 *   open http://localhost:3016/scripts/getter_check.html
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

const TEAL = '#16A085';

function getter(id: string, name: string | null, x: number, y: number, dflt?: unknown) {
  const pinDefaults: Record<string, unknown> = {};
  if (name) pinDefaults.name = name;
  if (dflt !== undefined) pinDefaults.default = dflt;
  return {
    id,
    type: 'get_var',
    position: { x, y },
    data: {
      nodeType: 'get_var',
      label: name ? `Get ${name}` : 'Get Variable',
      icon: '&#x1F4E5;',
      headerColor: TEAL,
      inputs: [
        { id: 'name', label: 'name', type: 'string' },
        { id: 'default', label: 'default', type: 'any' },
      ],
      outputs: [{ id: 'value', label: 'value', type: 'any' }],
      pinDefaults,
    },
  };
}

const fixture: VisualFlow = {
  id: 'getter-check',
  name: 'getter-check',
  nodes: [
    // Four configured getters — the shape the multiagent pipeline would use.
    getter('g1', 'state.provider', 0, 0),
    getter('g2', 'state.model', 0, 120),
    getter('g3', 'state.wait_gating', 0, 240, true),
    getter('g4', 'state', 0, 360),
    // Unconfigured: nothing to collapse to, so it keeps full chrome.
    getter('g5', null, 0, 480),
    // A full-chrome node for scale comparison.
    {
      id: 'agent',
      type: 'agent',
      position: { x: 460, y: 0 },
      data: {
        nodeType: 'agent',
        label: 'Builder',
        icon: '&#x1F916;',
        headerColor: '#8E44AD',
        inputs: [
          { id: 'exec-in', label: '', type: 'execution' },
          { id: 'prompt', label: 'prompt', type: 'string' },
          { id: 'provider', label: 'provider', type: 'provider_text' },
          { id: 'model', label: 'model', type: 'model' },
        ],
        outputs: [
          { id: 'exec-out', label: '', type: 'execution' },
          { id: 'response', label: 'response', type: 'string' },
        ],
      },
    },
  ],
  edges: [
    { id: 'e1', source: 'g1', sourceHandle: 'value', target: 'agent', targetHandle: 'provider' },
    { id: 'e2', source: 'g2', sourceHandle: 'value', target: 'agent', targetHandle: 'model' },
  ],
} as unknown as VisualFlow;

useFlowStore.getState().loadFlow(fixture);

declare global {
  interface Window {
    __GETTER_CHECK_READY?: boolean;
  }
}

function Harness() {
  useEffect(() => {
    window.__GETTER_CHECK_READY = true;
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
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <Harness />
    </QueryClientProvider>
  </React.StrictMode>
);
