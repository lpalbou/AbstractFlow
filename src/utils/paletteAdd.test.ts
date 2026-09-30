import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PALETTE_ADD_NODE_EVENT, PALETTE_TAP_ADD_QUERY, addPaletteNodeAtCentre, requestPaletteAdd, type PaletteAddDeps } from './paletteAdd';
import type { NodeTemplate } from '../types/nodes';

const template = { type: 'llm_call', label: 'LLM Call' } as unknown as NodeTemplate;

function deps(over: Partial<PaletteAddDeps> = {}): PaletteAddDeps & { addNode: ReturnType<typeof vi.fn>; notify: ReturnType<typeof vi.fn> } {
  return {
    getBounds: () => ({ left: 100, top: 50, width: 400, height: 300 }),
    project: (p) => ({ x: p.x * 2, y: p.y * 2 }),
    addNode: vi.fn(),
    isExecView: () => false,
    notify: vi.fn(),
    ...over,
  } as PaletteAddDeps & { addNode: ReturnType<typeof vi.fn>; notify: ReturnType<typeof vi.fn> };
}

describe('paletteAdd: tap-to-add', () => {
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it('adds the tapped node at the centre of the visible canvas (projected to flow coordinates)', () => {
    const d = deps();
    expect(addPaletteNodeAtCentre(template, d)).toBe(true);
    // centre = (100 + 200, 50 + 150) = (300, 200); project doubles it
    expect(d.addNode).toHaveBeenCalledWith(template, { x: 600, y: 400 });
    expect(d.notify).toHaveBeenCalledWith('Added LLM Call node', 'success');
  });

  it('refuses in the execution view and before the canvas exists', () => {
    const exec = deps({ isExecView: () => true });
    expect(addPaletteNodeAtCentre(template, exec)).toBe(false);
    expect(exec.addNode).not.toHaveBeenCalled();
    const unmounted = deps({ getBounds: () => null });
    expect(addPaletteNodeAtCentre(template, unmounted)).toBe(false);
    expect(addPaletteNodeAtCentre(template, deps({ project: null }))).toBe(false);
  });

  it('requestPaletteAdd dispatches the template on the window event', () => {
    const target = new EventTarget();
    (globalThis as { window?: unknown }).window = target;
    const seen: unknown[] = [];
    target.addEventListener(PALETTE_ADD_NODE_EVENT, (e) => seen.push((e as CustomEvent).detail));
    requestPaletteAdd(template);
    expect(seen).toEqual([template]);
  });

  it('is enabled on touch screens and narrow layouts only', () => {
    expect(PALETTE_TAP_ADD_QUERY).toBe('(pointer: coarse), (max-width: 1023.98px)');
  });

  it('is wired: palette chips request it, the canvas and the shell listen', () => {
    const src = (f: string) => readFileSync(resolve(__dirname, '..', f), 'utf-8');
    expect(src('components/NodePalette.tsx')).toMatch(/paletteTapAddsNode\(\)\) requestPaletteAdd\(template\)/);
    expect(src('components/Canvas.tsx')).toMatch(/addEventListener\(PALETTE_ADD_NODE_EVENT[\s\S]{0,200}|addPaletteNodeAtCentre\(/);
    expect(src('components/Canvas.tsx')).toMatch(/addPaletteNodeAtCentre\(/);
    expect(src('App.tsx')).toMatch(/addEventListener\(PALETTE_ADD_NODE_EVENT/);
  });
});
