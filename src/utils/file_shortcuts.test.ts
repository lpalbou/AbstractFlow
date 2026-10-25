// O opens the Flow Library, C opens New flow: only with focus on the canvas
// or the page body, never while typing or with a dialog open; Ctrl/⌘+S stays.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DIALOG_SELECTOR, dialogOpen, fileShortcutFor, focusPlace } from './fileShortcuts';

const body = { tagName: 'BODY' };
const html = { tagName: 'HTML' };
const doc = { body, documentElement: html };

/** A fake element: its tag, and the selectors its ancestors match. */
function el(tagName: string, within: string[] = [], isContentEditable = false) {
  return { tagName, isContentEditable, closest: (sel: string) => (within.some((w) => sel.includes(w)) ? {} : null) };
}

describe('where focus is', () => {
  it('nothing or the page body', () => {
    expect(focusPlace(null, doc)).toBe('body');
    expect(focusPlace(body, doc)).toBe('body');
    expect(focusPlace(html, doc)).toBe('body');
  });
  it('the canvas (a node, the pane)', () => {
    expect(focusPlace(el('DIV', ['.canvas-wrapper']), doc)).toBe('canvas');
  });
  it('typing: input, textarea, select, contenteditable, even inside the canvas', () => {
    expect(focusPlace(el('INPUT', ['.canvas-wrapper']), doc)).toBe('editable');
    expect(focusPlace(el('TEXTAREA'), doc)).toBe('editable');
    expect(focusPlace(el('SELECT'), doc)).toBe('editable');
    expect(focusPlace(el('DIV', [], true), doc)).toBe('editable');
    expect(focusPlace(el('SPAN', ['[contenteditable="true"]']), doc)).toBe('editable');
    expect(focusPlace(el('DIV', ['[data-no-flow-hotkeys="true"]', '.canvas-wrapper']), doc)).toBe('editable');
  });
  it('anything else (a toolbar button, a side panel)', () => {
    expect(focusPlace(el('BUTTON'), doc)).toBe('other');
  });
});

describe('the shortcut guard', () => {
  it('O opens, C creates, from the canvas or the body', () => {
    for (const place of ['body', 'canvas'] as const) {
      expect(fileShortcutFor({ key: 'o' }, place, false)).toBe('open');
      expect(fileShortcutFor({ key: 'c' }, place, false)).toBe('new');
      // Caps Lock on.
      expect(fileShortcutFor({ key: 'O' }, place, false)).toBe('open');
    }
    expect(fileShortcutFor({ key: 'x' }, 'body', false)).toBeNull();
  });
  it('never while typing or focused elsewhere', () => {
    expect(fileShortcutFor({ key: 'o' }, 'editable', false)).toBeNull();
    expect(fileShortcutFor({ key: 'c' }, 'editable', false)).toBeNull();
    expect(fileShortcutFor({ key: 'c' }, 'other', false)).toBeNull();
  });
  it('never with a dialog open', () => {
    expect(fileShortcutFor({ key: 'o' }, 'body', true)).toBeNull();
    expect(fileShortcutFor({ key: 'c' }, 'canvas', true)).toBeNull();
    expect(dialogOpen({ querySelector: () => null })).toBe(false);
    expect(dialogOpen({ querySelector: (s) => (s === DIALOG_SELECTOR ? {} : null) })).toBe(true);
    expect(DIALOG_SELECTOR).toContain('.modal-overlay');
    expect(DIALOG_SELECTOR).toContain('[role="dialog"]');
  });
  it('never with a modifier (Ctrl/⌘+C copies, Ctrl/⌘+S saves), a repeat or an IME composition', () => {
    for (const mod of ['ctrlKey', 'metaKey', 'altKey', 'shiftKey'] as const) {
      expect(fileShortcutFor({ key: 'c', [mod]: true }, 'canvas', false)).toBeNull();
      expect(fileShortcutFor({ key: 'o', [mod]: true }, 'body', false)).toBeNull();
    }
    expect(fileShortcutFor({ key: 'o', repeat: true }, 'body', false)).toBeNull();
    expect(fileShortcutFor({ key: 'c', isComposing: true }, 'body', false)).toBeNull();
    expect(fileShortcutFor({ key: 'c', defaultPrevented: true }, 'body', false)).toBeNull();
  });
  it('the toolbar listens with this guard, names the letters, and keeps Ctrl/⌘+S', () => {
    const toolbar = readFileSync(new URL('../components/Toolbar.tsx', import.meta.url), 'utf8');
    expect(toolbar).toContain('const shortcut = fileShortcutFromEvent(e);');
    expect(toolbar).toContain('tooltip="New (C)"');
    expect(toolbar).toContain("'Open (O)'");
    expect(toolbar).toMatch(/if \(\(e\.key \|\| ''\)\.toLowerCase\(\) !== 's'\) return;/);
  });
});
