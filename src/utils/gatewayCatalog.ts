export interface GatewayCatalogMetadata {
  contract?: string;
  version?: number;
  kind?: string;
  scope?: string;
  primary_items_field?: string;
  [key: string]: unknown;
}

export interface GatewayCatalogItem {
  id: string;
  label: string;
  provider?: string;
  model?: string;
  tasks?: string[];
  parameters?: Record<string, unknown>;
  raw?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface GatewayVisionAdapterCatalogItem extends GatewayCatalogItem {
  source: string;
  compatible_models?: string[];
  compatible_tasks?: string[];
  suggested_target_roles?: string[];
  weight_name?: string;
  subfolder?: string;
  adapter_name?: string;
}

export interface GatewaySelectOption {
  value: string;
  label: string;
  provider?: string;
  item?: GatewayCatalogItem;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function textValue(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function normalizeKey(value: string): string {
  return value.trim().toLowerCase();
}

function dedupeOptions(options: GatewaySelectOption[]): GatewaySelectOption[] {
  const seen = new Set<string>();
  const out: GatewaySelectOption[] = [];
  for (const option of options) {
    const value = textValue(option.value);
    if (!value) continue;
    const key = normalizeKey(value);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...option, value, label: textValue(option.label) || value });
  }
  return out;
}

function stringList(value: unknown): string[] {
  if (typeof value === 'string' && value.trim()) return [value.trim()];
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const clean = item.trim();
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    out.push(clean);
  }
  return out;
}

export function gatewayCatalogMetadata(payload: unknown): GatewayCatalogMetadata | null {
  const rec = isRecord(payload) ? payload : null;
  const catalog = rec && isRecord(rec.catalog) ? rec.catalog : null;
  return catalog ? (catalog as GatewayCatalogMetadata) : null;
}

export function isGatewayCatalogV1(payload: unknown): boolean {
  const catalog = gatewayCatalogMetadata(payload);
  return catalog?.contract === 'gateway_catalog_v1' && catalog.version === 1;
}

function idFromItem(item: unknown, providerFallback = ''): string {
  if (typeof item === 'string') return item.trim();
  if (!isRecord(item)) return '';
  for (const key of ['id', 'model', 'model_id', 'routed_model', 'name', 'voice_id', 'profile_id']) {
    const value = textValue(item[key]);
    if (value) return value;
  }
  return providerFallback.trim();
}

function providerFromItem(item: unknown, fallback = ''): string {
  if (!isRecord(item)) return fallback.trim();
  for (const key of ['provider', 'provider_id', 'provider_name', 'backend', 'owned_by']) {
    const value = textValue(item[key]);
    if (value) return value;
  }
  return fallback.trim();
}

function labelFromItem(item: unknown, fallback: string): string {
  if (!isRecord(item)) return fallback;
  return (
    textValue(item.label) ||
    textValue(item.display_name) ||
    textValue(item.title) ||
    textValue(item.name) ||
    fallback
  );
}

function itemToCatalogItem(item: unknown, providerFallback = ''): GatewayCatalogItem | null {
  const id = idFromItem(item, providerFallback);
  if (!id) return null;
  const rec = isRecord(item) ? item : {};
  const provider = providerFromItem(item, providerFallback);
  const model = textValue(rec.model) || textValue(rec.model_id) || textValue(rec.routed_model) || id;
  const label = labelFromItem(item, provider && model ? `${provider} / ${model}` : id);
  const out: GatewayCatalogItem = {
    ...rec,
    id,
    label,
  };
  if (provider) out.provider = provider;
  if (model) out.model = model;
  const tasks = stringList(rec.tasks || rec.capabilities);
  if (tasks.length > 0) out.tasks = tasks;
  if (isRecord(rec.parameters)) out.parameters = rec.parameters;
  if (isRecord(item)) out.raw = item;
  return out;
}

export function gatewayCatalogItems(payload: unknown, legacyKeys: string[] = []): GatewayCatalogItem[] {
  const rec = isRecord(payload) ? payload : null;
  if (!rec) return [];
  const items: GatewayCatalogItem[] = [];
  const primary = arrayValue(rec.items);
  for (const item of primary) {
    const normalized = itemToCatalogItem(item);
    if (normalized) items.push(normalized);
  }
  if (items.length > 0) return items;

  for (const key of legacyKeys) {
    for (const item of arrayValue(rec[key])) {
      const normalized = itemToCatalogItem(item);
      if (normalized) items.push(normalized);
    }
  }
  return items;
}

