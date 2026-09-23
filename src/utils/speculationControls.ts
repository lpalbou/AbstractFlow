import { normalizeSpeculationValue, type SpeculationValue } from '@abstractframework/ui-kit';

export function parseSpeculationInput(text: string): SpeculationValue | undefined {
  if (!text.trim()) return undefined;
  try { return normalizeSpeculationValue(JSON.parse(text)); } catch { return undefined; }
}

/** Only the explicit run override changes _runtime; node pins remain authoritative. */
export function withRunSpeculation(input: Record<string, unknown>, speculation?: SpeculationValue): Record<string, unknown> {
  if (speculation === undefined) return input;
  const runtime = input._runtime && typeof input._runtime === 'object' && !Array.isArray(input._runtime) ? input._runtime : {};
  return { ...input, _runtime: { ...runtime, speculation } };
}
