import { describe, expect, it } from 'vitest';
import { NODE_CATEGORIES, getNodeTemplate } from './nodes';

// 0113 catalog parity: pins the runtime already honors must exist on the
// templates, and file IO must be taught as Files, not Memory.
describe('catalog parity (backlog 0113)', () => {
  it('llm_call and agent declare max_output_tokens (runtime honors the key)', () => {
    for (const type of ['llm_call', 'agent'] as const) {
      const template = getNodeTemplate(type);
      expect(template, `missing template ${type}`).toBeTruthy();
      const pin = template!.inputs.find((p) => p.id === 'max_output_tokens');
      expect(pin, `${type}.max_output_tokens pin`).toBeTruthy();
      expect(pin!.type).toBe('number');
    }
  });

  it('keeps max_in_tokens beside max_output_tokens for both nodes', () => {
    for (const type of ['llm_call', 'agent'] as const) {
      const inputs = getNodeTemplate(type)!.inputs.map((p) => p.id);
      expect(inputs).toContain('max_in_tokens');
      expect(inputs).toContain('max_output_tokens');
    }
  });

  it('teaches file IO under a Files category distinct from Memory', () => {
    const files = NODE_CATEGORIES.files;
    expect(files, 'files category').toBeTruthy();
    const fileTypes = files.nodes.map((n) => n.type);
    for (const expected of [
      'read_file',
      'write_file',
      'read_pdf',
      'write_pdf',
      'write_docx',
      'write_chart',
      'list_folder_files',
      'import_workspace_file',
      'read_artifact',
      'export_artifact',
    ]) {
      expect(fileTypes).toContain(expected);
    }
    for (const template of files.nodes) {
      expect(template.category).toBe('files');
    }

    const memoryTypes = NODE_CATEGORIES.memory.nodes.map((n) => n.type);
    expect(memoryTypes).toContain('memory_note');
    expect(memoryTypes).not.toContain('read_file');
    expect(memoryTypes).not.toContain('export_artifact');
  });
});
