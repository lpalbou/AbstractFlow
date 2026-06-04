export const TEXT_OUTPUT_CAPABILITY_ROUTE = 'output.text';

export interface CapabilityRouteOption {
  value: string;
  label: string;
}

export const MODEL_CAPABILITY_ROUTE_OPTIONS: CapabilityRouteOption[] = [
  { value: 'output.text', label: 'Text output' },
  { value: 'input.text,output.text', label: 'Text input to text output' },
  { value: 'input.image,output.text', label: 'Image input to text output' },
  { value: 'input.video,output.text', label: 'Video input to text output' },
  { value: 'input.voice,output.text', label: 'Voice input to text output' },
  { value: 'input.sound,output.text', label: 'Sound input to text output' },
  { value: 'input.music,output.text', label: 'Music input to text output' },
  { value: 'embedding.text', label: 'Text embeddings' },
];

export type CapabilityRouteFilter = string | string[] | undefined | null;

export function normalizeCapabilityRouteFilter(filter: CapabilityRouteFilter): string[] {
  const raw = Array.isArray(filter) ? filter : typeof filter === 'string' ? filter.split(',') : [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const route = String(item || '').trim();
    if (!route || seen.has(route)) continue;
    seen.add(route);
    out.push(route);
  }
  return out;
}

export function capabilityRouteQueryValue(filter: CapabilityRouteFilter): string | undefined {
  const routes = normalizeCapabilityRouteFilter(filter);
  return routes.length > 0 ? routes.join(',') : undefined;
}

export function normalizeCapabilityRouteValue(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const queryValue = capabilityRouteQueryValue(value);
  return queryValue || undefined;
}
