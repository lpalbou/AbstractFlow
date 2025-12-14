import { ReactFlowProvider } from 'reactflow';
import 'reactflow/dist/style.css';
import { Canvas } from './components/Canvas';
import { NodePalette } from './components/NodePalette';
import { PropertiesPanel } from './components/PropertiesPanel';
import { Toolbar } from './components/Toolbar';
import { useFlowStore } from './hooks/useFlow';

function App() {
  const { selectedNode } = useFlowStore();

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
