/**
 * Human-readable byte formatting shared by workspace file listings and the
 * models/memory panel. Returns '' for non-finite or negative input so callers
 * can fall back to their own placeholder ('-', hidden, ...).
 *
 * BINARY math with BINARY labels (IEC), byte-identical to the gateway console
 * (`_fmtBytes`), console-tui / abstractcode-tui (`human_bytes`) and
 * `@abstractframework/monitor-memory` (`formatBytes`). This is a MEMORY figure
 * first, and memory is binary wherever it is configured or reported: this host
 * reads 137,438,953,472 B = 128.0 GiB exactly, and
 * `sysctl iogpu.wired_limit_mb=110000` lands on 115,343,360,000 B = 107.4 GiB.
 * The division by 1024 was always right here; the `GB` LABEL on it was the bug
 * — it read as decimal and disagreed with the web console's 1e9 math for the
 * same bytes (83.8 GB vs 89.99 GB for one 89,986,353,824 B GGUF). Keep the
 * units and the one decimal place in lockstep with the other four surfaces.
 */

const KiB = 1024;
const MiB = 1024 * KiB;
const GiB = 1024 * MiB;
const TiB = 1024 * GiB;

export function formatBytes(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return '';
  if (value < KiB) return `${value} B`;
  if (value < MiB) return `${(value / KiB).toFixed(1)} KiB`;
  if (value < GiB) return `${(value / MiB).toFixed(1)} MiB`;
  if (value < TiB) return `${(value / GiB).toFixed(1)} GiB`;
  return `${(value / TiB).toFixed(1)} TiB`;
}

export default formatBytes;
