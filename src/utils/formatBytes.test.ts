import { describe, expect, it } from 'vitest';
import { formatBytes } from './formatBytes';

describe('formatBytes', () => {
  it('returns empty string for invalid input', () => {
    expect(formatBytes(undefined)).toBe('');
    expect(formatBytes(null)).toBe('');
    expect(formatBytes(Number.NaN)).toBe('');
    expect(formatBytes(-1)).toBe('');
    expect(formatBytes(Number.POSITIVE_INFINITY)).toBe('');
  });

  it('formats bytes below 1 KB verbatim', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1023)).toBe('1023 B');
  });

  it('formats KB and MB with one decimal', () => {
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB');
    expect(formatBytes(2.5 * 1024 * 1024)).toBe('2.5 MB');
  });

  it('formats GB and TB for model-scale sizes', () => {
    expect(formatBytes(1024 ** 3)).toBe('1.0 GB');
    expect(formatBytes(7.5 * 1024 ** 3)).toBe('7.5 GB');
    expect(formatBytes(1024 ** 4)).toBe('1.00 TB');
    expect(formatBytes(1.25 * 1024 ** 4)).toBe('1.25 TB');
  });
});
