import { describe, expect, it } from 'vitest';
import { previewKindFor } from './artifactPreview';

describe('previewKindFor (backlog 0116)', () => {
  it('maps media content types to their players', () => {
    expect(previewKindFor('image/png')).toBe('image');
    expect(previewKindFor('audio/wav')).toBe('audio');
    expect(previewKindFor('video/mp4')).toBe('video');
  });

  it('respects modality hints when content type is missing', () => {
    expect(previewKindFor('', '', 'image')).toBe('image');
    expect(previewKindFor('', '', 'music')).toBe('audio');
    expect(previewKindFor('', '', 'voice')).toBe('audio');
    expect(previewKindFor('', '', 'video')).toBe('video');
    expect(previewKindFor('', '', 'text')).toBe('text');
  });

  it('recognizes PDFs by content type or extension', () => {
    expect(previewKindFor('application/pdf')).toBe('pdf');
    expect(previewKindFor('', 'report.PDF')).toBe('pdf');
    // octet-stream carries no information; the extension may speak.
    expect(previewKindFor('application/octet-stream', 'report.pdf')).toBe('pdf');
    // A concrete non-matching type wins over the extension.
    expect(previewKindFor('image/png', 'report.pdf')).toBe('image');
  });

  it('recognizes markdown before generic text', () => {
    expect(previewKindFor('text/markdown')).toBe('markdown');
    expect(previewKindFor('', 'notes.md')).toBe('markdown');
    expect(previewKindFor('text/plain', 'notes.md')).toBe('markdown');
  });

  it('treats structured text content types as text', () => {
    expect(previewKindFor('application/json')).toBe('text');
    expect(previewKindFor('application/x-yaml')).toBe('text');
    expect(previewKindFor('text/csv')).toBe('text');
    expect(previewKindFor('text/plain; charset=utf-8')).toBe('text');
  });

  it('uses file extensions when the content type carries no information', () => {
    expect(previewKindFor('', 'data.yaml')).toBe('text');
    expect(previewKindFor('', 'script.py')).toBe('text');
    expect(previewKindFor('application/octet-stream', 'data.yaml')).toBe('text');
    expect(previewKindFor('application/zip', 'data.yaml')).toBe('binary');
  });

  it('defaults to binary for unknown payloads', () => {
    expect(previewKindFor('application/octet-stream')).toBe('binary');
    expect(previewKindFor('', 'blob.bin')).toBe('binary');
    expect(previewKindFor(null, null)).toBe('binary');
  });
});
