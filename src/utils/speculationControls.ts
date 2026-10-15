import { normalizeSpeculationValue, type SpeculationValue } from '@abstractframework/ui-kit';

export function parseSpeculationInput(text: string): SpeculationValue | undefined {
  if (!text.trim()) return undefined;
  try { return normalizeSpeculationValue(JSON.parse(text)); } catch { return undefined; }
}
