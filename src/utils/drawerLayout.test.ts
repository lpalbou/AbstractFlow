import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { drawerReducer, initialDrawerState, type DrawerEvent, type DrawerState } from './drawerLayout';

const run = (state: DrawerState, ...events: DrawerEvent[]) => events.reduce(drawerReducer, state);

describe('drawerLayout: crossing the 1024 px breakpoint', () => {
  it('crossing down closes a docked-open properties panel (no overlay across the canvas)', () => {
    const wide = run(initialDrawerState(false), { type: 'select', nodeId: 'n1' });
    expect(wide.right).toBe('properties');
    const narrow = run(wide, { type: 'viewport', narrow: true });
    expect(narrow.right).toBeNull();
    expect(narrow.paletteOpen).toBe(false);
  });

  it('crossing back up re-docks the panel that was docked-open', () => {
    const s = run(initialDrawerState(false), { type: 'toggleRight', mode: 'assistant' }, { type: 'viewport', narrow: true }, { type: 'viewport', narrow: false });
    expect(s.right).toBe('assistant');
  });

  it('crossing up does not invent a panel that was closed', () => {
    const s = run(initialDrawerState(false), { type: 'viewport', narrow: true }, { type: 'viewport', narrow: false });
    expect(s.right).toBeNull();
  });

  it('crossing up drops the palette drawer flag (the palette is docked again)', () => {
    const s = run(initialDrawerState(true), { type: 'togglePalette' });
    expect(s.paletteOpen).toBe(true);
    const wide = run(s, { type: 'viewport', narrow: false });
    expect(wide.paletteOpen).toBe(false);
    expect(run(wide, { type: 'viewport', narrow: true }).paletteOpen).toBe(false);
  });

  it('App wires the viewport event to the md media query', () => {
    const app = readFileSync(resolve(__dirname, '..', 'App.tsx'), 'utf-8');
    expect(app).toMatch(/useAfMedia\(AF_MEDIA\.md\)/);
    expect(app).toMatch(/dispatch_drawers\(\{ type: 'viewport', narrow \}\)/);
  });
});

describe('drawerLayout: one drawer at a time while narrow', () => {
  it('opening the palette closes the right drawer, even the assistant', () => {
    const s = run(initialDrawerState(true), { type: 'toggleRight', mode: 'assistant' }, { type: 'togglePalette' });
    expect(s).toMatchObject({ paletteOpen: true, right: null });
  });

  it('opening a right panel or selecting a node closes the palette', () => {
    expect(run(initialDrawerState(true), { type: 'togglePalette' }, { type: 'toggleRight', mode: 'functions' })).toMatchObject({ paletteOpen: false, right: 'functions' });
    expect(run(initialDrawerState(true), { type: 'togglePalette' }, { type: 'select', nodeId: 'n' })).toMatchObject({ paletteOpen: false, right: 'properties' });
  });

  it('Escape / backdrop closes everything; a palette tap-add closes the palette', () => {
    expect(run(initialDrawerState(true), { type: 'select', nodeId: 'n' }, { type: 'closeNarrow' })).toMatchObject({ paletteOpen: false, right: null });
    expect(run(initialDrawerState(true), { type: 'togglePalette' }, { type: 'paletteAdded' }).paletteOpen).toBe(false);
  });

  it('assistant and functions hold their ground on selection', () => {
    expect(run(initialDrawerState(false), { type: 'toggleRight', mode: 'functions' }, { type: 'select', nodeId: 'n' }).right).toBe('functions');
    expect(run(initialDrawerState(false), { type: 'select', nodeId: 'n' }, { type: 'select', nodeId: null }).right).toBeNull();
  });
});
