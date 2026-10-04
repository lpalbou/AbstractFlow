/**
 * Canvas zoom controls (R13.3): kit icon buttons (`af-topbar__btn`) with kit
 * tooltips, replacing React Flow's default <Controls />. Same actions: zoom
 * in, zoom out, fit the flow, and the canvas lock (a pressed toggle named for
 * its feature — no verb). The kit has no minus / fit / lock glyph yet
 * (KIT_ICON_GAPS): those three are drawn here on the kit's 24-grid, stroke 2,
 * so they match the kit icons beside them.
 */
import { Panel, useReactFlow, useStore, useStoreApi } from 'reactflow';
import { AfTooltip, Icon } from '@abstractframework/ui-kit';

function GapIcon({ d }: { d: string[] }) {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {d.map((p) => (
        <path key={p} d={p} />
      ))}
    </svg>
  );
}

const MINUS = ['M5 12h14'];
const FIT = ['M4 9V5a1 1 0 0 1 1-1h4', 'M15 4h4a1 1 0 0 1 1 1v4', 'M20 15v4a1 1 0 0 1-1 1h-4', 'M9 20H5a1 1 0 0 1-1-1v-4'];
const LOCK = ['M7 11V8a5 5 0 0 1 10 0v3', 'M6 11h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1z'];

export function CanvasControls() {
  const { zoomIn, zoomOut, fitView } = useReactFlow();
  const store = useStoreApi();
  const locked = useStore((s) => !(s.nodesDraggable || s.nodesConnectable || s.elementsSelectable));
  const toggleLock = () => {
    const next = locked;
    store.setState({ nodesDraggable: next, nodesConnectable: next, elementsSelectable: next });
  };
  return (
    <Panel position="bottom-left" className="react-flow__controls flow-canvas-controls" aria-label="Canvas controls">
      <AfTooltip content="Zoom in">
        <button type="button" className="react-flow__controls-button af-topbar__btn" aria-label="Zoom in" onClick={() => zoomIn({ duration: 150 })}>
          <Icon name="plus" size={16} />
        </button>
      </AfTooltip>
      <AfTooltip content="Zoom out">
        <button type="button" className="react-flow__controls-button af-topbar__btn" aria-label="Zoom out" onClick={() => zoomOut({ duration: 150 })}>
          <GapIcon d={MINUS} />
        </button>
      </AfTooltip>
      <AfTooltip content="Fit the whole flow in view">
        <button type="button" className="react-flow__controls-button af-topbar__btn" aria-label="Fit view" onClick={() => fitView({ duration: 200 })}>
          <GapIcon d={FIT} />
        </button>
      </AfTooltip>
      <AfTooltip content={locked ? 'Canvas lock is on: nodes cannot be moved, connected or selected' : 'Canvas lock: stop nodes from being moved, connected or selected'}>
        <button
          type="button"
          className={`react-flow__controls-button af-topbar__btn${locked ? ' is-active' : ''}`}
          aria-label="Canvas lock"
          aria-pressed={locked}
          onClick={toggleLock}
        >
          <GapIcon d={LOCK} />
        </button>
      </AfTooltip>
    </Panel>
  );
}

export default CanvasControls;
