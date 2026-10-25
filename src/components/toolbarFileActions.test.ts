import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// The toolbar's New / Open / Save group (operator 2026-10-25: three grey icons
// were easy to miss). vitest resolves CSS imports to '', so the sources are
// read from disk.

const ROOT = resolve(__dirname, '..', '..');
const TOOLBAR = readFileSync(resolve(ROOT, 'src', 'components', 'Toolbar.tsx'), 'utf-8');
const PALETTE = readFileSync(resolve(ROOT, 'src', 'styles', 'palette.css'), 'utf-8').replace(/\/\*[\s\S]*?\*\//g, '');

/** Declarations of the rules whose selector list contains `selector` exactly. */
function decls(css: string, selector: string): string {
  const out: string[] = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (m[1].split(',').map((s) => s.trim()).includes(selector)) out.push(m[2]);
  }
  return out.join(';');
}

/** The file group's JSX, from its aria-label to the Duplicate action. */
const FILE_GROUP = (() => {
  const start = TOOLBAR.indexOf('aria-label="Flow file actions"');
  const end = TOOLBAR.indexOf('label="Duplicate Flow"', start);
  expect(start).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(start);
  return TOOLBAR.slice(start, end);
})();

describe('toolbar New / Open / Save', () => {
  it('each action keeps its icon and gets its own class and word', () => {
    for (const [cls, icon, word] of [
      ['file-action new-button', '<IconFilePlus />', 'New'],
      ['file-action open-button', '<IconFolder />', 'Open'],
    ]) {
      expect(FILE_GROUP).toContain(`className="${cls}"`);
      expect(FILE_GROUP).toContain(icon);
      expect(FILE_GROUP).toContain(`<span className="file-action-label" aria-hidden="true">${word}</span>`);
    }
    expect(FILE_GROUP).toContain('<IconSave />');
    expect(FILE_GROUP).toContain('<span className="file-action-label" aria-hidden="true">Save</span>');
  });

  it('Save shows its state: the state class, a spinner while saving, the dot only for unsaved changes', () => {
    expect(FILE_GROUP).toContain('className={saveButtonClass({ savePending: saveMutation.isPending, hasUnsavedChanges })}');
    expect(FILE_GROUP).toContain('{saveMutation.isPending ? <IconSpinner /> : <IconSave />}');
    expect(FILE_GROUP).toMatch(/hasUnsavedChanges && !saveMutation\.isPending \? <span className="save-dirty-dot"/);
    // The tooltip is the save gate's (it names Ctrl/⌘+S when a save is possible).
    expect(FILE_GROUP).toContain('tooltip={saveDisabledReason}');
  });

  it('each action takes a palette hue, not a literal colour', () => {
    expect(decls(PALETTE, '.toolbar-button.new-button')).toMatch(/--file-hue:\s*var\(--flow-hue-violet/);
    expect(decls(PALETTE, '.toolbar-button.open-button')).toMatch(/--file-hue:\s*var\(--flow-hue-blue/);
    expect(decls(PALETTE, '.toolbar-button.save-button')).toMatch(/--file-hue:\s*var\(--flow-hue-yellow/);
    expect(decls(PALETTE, '.toolbar-group .toolbar-button.file-action')).toMatch(/color:\s*var\(--file-ink\)/);
  });

  it('unsaved = filled with the hue; saved = quiet; saving = not faded', () => {
    expect(decls(PALETTE, '.toolbar-group .toolbar-button.save-button.dirty')).toMatch(/background:\s*var\(--file-hue\)/);
    expect(decls(PALETTE, '.toolbar-group .toolbar-button.save-button:disabled')).toMatch(/background:\s*transparent/);
    expect(decls(PALETTE, '.toolbar-group .toolbar-button.save-button.saving:disabled')).toMatch(/opacity:\s*1/);
  });

  it('the words show only when the toolbar row has room (a container query on .toolbar)', () => {
    expect(decls(PALETTE, '.toolbar')).toMatch(/container:\s*flow-toolbar\s*\/\s*inline-size/);
    expect(decls(PALETTE, '.file-action-label')).toMatch(/display:\s*none/);
    const query = PALETTE.match(/@container flow-toolbar \(min-width: (\d+)px\)\s*\{([\s\S]*?)\n\}/);
    expect(query, 'no @container flow-toolbar rule').not.toBeNull();
    expect(decls(query![2], '.file-action-label')).toMatch(/display:\s*inline/);
  });
});
