/**
 * Artifact preview-kind resolution (backlog 0116).
 *
 * One tested mapping from (content type, filename, modality) to the preview
 * branch a viewer should take. The historical player recognized only
 * image/audio/video and dumped everything else on a forced-download link —
 * PDFs, text, markdown, JSON and YAML artifacts were unviewable in place.
 */

export type ArtifactPreviewKind =
  | 'image'
  | 'audio'
  | 'video'
  | 'pdf'
  | 'markdown'
  | 'text'
  | 'binary';

const MARKDOWN_EXTENSIONS = ['.md', '.markdown', '.mdown'];
const TEXT_EXTENSIONS = [
  '.txt',
  '.log',
  '.json',
  '.yaml',
  '.yml',
  '.csv',
  '.tsv',
  '.xml',
  '.html',
  '.htm',
  '.py',
  '.js',
  '.ts',
  '.tsx',
  '.jsx',
  '.sh',
  '.toml',
  '.ini',
  '.cfg',
];
const TEXT_CONTENT_TYPES = [
  'application/json',
  'application/x-yaml',
  'application/yaml',
  'application/xml',
  'application/javascript',
  'application/x-ndjson',
  'application/csv',
];

function hasExtension(name: string, extensions: string[]): boolean {
  const lower = name.toLowerCase();
  return extensions.some((ext) => lower.endsWith(ext));
}

export function previewKindFor(
  contentType?: string | null,
  name?: string | null,
  modality?: string | null
): ArtifactPreviewKind {
  const type = String(contentType || '').toLowerCase().split(';')[0].trim();
  const file = String(name || '').trim();
  const mode = String(modality || '').toLowerCase().trim();
  // "No information" content types: filename extensions may speak. A concrete
  // non-matching type (e.g. image/png named report.pdf) always wins.
  const typeIsGeneric = !type || type === 'application/octet-stream' || type === 'binary/octet-stream';

  if (type.startsWith('image/') || mode === 'image') return 'image';
  if (type.startsWith('audio/') || mode === 'audio' || mode === 'voice' || mode === 'music') return 'audio';
  if (type.startsWith('video/') || mode === 'video') return 'video';
  if (type === 'application/pdf' || (typeIsGeneric && hasExtension(file, ['.pdf']))) return 'pdf';
  if (
    type === 'text/markdown' ||
    ((typeIsGeneric || type === 'text/plain') && hasExtension(file, MARKDOWN_EXTENSIONS))
  ) {
    return 'markdown';
  }
  if (type.startsWith('text/') || TEXT_CONTENT_TYPES.includes(type) || mode === 'text') return 'text';
  if (typeIsGeneric && hasExtension(file, TEXT_EXTENSIONS)) return 'text';
  return 'binary';
}

/** Cap for inline text previews. Larger content is clamped with a labeled
 * truncation notice; the full artifact stays one Download click away. */
export const TEXT_PREVIEW_CHAR_CAP = 200_000;

/** Bodies above this size are not downloaded for preview at all (honest
 * refusal + Download action) — declared tunable, protects the tab's memory,
 * never the durable artifact. */
export const TEXT_PREVIEW_FETCH_CAP_BYTES = 25_000_000;
