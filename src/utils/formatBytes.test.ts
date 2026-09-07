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

  it('formats bytes below 1 KiB verbatim', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1023)).toBe('1023 B');
  });

  it('formats KiB and MiB with one decimal', () => {
    expect(formatBytes(1024)).toBe('1.0 KiB');
    expect(formatBytes(1536)).toBe('1.5 KiB');
    expect(formatBytes(1024 * 1024)).toBe('1.0 MiB');
    expect(formatBytes(2.5 * 1024 * 1024)).toBe('2.5 MiB');
  });

  it('formats GiB and TiB for model-scale sizes', () => {
    expect(formatBytes(1024 ** 3)).toBe('1.0 GiB');
    expect(formatBytes(7.5 * 1024 ** 3)).toBe('7.5 GiB');
    expect(formatBytes(1024 ** 4)).toBe('1.0 TiB');
    expect(formatBytes(1.25 * 1024 ** 4)).toBe('1.3 TiB');
  });

  // THE CROSS-SURFACE PIN. These six byte counts are the shared set: the same
  // assertions exist in the gateway web console (`_fmtBytes`),
  // `abstractgateway/console-tui` and `abstractcode-tui` (`human_bytes`), and
  // `@abstractframework/monitor-memory` (`formatBytes`). If this test and its
  // four siblings do not agree string-for-string, one model reads as two
  // different sizes depending on which surface the operator happens to open —
  // which is exactly what `89.99 GB` (web, 1e9) vs `83.8 GB` (TUIs, /1024)
  // did for a single 89,986,353,824 B GGUF.
  it('agrees with every other surface on the shared set', () => {
    expect(formatBytes(89_986_353_824)).toBe('83.8 GiB'); // the sharded GGUF
    expect(formatBytes(93_096_269_257)).toBe('86.7 GiB'); // Σ model weights
    expect(formatBytes(115_343_360_000)).toBe('107.4 GiB'); // wired limit
    expect(formatBytes(137_438_953_472)).toBe('128.0 GiB'); // RAM total
    expect(formatBytes(3_109_915_433)).toBe('2.9 GiB'); // qwen3-vl-4b
    expect(formatBytes(4_352_519_172)).toBe('4.1 GiB'); // session caches
  });

  // The labels are the load-bearing half of the fix: the math was already
  // binary here. `GiB` and `GB` differ by 7.4% at this scale, and a memory
  // panel that says `GB` while dividing by 1024 is simply lying about which
  // one it means.
  it('never labels a binary quotient with a decimal unit', () => {
    const rendered = [1024, 1024 ** 2, 1024 ** 3, 1024 ** 4].map((v) => formatBytes(v));
    expect(rendered).toEqual(['1.0 KiB', '1.0 MiB', '1.0 GiB', '1.0 TiB']);
    for (const s of rendered) expect(s).not.toMatch(/\d\s(KB|MB|GB|TB)$/);
  });
});
