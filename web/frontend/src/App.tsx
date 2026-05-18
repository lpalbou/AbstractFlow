import 'reactflow/dist/style.css';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Canvas } from './components/Canvas';
import { AppearanceModal, type AppearanceSettings } from './components/AppearanceModal';
import {
  GatewayConnectionModal,
  clearGatewayConnection,
  fetchGatewayConnection,
  type GatewayConnectionStatus,
} from './components/GatewayConnectionModal';
import { NodePalette } from './components/NodePalette';
import { PropertiesPanel } from './components/PropertiesPanel';
import { Toolbar } from './components/Toolbar';
import { useFlowStore } from './hooks/useFlow';
import { applyTheme, applyTypography } from '@abstractframework/ui-kit';
import { registerMonitorGpuWidget } from '@abstractframework/monitor-gpu';

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

const UI_SETTINGS_KEY = 'abstractflow_ui_settings_v1';

function load_appearance_settings(): AppearanceSettings {
  try {
    const raw = localStorage.getItem(UI_SETTINGS_KEY);
    if (!raw) throw new Error('missing');
    const parsed = JSON.parse(raw);
    return {
      theme: String(parsed?.theme || 'dark').trim() || 'dark',
      font_scale: String(parsed?.font_scale || parsed?.fontScale || 'md').trim() || 'md',
      header_density: String(parsed?.header_density || parsed?.headerDensity || 'standard').trim() || 'standard',
    };
  } catch {
    return { theme: 'dark', font_scale: 'md', header_density: 'standard' };
  }
}

function save_appearance_settings(value: AppearanceSettings): void {
  try {
    localStorage.setItem(UI_SETTINGS_KEY, JSON.stringify(value));
  } catch {
    // ignore
  }
}

function App() {
  const { selectedNode } = useFlowStore();
  const queryClient = useQueryClient();
  const gpu_enabled = monitor_gpu_enabled();
  const monitor_gpu_ref = useRef<HTMLElement | null>(null);
  const [appearance, set_appearance] = useState<AppearanceSettings>(() => load_appearance_settings());
  const [show_appearance, set_show_appearance] = useState(false);
  const [show_connection, set_show_connection] = useState(false);
  const [connection_checked, set_connection_checked] = useState(false);
  const [connection_status, set_connection_status] = useState<GatewayConnectionStatus | null>(null);
  const [connection_required, set_connection_required] = useState(false);
  const gateway_connected = Boolean(connection_status?.has_token && connection_status?.embeddings?.ok === true);
  const properties_open = Boolean(selectedNode);

  useEffect(() => {
    if (!gpu_enabled) return;
    registerMonitorGpuWidget();
  }, [gpu_enabled]);

  useEffect(() => {
    save_appearance_settings(appearance);
  }, [appearance]);

  useEffect(() => {
    applyTheme(appearance.theme);
  }, [appearance.theme]);

  useEffect(() => {
    applyTypography({ font_scale: appearance.font_scale, header_density: appearance.header_density });
  }, [appearance.font_scale, appearance.header_density]);

  useEffect(() => {
    let cancelled = false;
    fetchGatewayConnection()
      .then((status) => {
        if (cancelled) return;
        set_connection_status(status);
        const needs_connection = !status.has_token || status.embeddings?.ok !== true;
        set_connection_required(needs_connection);
        if (needs_connection) set_show_connection(true);
        set_connection_checked(true);
      })
      .catch(() => {
        if (cancelled) return;
        set_connection_status(null);
        set_connection_required(true);
        set_show_connection(true);
        set_connection_checked(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handle_connection_saved = (status: GatewayConnectionStatus) => {
    set_connection_status(status);
    const needs_connection = !status.has_token || status.embeddings?.ok !== true;
    set_connection_required(needs_connection);
    if (!needs_connection) set_show_connection(false);
    queryClient.invalidateQueries({ queryKey: ['gateway'] });
    queryClient.invalidateQueries({ queryKey: ['flows'] });
  };

  const handle_disconnect = async () => {
    try {
      await clearGatewayConnection();
      set_connection_status(null);
      set_connection_required(true);
      set_show_connection(true);
      queryClient.invalidateQueries({ queryKey: ['gateway'] });
      queryClient.invalidateQueries({ queryKey: ['flows'] });
      toast.success('Disconnected from gateway');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to disconnect gateway');
    }
  };

  if (!connection_checked || !gateway_connected) {
    return (
      <div className="app-container connection-only">
        {!connection_checked ? (
          <div className="connection-check-card">
            <div className="gateway-connection-kicker">AbstractFlow connection</div>
            <h3>Checking AbstractGateway</h3>
            <p>Validating the configured gateway before loading the editor.</p>
          </div>
        ) : null}
        <GatewayConnectionModal
          isOpen={connection_checked}
          blocking
          onClose={() => {}}
          onSaved={handle_connection_saved}
          onCleared={() => {
            set_connection_status(null);
            set_connection_required(true);
            queryClient.invalidateQueries({ queryKey: ['gateway'] });
            queryClient.invalidateQueries({ queryKey: ['flows'] });
          }}
        />
      </div>
    );
  }

  return (
    <div className="app-container">
      {/* Header */}
      <header className="app-header">
        <div className="logo">
          <span className="logo-icon">&#x1F300;</span>
          <span className="logo-text">AbstractFlow</span>
        </div>
        <Toolbar
          onOpenAppearance={() => set_show_appearance(true)}
          onOpenConnection={() => set_show_connection(true)}
          onDisconnect={handle_disconnect}
          gatewayConnected={gateway_connected}
        />
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
      <main className={`app-main ${properties_open ? 'properties-open' : 'properties-collapsed'}`}>
        {/* Left sidebar - Node palette */}
        <aside className="sidebar left">
          <NodePalette />
        </aside>

        {/* Center - Canvas */}
        <div className="canvas-container">
          <Canvas />
        </div>

        {/* Right sidebar - Properties panel */}
        <aside className={`sidebar right properties-drawer ${properties_open ? 'open' : 'collapsed'}`}>
          {properties_open ? (
            <PropertiesPanel node={selectedNode} />
          ) : (
            <div className="properties-collapsed-rail" aria-label="Properties drawer collapsed">
              <span className="properties-collapsed-icon">⚙</span>
              <span className="properties-collapsed-text">Properties</span>
            </div>
          )}
        </aside>
      </main>

      {/* Footer */}
      <footer className="app-footer">
        <span>AbstractFlow Visual Editor v0.1.0</span>
      </footer>

      <AppearanceModal
        isOpen={show_appearance}
        value={appearance}
        onChange={set_appearance}
        onClose={() => set_show_appearance(false)}
      />
      <GatewayConnectionModal
        isOpen={show_connection}
        blocking={connection_required}
        onClose={() => set_show_connection(false)}
        onSaved={handle_connection_saved}
        onCleared={() => {
          set_connection_status(null);
          set_connection_required(true);
          queryClient.invalidateQueries({ queryKey: ['gateway'] });
          queryClient.invalidateQueries({ queryKey: ['flows'] });
        }}
      />
    </div>
  );
}

export default App;
