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
import { AuthoringAssistantDrawer } from './components/AuthoringAssistantDrawer';
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

function has_browser_gateway_session(status: GatewayConnectionStatus | null): boolean {
  const gateway = status?.gateway || status?.embeddings;
  const principal = gateway?.principal;
  if (!(status?.token_source === 'browser-session' && status.has_token && status.embeddings?.ok === true && principal?.user_id)) {
    return false;
  }
  const auth = gateway?.auth;
  if (auth?.mode === 'legacy-token' || auth?.user_auth_enabled === false) return false;
  if (principal.source === 'legacy-token') return false;
  return true;
}

const UI_SETTINGS_KEY = 'abstractflow_ui_settings_v1';
type RightDrawerMode = 'assistant' | 'properties' | null;

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
  const [right_drawer_mode, set_right_drawer_mode] = useState<RightDrawerMode>(null);
  const gateway_connected = has_browser_gateway_session(connection_status);
  const selected_node_id = selectedNode?.id || null;
  const assistant_open = right_drawer_mode === 'assistant';
  const properties_open = right_drawer_mode === 'properties';
  const right_drawer_open = assistant_open || properties_open;
  const toggle_assistant_drawer = () => {
    set_right_drawer_mode((mode) => (mode === 'assistant' ? null : 'assistant'));
  };
  const toggle_properties_drawer = () => {
    set_right_drawer_mode((mode) => (mode === 'properties' ? null : 'properties'));
  };

  useEffect(() => {
    set_right_drawer_mode((mode) => {
      if (mode === 'assistant') return mode;
      if (selected_node_id) return 'properties';
      return null;
    });
  }, [selected_node_id]);

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
        const needs_connection = !has_browser_gateway_session(status);
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
    const needs_connection = !has_browser_gateway_session(status);
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
            <h3>Checking browser session</h3>
            <p>Loading the saved Gateway sign-in for this browser.</p>
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
          onOpenAssistant={() => set_right_drawer_mode('assistant')}
          onOpenConnection={() => set_show_connection(true)}
          onDisconnect={handle_disconnect}
          assistantOpen={assistant_open}
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
      <main className={`app-main ${right_drawer_open ? 'properties-open' : 'properties-collapsed'}`}>
        {/* Left sidebar - Node palette */}
        <aside className="sidebar left">
          <NodePalette />
        </aside>

        {/* Center - Canvas */}
        <div className="canvas-container">
          <Canvas />
        </div>

        {/* Right sidebar - Properties / Assistant drawer */}
        <aside
          className={`sidebar right properties-drawer ${right_drawer_open ? 'open' : 'collapsed'} ${assistant_open ? 'assistant-drawer-open' : ''} ${properties_open ? 'properties-drawer-open' : ''}`}
        >
          {right_drawer_open ? (
            <div className="right-drawer-content">
              {assistant_open ? <AuthoringAssistantDrawer isOpen={assistant_open} /> : null}
              {properties_open ? <PropertiesPanel node={selectedNode} /> : null}
            </div>
          ) : null}
          <div className="right-drawer-rail" aria-label="Right drawer">
            <button
              type="button"
              className={`right-drawer-rail-action ${assistant_open ? 'active' : ''}`}
              onClick={toggle_assistant_drawer}
              title={assistant_open ? 'Close authoring assistant' : 'Open authoring assistant'}
              aria-label={assistant_open ? 'Close authoring assistant' : 'Open authoring assistant'}
            >
              <span className="right-drawer-rail-icon" aria-hidden="true">✦</span>
              <span className="right-drawer-rail-text">Assistant</span>
            </button>
            <button
              type="button"
              className={`right-drawer-rail-action ${properties_open ? 'active' : ''}`}
              onClick={toggle_properties_drawer}
              title={properties_open ? 'Close properties' : 'Open properties'}
              aria-label={properties_open ? 'Close properties' : 'Open properties'}
            >
              <span className="right-drawer-rail-icon" aria-hidden="true">⚙</span>
              <span className="right-drawer-rail-text">Properties</span>
            </button>
          </div>
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
