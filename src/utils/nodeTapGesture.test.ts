// R15.2: a node press that moves beyond the drag threshold is a DRAG (never
// select-and-open); a tap/click without movement selects and opens — touch,
// pen and mouse alike. Synthesized pointer sequences drive the tracker, then
// the drawer reducer shows what the panel does.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { DRAG_THRESHOLD_PX, NodeTapTracker } from './nodeTapGesture';
import { drawerReducer, initialDrawerState, type DrawerState } from './drawerLayout';

type Kind = 'touch' | 'mouse' | 'pen';
const ev = (pointerType: Kind, x: number, y: number, pointerId = 1) => ({ pointerId, pointerType, clientX: x, clientY: y });

/** down at (100,100) on node `n1`, moves along `path`, up at the last point; returns isTap for the click that follows. */
function press(kind: Kind, path: [number, number][], t = new NodeTapTracker()): boolean {
  t.down(ev(kind, 100, 100), 'n1');
  for (const [x, y] of path) t.move(ev(kind, x, y));
  const [lx, ly] = path.length ? path[path.length - 1] : [100, 100];
  t.up(ev(kind, lx, ly));
  return t.isTap('n1');
}

/** What the panel does: a tap requests the node's properties (App dispatches select), a drag requests nothing. */
function panelAfter(state: DrawerState, tap: boolean): DrawerState {
  return tap ? drawerReducer(state, { type: 'select', nodeId: 'n1' }) : state;
}

describe('tap vs drag on a node', () => {
  it('touch tap (no movement, or a jitter within the threshold) is a tap → the panel opens', () => {
    expect(press('touch', [])).toBe(true);
    expect(press('touch', [[104, 103], [106, 105]])).toBe(true);
    const narrow = initialDrawerState(true);
    expect(panelAfter(narrow, press('touch', [])).right).toBe('properties');
  });

  it('touch-move beyond the threshold is a drag → no panel', () => {
    expect(press('touch', [[105, 100], [130, 140]])).toBe(false);
    expect(press('touch', [[100 + DRAG_THRESHOLD_PX.touch + 1, 100], [100, 100]])).toBe(false); // back to start: still a drag
    expect(panelAfter(initialDrawerState(true), press('touch', [[160, 100]])).right).toBe(null);
  });

  it('mouse click opens; a mouse drag (beyond 4 px) never opens', () => {
    expect(press('mouse', [])).toBe(true);
    expect(press('mouse', [[103, 102]])).toBe(true);
    expect(press('mouse', [[110, 100]])).toBe(false);
    expect(panelAfter(initialDrawerState(false), press('mouse', [[300, 200]])).right).toBe(null);
    expect(panelAfter(initialDrawerState(false), press('mouse', [])).right).toBe('properties');
  });

  it('a tap after a drag opens again (the selection may not have changed)', () => {
    const t = new NodeTapTracker();
    let state = initialDrawerState(true);
    state = panelAfter(state, press('touch', [[200, 200]], t)); // drag
    expect(state.right).toBe(null);
    state = panelAfter(state, press('touch', [], t)); // tap
    expect(state.right).toBe('properties');
    state = drawerReducer(state, { type: 'closeNarrow' }); // the viewer closes it
    state = panelAfter(state, press('touch', [[101, 101]], t)); // tap the same node again
    expect(state.right).toBe('properties');
  });

  it('a cancelled press (the browser took the gesture) and a click on another node are not taps', () => {
    const t = new NodeTapTracker();
    t.down(ev('touch', 100, 100), 'n1');
    t.cancel(ev('touch', 100, 100));
    expect(t.isTap('n1')).toBe(false);
    t.down(ev('mouse', 0, 0), 'n2');
    t.up(ev('mouse', 0, 0));
    expect(t.isTap('n1')).toBe(false);
    expect(t.isTap('n2')).toBe(true);
  });

  it('other pointers do not move the press; a click with no press (keyboard) is a tap', () => {
    const t = new NodeTapTracker();
    t.down(ev('touch', 100, 100, 1), 'n1');
    t.move(ev('touch', 400, 400, 2));
    t.up(ev('touch', 100, 100, 1));
    expect(t.isTap('n1')).toBe(true);
    expect(new NodeTapTracker().isTap('n1')).toBe(true);
  });
});

describe('the tap is decided at pointerup', () => {
  it('up() returns the tapped node for a tap and null for a drag; pressing spans down → up', () => {
    const t = new NodeTapTracker();
    t.down(ev('mouse', 100, 100), 'n1');
    expect(t.pressing).toBe(true);
    t.move(ev('mouse', 102, 101)); // a 1-3 px trackpad click is still a tap
    expect(t.up(ev('mouse', 103, 100))).toBe('n1');
    expect(t.pressing).toBe(false);
    t.down(ev('mouse', 100, 100), 'n1');
    t.move(ev('mouse', 105, 100));
    expect(t.up(ev('mouse', 105, 100))).toBe(null);
    t.down(ev('touch', 100, 100), 'n1');
    t.move(ev('touch', 113, 100)); // the 11-14 px band: a drag for a finger
    expect(t.up(ev('touch', 113, 100))).toBe(null);
    t.down(ev('touch', 100, 100), null); // pane press: no node, not pressing
    expect(t.pressing).toBe(false);
    expect(t.up(ev('touch', 100, 100))).toBe(null);
  });
});

describe('Canvas wiring', () => {
  const canvas = readFileSync(resolve(__dirname, '../components/Canvas.tsx'), 'utf8');
  it('React Flow never selects on drag and the click that ends a drag is swallowed before React Flow', () => {
    expect(canvas).toMatch(/^\s+selectNodesOnDrag=\{false\}$/m);
    expect(canvas).toMatch(/onClickCapture=\{handleCanvasClickCapture\}/);
    expect(canvas).toMatch(/!nodeTapTracker\.current\.isTap\(nodeId\)\) event\.stopPropagation\(\)/);
    expect(canvas).toMatch(/requestNodeProperties\(node\.id\)/);
  });

  it('pointerup selects + opens the tapped node (no dependence on the click); drag-start deselection ignored while pressing', () => {
    expect(canvas).toMatch(/const tapped = nodeTapTracker\.current\.up\(e\);/);
    expect(canvas).toMatch(/store\.selectNodeById\(tapped\);\s*store\.requestNodeProperties\(tapped\);/);
    // F4: the press is followed on window (moves over the panel / palette / toolbar count).
    expect(canvas).toMatch(/window\.addEventListener\('pointermove', onMove, true\);/);
    expect(canvas).toMatch(/window\.addEventListener\('pointerup', onUp, true\);/);
    expect(canvas).toMatch(/if \(nodeId\) followPress\(event\.pointerId\);/);
    expect(canvas).toMatch(/onNodesChange=\{handleNodesChange\}/);
    expect(canvas).toMatch(/if \(!nodeTapTracker\.current\.pressing\) \{/);
    expect(canvas).toMatch(/nodeTapTracker\.current\.down\(event, nodeId\);/);
  });

  it('App opens the properties on every tap request (not only on a selection change)', () => {
    const app = readFileSync(resolve(__dirname, '../App.tsx'), 'utf8');
    expect(app).toMatch(/if \(propertiesRequest\) dispatch_drawers\(\{ type: 'select', nodeId: propertiesRequest\.nodeId \}\);\s*\}, \[propertiesRequest\]\);/);
  });
});
