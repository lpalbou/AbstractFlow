/**
 * Editor side-panel state across layouts (DESIGN.md 5.2 / 5.4).
 *
 * At >= 1024 px the node palette is always docked and the right drawer
 * (assistant / properties / functions) is a docked column. Below 1024 px both
 * float over the full-bleed canvas as drawers, one at a time.
 *
 * The state is explicit so crossing the breakpoint is deterministic:
 * - crossing DOWN closes every drawer (a docked panel must not reappear as an
 *   overlay across the canvas) and remembers which right panel was docked;
 * - crossing UP re-docks that panel (or the one the user opened while
 *   narrow) and drops the palette drawer flag (the palette is docked again).
 */
export type RightDrawerMode = 'assistant' | 'properties' | 'functions' | null;

export interface DrawerState {
  narrow: boolean;
  /** Palette drawer open (meaningful only while narrow). */
  paletteOpen: boolean;
  right: RightDrawerMode;
  /** Right panel that was docked-open when the window crossed below 1024. */
  dockedRight: RightDrawerMode;
}

export type DrawerEvent =
  | { type: 'viewport'; narrow: boolean }
  | { type: 'togglePalette' }
  | { type: 'closePalette' }
  | { type: 'toggleRight'; mode: Exclude<RightDrawerMode, null> }
  | { type: 'select'; nodeId: string | null }
  /** Escape or a backdrop tap while narrow. */
  | { type: 'closeNarrow' }
  /** A palette tap added a node (the palette drawer gets out of the way). */
  | { type: 'paletteAdded' };

export function initialDrawerState(narrow: boolean): DrawerState {
  return { narrow, paletteOpen: false, right: null, dockedRight: null };
}

export function drawerReducer(state: DrawerState, event: DrawerEvent): DrawerState {
  switch (event.type) {
    case 'viewport': {
      if (event.narrow === state.narrow) return state;
      if (event.narrow) {
        return { narrow: true, paletteOpen: false, right: null, dockedRight: state.right };
      }
      return { narrow: false, paletteOpen: false, right: state.right ?? state.dockedRight, dockedRight: null };
    }
    case 'togglePalette': {
      const paletteOpen = !state.paletteOpen;
      // One drawer at a time while narrow; the assistant stays mounted (its
      // state survives) even when its drawer is closed.
      return { ...state, paletteOpen, right: paletteOpen && state.narrow ? null : state.right };
    }
    case 'closePalette':
      return state.paletteOpen ? { ...state, paletteOpen: false } : state;
    case 'toggleRight': {
      const right = state.right === event.mode ? null : event.mode;
      return { ...state, right, paletteOpen: right && state.narrow ? false : state.paletteOpen };
    }
    case 'select': {
      // Assistant and Functions hold their ground on selection: the functions
      // panel's Used-by rows SELECT nodes.
      if (state.right === 'assistant' || state.right === 'functions') return state;
      const right: RightDrawerMode = event.nodeId ? 'properties' : null;
      if (right === state.right) return state;
      return { ...state, right, paletteOpen: right && state.narrow ? false : state.paletteOpen };
    }
    case 'closeNarrow':
      return { ...state, paletteOpen: false, right: null };
    case 'paletteAdded':
      return state.narrow && state.paletteOpen ? { ...state, paletteOpen: false } : state;
    default:
      return state;
  }
}
