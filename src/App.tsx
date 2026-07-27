import 'reactflow/dist/style.css';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Canvas } from './components/Canvas';
import {
  GatewayConnectionModal,
  clearGatewayConnection,
  fetchGatewayConnection,
  type GatewayConnectionStatus,
} from './components/GatewayConnectionModal';
import { AuthoringAssistantDrawer } from './components/AuthoringAssistantDrawer';
import { FunctionsDrawer } from './components/FunctionsDrawer';
import { NodePalette } from './components/NodePalette';
import { PropertiesPanel } from './components/PropertiesPanel';
import { Toolbar } from './components/Toolbar';
import { useFlowStore } from './hooks/useFlow';
import {
  AfAppearanceDialog,
  AfTopBarActions,
  useAppearanceSettings,
  type GatewayConnectionPhase,
} from '@abstractframework/ui-kit';
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

type RightDrawerMode = 'assistant' | 'properties' | 'functions' | null;

function App() {
  const { selectedNode } = useFlowStore();
  const queryClient = useQueryClient();
  const gpu_enabled = monitor_gpu_enabled();
  const monitor_gpu_ref = useRef<HTMLElement | null>(null);
  // Kit-owned appearance persistence (af_appearance_abstractflow_v1) with a
  // one-time migration from flow's legacy abstractflow_ui_settings_v1 key.
  // The hook applies theme + typography itself (synchronously on first load,
  // so there is no default-theme flash).
  const [appearance, set_appearance] = useAppearanceSettings('abstractflow', {
    legacyKey: 'abstractflow_ui_settings_v1',
  });
  const [show_appearance, set_show_appearance] = useState(false);
  const [show_connection, set_show_connection] = useState(false);
  const [signing_out, set_signing_out] = useState(false);
  const [connection_checked, set_connection_checked] = useState(false);
  const [connection_status, set_connection_status] = useState<GatewayConnectionStatus | null>(null);
  const [connection_required, set_connection_required] = useState(false);
  const [right_drawer_mode, set_right_drawer_mode] = useState<RightDrawerMode>(null);
  // Once the assistant has been opened it stays mounted for the whole editor
  // session (it renders null while hidden). Unmounting on tab switch would
  // destroy the in-flight autonomous authoring loop plus all conversation,
  // plan, and activity state that lives in the drawer.
  const [assistant_mounted, set_assistant_mounted] = useState(false);
  const gateway_connected = has_browser_gateway_session(connection_status);
  const selected_node_id = selectedNode?.id || null;
  const assistant_open = right_drawer_mode === 'assistant';
  const properties_open = right_drawer_mode === 'properties';
  const functions_open = right_drawer_mode === 'functions';
  const right_drawer_open = assistant_open || properties_open || functions_open;
  const toggle_assistant_drawer = () => {
    set_right_drawer_mode((mode) => (mode === 'assistant' ? null : 'assistant'));
  };
  const toggle_properties_drawer = () => {
    set_right_drawer_mode((mode) => (mode === 'properties' ? null : 'properties'));
  };
  const toggle_functions_drawer = () => {
    set_right_drawer_mode((mode) => (mode === 'functions' ? null : 'functions'));
  };

  useEffect(() => {
    set_right_drawer_mode((mode) => {
      // Assistant and Functions drawers hold their ground on selection: the
      // functions panel's Used-by rows SELECT nodes — flipping to Properties
      // on that click would close the panel the user is navigating from.
      if (mode === 'assistant' || mode === 'functions') return mode;
      if (selected_node_id) return 'properties';
      return null;
    });
  }, [selected_node_id]);

  useEffect(() => {
    if (assistant_open) set_assistant_mounted(true);
  }, [assistant_open]);

  useEffect(() => {
    if (!gpu_enabled) return;
    registerMonitorGpuWidget();
  }, [gpu_enabled]);

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
    set_signing_out(true);
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
    } finally {
      set_signing_out(false);
    }
  };

  // Three states, never a boolean — the kit pill renders "Connecting…" during
  // the boot probe instead of flashing "Connect" over a live session.
  const connection_phase: GatewayConnectionPhase = !connection_checked
    ? 'loading'
    : gateway_connected
      ? 'connected'
      : 'disconnected';

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
        <Toolbar />
        {/* The unified upper-right cluster (same order in every
          * AbstractFramework app): assistant → appearance → [gpu] → Disconnect. */}
        <AfTopBarActions
          assistant={{
            open: assistant_open,
            onToggle: toggle_assistant_drawer,
            label: 'Authoring assistant',
          }}
          appearance={{ onOpen: () => set_show_appearance(true) }}
          extraActions={
            gpu_enabled ? (
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
            ) : undefined
          }
          connection={{
            phase: connection_phase,
            signingOut: signing_out,
            onConnect: () => set_show_connection(true),
            onDisconnect: handle_disconnect,
          }}
        />
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
          className={`sidebar right properties-drawer ${right_drawer_open ? 'open' : 'collapsed'} ${assistant_open ? 'assistant-drawer-open' : ''} ${properties_open ? 'properties-drawer-open' : ''} ${functions_open ? 'functions-drawer-open' : ''}`}
        >
          {right_drawer_open || assistant_mounted ? (
            <div className="right-drawer-content" style={right_drawer_open ? undefined : { display: 'none' }}>
              {assistant_mounted ? <AuthoringAssistantDrawer isOpen={assistant_open} /> : null}
              {properties_open ? <PropertiesPanel node={selectedNode} /> : null}
              {functions_open ? <FunctionsDrawer /> : null}
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
            <button
              type="button"
              className={`right-drawer-rail-action ${functions_open ? 'active' : ''}`}
              onClick={toggle_functions_drawer}
              title={functions_open ? 'Close functions' : 'Open functions'}
              aria-label={functions_open ? 'Close functions' : 'Open functions'}
            >
              <span className="right-drawer-rail-icon" aria-hidden="true">ƒ</span>
              <span className="right-drawer-rail-text">Functions</span>
            </button>
          </div>
        </aside>
      </main>

      {/* Footer */}
      <footer className="app-footer">
        <span>AbstractFlow Visual Editor v0.1.0</span>
      </footer>

      <AfAppearanceDialog
        open={show_appearance}
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
