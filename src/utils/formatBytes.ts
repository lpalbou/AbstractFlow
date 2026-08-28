/**
 * Human-readable byte formatting shared by workspace file listings and the
 * models/memory panel. Returns '' for non-finite or negative input so callers
 * can fall back to their own placeholder ('-', hidden, ...).
 */

const KB = 1024;
const MB = 1024 * KB;
const GB = 1024 * MB;
const TB = 1024 * GB;

export function formatBytes(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return '';
  if (value < KB) return `${value} B`;
  if (value < MB) return `${(value / KB).toFixed(1)} KB`;
  if (value < GB) return `${(value / MB).toFixed(1)} MB`;
  if (value < TB) return `${(value / GB).toFixed(1)} GB`;
  return `${(value / TB).toFixed(2)} TB`;
}

export default formatBytes;
