import 'reactflow/dist/style.css';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Canvas } from './components/Canvas';
import {
  GatewayConnectionModal,
  clearGatewayConnection,
  fetchGatewayConnection,
  hasBrowserGatewaySession,
  type GatewayConnectionStatus,
} from './components/GatewayConnectionModal';
import { AuthoringAssistantDrawer } from './components/AuthoringAssistantDrawer';
import { FunctionsDrawer } from './components/FunctionsDrawer';
import { NodePalette } from './components/NodePalette';
import { PropertiesPanel } from './components/PropertiesPanel';
import { Toolbar } from './components/Toolbar';
import { useFlowStore } from './hooks/useFlow';
import { useAboutAction } from './hooks/useAboutAction';
import {
  AF_MEDIA,
  AfAppearanceDialog,
  AfTopBarActions,
  useAfMedia,
  useAppearanceSettings,
  type GatewayConnectionPhase,
} from '@abstractframework/ui-kit';
import { PALETTE_ADD_NODE_EVENT } from './utils/paletteAdd';
import { registerMonitorGpuWidget } from '@abstractframework/monitor-gpu';
import { registerMonitorMemoryWidget } from '@abstractframework/monitor-memory';

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

function monitor_memory_enabled(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.__ABSTRACT_UI_CONFIG__?.monitor_memory === true) return true;
  if (flag_enabled(import.meta.env?.VITE_MONITOR_MEMORY)) return true;
  try {
    const q = new URLSearchParams(window.location.search);
    return flag_enabled(q.get('monitor-memory'));
  } catch {
    return false;
  }
}

type RightDrawerMode = 'assistant' | 'properties' | 'functions' | null;

