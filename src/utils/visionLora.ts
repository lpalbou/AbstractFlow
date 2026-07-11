import type { JsonValue } from '../types/flow';
import type { GatewayVisionAdapterCatalogItem } from './gatewayCatalog';

export type FlowVisionLoRAAdapter = {
  source: string;
  scale?: number;
  target_role?: string;
  weight_name?: string;
  subfolder?: string;
  adapter_name?: string;
};

export type VisionAdapterSelectOption = {
  value: string;
  label: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

export function normalizeStoredLoRAAdapters(value: unknown): FlowVisionLoRAAdapter[] {
  let parsed = value;
  if (typeof parsed === 'string') {
    const text = parsed.trim();
    if (!text) return [];
    try {
      parsed = JSON.parse(text);
    } catch {
      return [];
    }
  }
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) parsed = [parsed];
  if (!Array.isArray(parsed)) return [];
  const out: FlowVisionLoRAAdapter[] = [];
  for (const item of parsed) {
    const record = asRecord(item);
    if (!record) continue;
    const source = String(record.source || record.id || '').trim();
    if (!source) continue;
    const scaleRaw = record.scale;
    const scale =
      scaleRaw === undefined || scaleRaw === null || scaleRaw === ''
        ? undefined
        : Number.isFinite(Number(scaleRaw))
          ? Number(scaleRaw)
          : undefined;
    out.push({
      source,
      scale,
      target_role: typeof record.target_role === 'string' && record.target_role.trim() ? record.target_role.trim() : undefined,
      weight_name: typeof record.weight_name === 'string' && record.weight_name.trim() ? record.weight_name.trim() : undefined,
      subfolder: typeof record.subfolder === 'string' && record.subfolder.trim() ? record.subfolder.trim() : undefined,
      adapter_name: typeof record.adapter_name === 'string' && record.adapter_name.trim() ? record.adapter_name.trim() : undefined,
    });
  }
  return out;
}

export function serializeLoRAAdapters(adapters: FlowVisionLoRAAdapter[]): JsonValue[] {
  return adapters
    .filter((item) => item && item.source.trim())
    .map((item) => ({
      source: item.source.trim(),
      ...(item.scale !== undefined ? { scale: item.scale } : {}),
      ...(item.target_role ? { target_role: item.target_role } : {}),
      ...(item.weight_name ? { weight_name: item.weight_name } : {}),
      ...(item.subfolder ? { subfolder: item.subfolder } : {}),
      ...(item.adapter_name ? { adapter_name: item.adapter_name } : {}),
    }));
}

export function adapterLabelFromCatalogItem(item: GatewayVisionAdapterCatalogItem): string {
  const label = String(item.label || '').trim();
  const provider = String(item.provider || '').trim();
  const source = String(item.source || item.id || '').trim();
  if (!provider) return label || source;
  if (!label) return `${provider} / ${source}`;
  return label.includes(provider) ? label : `${provider} / ${label}`;
}

export function adapterRoleOptions(
  item: GatewayVisionAdapterCatalogItem | undefined,
  currentValue = ''
): VisionAdapterSelectOption[] {
  const seen = new Set<string>();
  const out: VisionAdapterSelectOption[] = [{ value: '', label: 'Auto role' }];
  const add = (value: string, label = value) => {
    const clean = String(value || '').trim();
    if (!clean || seen.has(clean)) return;
    seen.add(clean);
    out.push({ value: clean, label });
  };
  for (const role of item?.suggested_target_roles || []) add(role);
  if (currentValue) add(currentValue);
  return out;
}

export function visionAdapterSourceOptions(
  catalogItems: GatewayVisionAdapterCatalogItem[],
  currentAdapters: FlowVisionLoRAAdapter[]
): VisionAdapterSelectOption[] {
  const seen = new Set<string>();
  const out: VisionAdapterSelectOption[] = [];
  const add = (value: string, label: string) => {
    const clean = value.trim();
    if (!clean || seen.has(clean)) return;
    seen.add(clean);
    out.push({ value: clean, label: label.trim() || clean });
  };
  for (const adapter of currentAdapters) add(adapter.source, adapter.source);
  for (const item of catalogItems) add(item.source, adapterLabelFromCatalogItem(item));
  return out;
}

export function mergeLoRAAdapterSelection(
  currentAdapters: FlowVisionLoRAAdapter[],
  selectedSources: string[],
  catalogItems: GatewayVisionAdapterCatalogItem[]
): FlowVisionLoRAAdapter[] {
  const bySource = new Map<string, FlowVisionLoRAAdapter>();
  for (const item of currentAdapters) {
    const clean = String(item.source || '').trim();
    if (!clean || bySource.has(clean)) continue;
    bySource.set(clean, item);
  }
  const catalogBySource = new Map<string, GatewayVisionAdapterCatalogItem>();
  for (const item of catalogItems) {
    const clean = String(item.source || '').trim();
    if (!clean || catalogBySource.has(clean)) continue;
    catalogBySource.set(clean, item);
  }
  const seen = new Set<string>();
  const out: FlowVisionLoRAAdapter[] = [];
  for (const source of selectedSources) {
    const clean = String(source || '').trim();
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    const previous = bySource.get(clean);
    const catalog = catalogBySource.get(clean);
    const suggestedRoles = catalog?.suggested_target_roles || [];
    const previousRole = previous?.target_role;
    const targetRole =
      previousRole && (suggestedRoles.length === 0 || suggestedRoles.includes(previousRole))
        ? previousRole
        : suggestedRoles.length === 1
          ? suggestedRoles[0]
          : undefined;
    out.push({
      source: clean,
      scale: previous?.scale ?? 1,
      target_role: targetRole,
      weight_name: catalog?.weight_name || previous?.weight_name,
      subfolder: catalog?.subfolder || previous?.subfolder,
      adapter_name: catalog?.adapter_name || previous?.adapter_name,
    });
  }
  return out;
}
