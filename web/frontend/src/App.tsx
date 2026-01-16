import { ReactFlowProvider } from 'reactflow';
import 'reactflow/dist/style.css';
import { useEffect, useRef, type CSSProperties } from 'react';
import { Canvas } from './components/Canvas';
import { NodePalette } from './components/NodePalette';
import { PropertiesPanel } from './components/PropertiesPanel';
import { Toolbar } from './components/Toolbar';
import { useFlowStore } from './hooks/useFlow';
import { registerMonitorGpuWidget } from '@abstractutils/monitor-gpu';

function App() {
  const { selectedNode } = useFlowStore();
  const monitor_gpu_enabled = typeof window !== "undefined" && window.__ABSTRACT_UI_CONFIG__?.monitor_gpu === true;
  const monitor_gpu_ref = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!monitor_gpu_enabled) return;
    registerMonitorGpuWidget();
  }, [monitor_gpu_enabled]);

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
          {monitor_gpu_enabled ? (
            <monitor-gpu
              ref={monitor_gpu_ref as any}
              mode="icon"
              history-size="5"
              tick-ms="1500"
              title="GPU usage (host)"
              style={
                {
                  ["--monitor-gpu-width" as any]: "30px",
                  ["--monitor-gpu-bars-height" as any]: "18px",
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
