import { ReactFlowProvider } from 'reactflow';
import 'reactflow/dist/style.css';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Canvas } from './components/Canvas';
import { NodePalette } from './components/NodePalette';
import { PropertiesPanel } from './components/PropertiesPanel';
import { Toolbar } from './components/Toolbar';
import { useFlowStore } from './hooks/useFlow';
import { registerMonitorGpuWidget } from '@abstractutils/monitor-gpu';

function flag_enabled(value: unknown): boolean {
  const s = String(value ?? '').trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'on';
}

function monitor_gpu_enabled(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.__ABSTRACT_UI_CONFIG__?.monitor_gpu === true) return true;
  if (flag_enabled(import.meta.env?.VITE_MONITOR_GPU)) return true;
  try {
    const q = new URLSearchParams(window.location.search);
    return flag_enabled(q.get('monitor-gpu'));
  } catch {
    return false;
  }
}

function App() {
  const { selectedNode } = useFlowStore();
  const [remote_monitor_gpu, set_remote_monitor_gpu] = useState<boolean | null>(null);
  const gpu_enabled = remote_monitor_gpu === true || monitor_gpu_enabled();
  const monitor_gpu_ref = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    fetch('/api/ui/config')
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        const v = body && typeof body === 'object' ? (body as any).monitor_gpu : null;
        if (typeof v === 'boolean') set_remote_monitor_gpu(v);
        else set_remote_monitor_gpu(null);
      })
      .catch(() => set_remote_monitor_gpu(null));
  }, []);

  useEffect(() => {
    if (!gpu_enabled) return;
    registerMonitorGpuWidget();
  }, [gpu_enabled]);

  return (
    <ReactFlowProvider>
      <div className="app-container">
        {/* Header */}
        <header className="app-header">
          <div className="logo">
            <span className="logo-icon">&#x1F300;</span>
            <span className="logo-text">AbstractFlow</span>
          </div>
          <Toolbar />
          {gpu_enabled ? (
            <monitor-gpu
              ref={monitor_gpu_ref as any}
              mode="icon"
              history-size="5"
              tick-ms="1500"
              title="GPU usage (host)"
              style={
                {
                  ['--monitor-gpu-width' as any]: '34px',
                  ['--monitor-gpu-bars-height' as any]: '22px',
                  ['--monitor-gpu-padding' as any]: '2px 4px',
                  ['--monitor-gpu-radius' as any]: '999px',
                  ['--monitor-gpu-bg' as any]: 'rgba(0,0,0,0.18)',
                  ['--monitor-gpu-border' as any]: 'rgba(255,255,255,0.16)',
                  position: 'relative',
                  zIndex: 1100,
                  flexShrink: 0,
                } as CSSProperties
              }
            />
          ) : null}
        </header>

        {/* Main content */}
        <main className="app-main">
          {/* Left sidebar - Node palette */}
          <aside className="sidebar left">
            <NodePalette />
          </aside>

          {/* Center - Canvas */}
          <div className="canvas-container">
            <Canvas />
          </div>

          {/* Right sidebar - Properties panel */}
          <aside className="sidebar right">
            <PropertiesPanel node={selectedNode} />
          </aside>
        </main>

        {/* Footer */}
        <footer className="app-footer">
          <span>AbstractFlow Visual Editor v0.1.0</span>
        </footer>
      </div>
    </ReactFlowProvider>
  );
}

export default App;
