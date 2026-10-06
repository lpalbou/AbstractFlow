/**
 * Canvas zoom controls (R13.3): kit icon buttons (`af-topbar__btn`) with kit
 * tooltips, replacing React Flow's default <Controls />. Same actions: zoom
 * in, zoom out, fit the flow, and the canvas lock (a pressed toggle named for
 * its feature — no verb). Every glyph is the kit's own (ui-kit 0.8.6:
 * zoomIn, zoomOut, fitView, lock), no local drawing.
 */
import { Panel, useReactFlow, useStore, useStoreApi } from 'reactflow';
import { AfTooltip, Icon, type IconName } from '@abstractframework/ui-kit';

/** The kit icon of each control (asserted against the kit's ICON_NAMES in the tests). */
export const CANVAS_CONTROL_ICONS = {
  zoomIn: 'zoomIn',
  zoomOut: 'zoomOut',
  fitView: 'fitView',
  lock: 'lock',
} as const satisfies Record<string, IconName>;

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
          <Icon name={CANVAS_CONTROL_ICONS.zoomIn} size={16} />
        </button>
      </AfTooltip>
      <AfTooltip content="Zoom out">
        <button type="button" className="react-flow__controls-button af-topbar__btn" aria-label="Zoom out" onClick={() => zoomOut({ duration: 150 })}>
          <Icon name={CANVAS_CONTROL_ICONS.zoomOut} size={16} />
        </button>
      </AfTooltip>
      <AfTooltip content="Fit the whole flow in view">
        <button type="button" className="react-flow__controls-button af-topbar__btn" aria-label="Fit view" onClick={() => fitView({ duration: 200 })}>
          <Icon name={CANVAS_CONTROL_ICONS.fitView} size={16} />
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
          <Icon name={CANVAS_CONTROL_ICONS.lock} size={16} />
        </button>
      </AfTooltip>
    </Panel>
  );
}

export default CanvasControls;