function App() {
  const { selectedNode } = useFlowStore();
  const queryClient = useQueryClient();
  const gpu_enabled = monitor_gpu_enabled();
  const memory_enabled = monitor_memory_enabled();
  const monitor_gpu_ref = useRef<HTMLElement | null>(null);
  const monitor_memory_ref = useRef<HTMLElement | null>(null);
  // Kit-owned appearance persistence (af_appearance_abstractflow_v1) with a
  // one-time migration from flow's legacy abstractflow_ui_settings_v1 key.
  // The hook applies theme + typography itself (synchronously on first load,
  // so there is no default-theme flash).
  const [appearance, set_appearance] = useAppearanceSettings('abstractflow', {
    legacyKey: 'abstractflow_ui_settings_v1',
  });
  const [show_appearance, set_show_appearance] = useState(false);
  // About dialog (identity + gateway versions fetched when it opens).
  const about_action = useAboutAction();
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
  // Below the md breakpoint (1024 px) the node palette and the right drawer
  // leave the layout and float over the full-bleed canvas as drawers
  // (DESIGN.md 5.2/5.4). The palette is closed by default there.
  const narrow = useAfMedia(AF_MEDIA.md);
  const [palette_open, set_palette_open] = useState(false);
  const palette_toggle_ref = useRef<HTMLButtonElement | null>(null);
  const palette_ref = useRef<HTMLElement | null>(null);
  const gateway_connected = hasBrowserGatewaySession(connection_status);
  // Once the editor has rendered it owns unsaved graph state, so losing the
  // session must never throw the user back to the full-screen sign-in gate.
  const entered_editor_ref = useRef(false);
  const session_lost_notified_ref = useRef(false);
  useEffect(() => {
    if (gateway_connected) entered_editor_ref.current = true;
  }, [gateway_connected]);
  // One-time cleanup: the retired localStorage draft-mirror feature left
  // `abstractflow_draft_v1:*` keys behind, and stale ones produced recovery
  // prompts for flows the user never touched (or had deleted). Purge them.
  useEffect(() => {
    try {
      const doomed: string[] = [];
      for (let i = 0; i < window.localStorage.length; i++) {
        const key = window.localStorage.key(i);
        if (key && key.startsWith('abstractflow_draft_v1:')) doomed.push(key);
      }
      doomed.forEach((key) => window.localStorage.removeItem(key));
    } catch {
      /* storage unavailable — nothing to clean */
    }
  }, []);
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

  // Leaving the narrow layout: the palette is docked again, so drop the
  // drawer state (it would otherwise reopen as a drawer on the way back down).
  useEffect(() => {
    if (!narrow) set_palette_open(false);
  }, [narrow]);

  // Narrow drawers: one at a time. Opening the palette closes the right
  // drawer and vice versa, so the backdrop always belongs to one drawer.
  const palette_drawer_open = narrow && palette_open;
  const right_drawer_overlay = narrow && right_drawer_open;
  const close_narrow_drawers = () => {
    set_palette_open(false);
    set_right_drawer_mode(null);
  };
  const toggle_palette = () => {
    set_palette_open((open) => {
      const next = !open;
      if (next) set_right_drawer_mode((mode) => (mode === 'assistant' ? mode : null));
      return next;
    });
  };
  useEffect(() => {
    if (right_drawer_open && narrow) set_palette_open(false);
  }, [right_drawer_open, narrow]);

  // Focus moves into the palette drawer on open and back to its opener on
  // close (the drawer container itself takes focus: focusing the search field
  // would pop the on-screen keyboard over the list on phones).
  const palette_was_open_ref = useRef(false);
  useEffect(() => {
    if (palette_drawer_open) {
      palette_ref.current?.focus({ preventScroll: true });
    } else if (palette_was_open_ref.current) {
      palette_toggle_ref.current?.focus({ preventScroll: true });
    }
    palette_was_open_ref.current = palette_drawer_open;
  }, [palette_drawer_open]);

  // Escape closes whichever narrow drawer is open.
  useEffect(() => {
    if (!palette_drawer_open && !right_drawer_overlay) return;
    const on_key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      // A dialog above the drawer owns Escape.
      if (document.querySelector('.modal-overlay, .af-appearance-overlay, .af-connect-overlay')) return;
      close_narrow_drawers();
    };
    window.addEventListener('keydown', on_key);
    return () => window.removeEventListener('keydown', on_key);
  }, [palette_drawer_open, right_drawer_overlay]);

  // Tap-to-add from the palette (touch / narrow layouts) closes the drawer so
  // the new node is visible on the canvas.
  useEffect(() => {
    const on_add = () => {
      if (narrow) set_palette_open(false);
    };
    window.addEventListener(PALETTE_ADD_NODE_EVENT, on_add);
    return () => window.removeEventListener(PALETTE_ADD_NODE_EVENT, on_add);
  }, [narrow]);

  useEffect(() => {
    if (!gpu_enabled) return;
    registerMonitorGpuWidget();
  }, [gpu_enabled]);

  useEffect(() => {
    if (!memory_enabled) return;
    registerMonitorMemoryWidget();
  }, [memory_enabled]);

  useEffect(() => {
    let cancelled = false;
    fetchGatewayConnection()
      .then((status) => {
        if (cancelled) return;
        set_connection_status(status);
        const needs_connection = !hasBrowserGatewaySession(status);
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

  // The boot probe above runs once. A session that expires while the editor is
  // open used to leave the top-bar pill reading "connected" forever, so every
  // gateway call 401'd with no visible cause (Save silently went dead). Re-probe
  // whenever the tab regains focus, and tell the user their session is gone —
  // WITHOUT unmounting the editor, so an unsaved graph is never destroyed by a
  // dropped session.
  useEffect(() => {
    if (!connection_checked) return;
    let cancelled = false;
    const reprobe = () => {
      fetchGatewayConnection()
        .then((status) => {
          if (cancelled) return;
          const still_connected = hasBrowserGatewaySession(status);
          set_connection_status(status);
          if (!still_connected && entered_editor_ref.current && !session_lost_notified_ref.current) {
            session_lost_notified_ref.current = true;
            set_show_connection(true);
            toast.error('Gateway session expired — reconnect to save or run. Your open flow is untouched.', {
              duration: 8000,
            });
          }
          if (still_connected) session_lost_notified_ref.current = false;
        })
        .catch(() => {
          /* Network blip: keep the last known phase rather than flapping the UI. */
        });
    };
    const on_visibility = () => {
      if (document.visibilityState === 'visible') reprobe();
    };
    window.addEventListener('focus', reprobe);
    document.addEventListener('visibilitychange', on_visibility);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', reprobe);
      document.removeEventListener('visibilitychange', on_visibility);
    };
  }, [connection_checked]);

  const handle_connection_saved = (status: GatewayConnectionStatus) => {
    set_connection_status(status);
    const needs_connection = !hasBrowserGatewaySession(status);
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

  // Only gate the app when we have never been connected. After that the editor
  // stays mounted and the top-bar pill carries the disconnected state.
  if (!connection_checked || (!gateway_connected && !entered_editor_ref.current)) {
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
        <button
          type="button"
          ref={palette_toggle_ref}
          className={`palette-toggle ${palette_drawer_open ? 'active' : ''}`}
          onClick={toggle_palette}
          aria-expanded={palette_drawer_open}
          aria-controls="node-palette-drawer"
          aria-label={palette_drawer_open ? 'Close node palette' : 'Open node palette'}
          title={palette_drawer_open ? 'Close node palette' : 'Open node palette'}
        >
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="7" height="7" rx="1.5" />
            <rect x="14" y="3" width="7" height="7" rx="1.5" />
            <rect x="3" y="14" width="7" height="7" rx="1.5" />
            <path d="M17.5 14v7M14 17.5h7" />
          </svg>
        </button>
        <div className="logo">
          <span className="logo-icon">&#x1F300;</span>
          <span className="logo-text">AbstractFlow</span>
        </div>
        <Toolbar />
        {/* The unified upper-right cluster (same order in every
          * AbstractFramework app): assistant → appearance → about → [gpu] → Disconnect. */}
        <AfTopBarActions
          assistant={{
            open: assistant_open,
            onToggle: toggle_assistant_drawer,
            label: 'Authoring assistant',
          }}
          appearance={{ onOpen: () => set_show_appearance(true) }}
          about={about_action}
          extraActions={
            gpu_enabled || memory_enabled ? (
              // AfTopBarActions renders extraActions as a single child slot, so
              // both monitors ship inside one fragment.
              <>
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
                {memory_enabled ? (
                  <monitor-memory
                    ref={monitor_memory_ref as any}
                    mode="icon"
                    tick-ms="5000"
                    title="Host memory (RAM + device)"
                    style={
                      {
                        ['--monitor-memory-width' as any]: '34px',
                        ['--monitor-memory-bar-height' as any]: '5px',
                        ['--monitor-memory-padding' as any]: '5px 4px',
                        ['--monitor-memory-radius' as any]: '999px',
                        ['--monitor-memory-bg' as any]: 'rgba(0,0,0,0.18)',
                        ['--monitor-memory-border' as any]: 'rgba(255,255,255,0.16)',
                        position: 'relative',
                        zIndex: 1100,
                        flexShrink: 0,
                      } as CSSProperties
                    }
                  />
                ) : null}
              </>
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
      <main
        className={`app-main ${right_drawer_open ? 'properties-open' : 'properties-collapsed'} ${palette_drawer_open ? 'palette-open' : ''}`}
      >
        {/* Left sidebar - Node palette (a drawer below 1024 px) */}
        <aside
          id="node-palette-drawer"
          ref={palette_ref}
          className={`sidebar left ${palette_drawer_open ? 'open' : ''}`}
          tabIndex={narrow ? -1 : undefined}
          aria-label="Node palette"
        >
          <button
            type="button"
            className="drawer-close palette-close"
            onClick={() => set_palette_open(false)}
            aria-label="Close node palette"
            title="Close node palette"
          >
            ×
          </button>
          <NodePalette />
        </aside>

        {/* Narrow layouts: tap outside an open drawer to close it. */}
        {palette_drawer_open || right_drawer_overlay ? (
          <div className="overlay-scrim" onClick={close_narrow_drawers} aria-hidden="true" />
        ) : null}

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