export function providerOptionsFromGatewayCatalog(
  payload: unknown,
  legacyArrayKeys: string[] = [],
  legacyMapKeys: string[] = []
): GatewaySelectOption[] {
  const rec = isRecord(payload) ? payload : null;
  if (!rec) return [];
  const out: GatewaySelectOption[] = [];
  const add = (value: unknown) => {
    const valueRec = isRecord(value) ? value : null;
    const provider =
      (typeof value === 'string' ? value.trim() : '') ||
      textValue(valueRec?.provider) ||
      textValue(valueRec?.provider_id) ||
      textValue(valueRec?.backend_id) ||
      textValue(valueRec?.id) ||
      textValue(valueRec?.name);
    if (!provider) return;
    const item = itemToCatalogItem(value, provider) || undefined;
    out.push({ value: provider, label: labelFromItem(value, provider), item });
  };

  const catalogItems = gatewayCatalogItems(payload);
  if (catalogItems.length > 0) {
    for (const item of catalogItems) add(item);
  } else {
    for (const key of legacyArrayKeys) {
      for (const item of arrayValue(rec[key])) add(item);
    }
  }

  for (const key of legacyMapKeys) {
    const map = isRecord(rec[key]) ? rec[key] : null;
    if (!map) continue;
    for (const provider of Object.keys(map)) add(provider);
  }
  return dedupeOptions(out);
}

export function modelOptionsFromGatewayCatalog(
  payload: unknown,
  provider: string,
  legacyArrayKeys: string[] = [],
  legacyMapKeys: string[] = []
): GatewaySelectOption[] {
  const rec = isRecord(payload) ? payload : null;
  if (!rec) return [];
  const wanted = normalizeKey(provider || '');
  const out: GatewaySelectOption[] = [];
  const add = (item: unknown, providerFallback = provider) => {
    const normalized = itemToCatalogItem(item, providerFallback);
    if (!normalized) return;
    const itemProvider = normalizeKey(normalized.provider || providerFallback || '');
    if (wanted && itemProvider && itemProvider !== wanted) return;
    out.push({
      value: normalized.model || normalized.id,
      label: normalized.label,
      provider: normalized.provider || providerFallback,
      item: normalized,
    });
  };

  const catalogItems = gatewayCatalogItems(payload);
  if (catalogItems.length > 0) {
    for (const item of catalogItems) add(item);
  } else {
    for (const key of legacyArrayKeys) {
      for (const item of arrayValue(rec[key])) add(item);
    }
  }

  for (const key of legacyMapKeys) {
    const map = isRecord(rec[key]) ? rec[key] : null;
    if (!map) continue;
    for (const [mapProvider, values] of Object.entries(map)) {
      for (const item of arrayValue(values)) add(item, mapProvider);
    }
  }
  return dedupeOptions(out);
}

export function stringOptionsFromGatewayCatalog(payload: unknown, legacyKeys: string[] = []): string[] {
  return modelOptionsFromGatewayCatalog(payload, '', legacyKeys).map((option) => option.value);
}

export function visionAdapterItemsFromGatewayCatalog(payload: unknown): GatewayVisionAdapterCatalogItem[] {
  const items = gatewayCatalogItems(payload, ['adapters']);
  const out: GatewayVisionAdapterCatalogItem[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const raw = isRecord(item.raw) ? item.raw : {};
    const source =
      textValue(item.source) ||
      textValue(raw.source) ||
      textValue(raw.repo_id) ||
      textValue(raw.repo) ||
      textValue(item.id);
    if (!source) continue;
    const provider = textValue(item.provider) || textValue(raw.provider);
    const key = `${normalizeKey(provider)}::${normalizeKey(source)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      ...item,
      source,
      compatible_models: stringList(item.compatible_models || raw.compatible_models),
      compatible_tasks: stringList(item.compatible_tasks || raw.compatible_tasks || item.tasks || raw.tasks),
      suggested_target_roles: stringList(item.suggested_target_roles || raw.suggested_target_roles),
      weight_name: textValue(item.weight_name) || textValue(raw.weight_name),
      subfolder: textValue(item.subfolder) || textValue(raw.subfolder),
      adapter_name: textValue(item.adapter_name) || textValue(raw.adapter_name),
    });
  }
  return out;
}
