import { useQuery } from '@tanstack/react-query';
import type { ProviderInfo } from '../types/flow';
import { useGatewayCapabilities, gatewayContractsFromCapabilities } from './useGatewayCapabilities';
import { gatewayJson, gatewayPath } from '../utils/gatewayClient';
import { DECISION_OUTPUT_CAPABILITY_ROUTE, capabilityRouteQueryValue, type CapabilityRouteFilter } from '../utils/capabilityRoutes';

export function useProviders(enabled: boolean) {
  const capabilitiesQuery = useGatewayCapabilities(enabled);
  const contracts = gatewayContractsFromCapabilities(capabilitiesQuery.data);
  const endpoint = contracts?.common?.discovery?.providers || '';

  return useQuery({
    queryKey: ['providers', endpoint],
    queryFn: async () => {
      const res = await gatewayJson<{ items?: ProviderInfo[] }>(gatewayPath(endpoint));
      if (!Array.isArray(res.items)) {
        console.warn('#FALLBACK: providers response missing items; returning empty list');
        return [];
      }
      return res.items;
    },
    enabled: enabled && Boolean(endpoint) && !capabilitiesQuery.isLoading && !capabilitiesQuery.isError,
    staleTime: 30_000,
  });
}

export function useModels(provider: string | undefined, enabled: boolean, capabilityRoute?: CapabilityRouteFilter) {
  const p = (provider || '').trim();
  const routeValue = capabilityRouteQueryValue(capabilityRoute);
  const capabilitiesQuery = useGatewayCapabilities(enabled && Boolean(p));
  const contracts = gatewayContractsFromCapabilities(capabilitiesQuery.data);
  const endpoint = contracts?.common?.discovery?.provider_models || '';

  return useQuery({
    queryKey: ['providers', p, 'models', endpoint, routeValue || ''],
    queryFn: async () => {
      const res = await gatewayJson<{ items?: string[]; models?: string[] }>(
        gatewayPath(endpoint, { provider_name: p }, { capability_route: routeValue })
      );
      const models = Array.isArray(res.models)
        ? res.models
        : Array.isArray(res.items)
          ? res.items
          : [];
      if (models.length === 0 && !Array.isArray(res.models) && !Array.isArray(res.items)) {
        console.warn('#FALLBACK: provider models response missing models/items; returning empty list');
      }
      return models;
    },
    enabled: enabled && Boolean(p) && Boolean(endpoint) && !capabilitiesQuery.isLoading && !capabilitiesQuery.isError,
    staleTime: 30_000,
  });
}



/** The decision-model catalog: the providers that have at least one model on the `output.decision` route, and those models. */
export interface DecisionCatalog {
  providers: ProviderInfo[];
  modelsByProvider: Record<string, string[]>;
}

function modelIdOf(item: unknown): string {
  if (typeof item === 'string') return item.trim();
  if (!item || typeof item !== 'object') return '';
  const rec = item as Record<string, unknown>;
  for (const key of ['id', 'model', 'model_id', 'name']) {
    const value = rec[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

/**
 * The Decision node's `provider` / `model` pickers (card and Properties panel):
 * every discovered provider is asked for its `output.decision` models
 * (`provider_models?capability_route=output.decision`, the same per-provider
 * route call as `useModels`); a provider without one is left out.
 */
export function useDecisionCatalog(enabled: boolean) {
  const capabilitiesQuery = useGatewayCapabilities(enabled);
  const contracts = gatewayContractsFromCapabilities(capabilitiesQuery.data);
  const providersEndpoint = contracts?.common?.discovery?.providers || '';
  const modelsEndpoint = contracts?.common?.discovery?.provider_models || '';

  return useQuery({
    queryKey: ['decision-catalog', providersEndpoint, modelsEndpoint],
    queryFn: async (): Promise<DecisionCatalog> => {
      const res = await gatewayJson<{ items?: ProviderInfo[] }>(gatewayPath(providersEndpoint));
      const items = (Array.isArray(res.items) ? res.items : []).filter((p) => p && typeof p.name === 'string' && p.name.trim());
      const lists = await Promise.all(
        items.map(async (provider) => {
          try {
            const data = await gatewayJson<{ models?: unknown[]; items?: unknown[] }>(
              gatewayPath(modelsEndpoint, { provider_name: provider.name }, { capability_route: DECISION_OUTPUT_CAPABILITY_ROUTE })
            );
            const models = Array.isArray(data.models) ? data.models : Array.isArray(data.items) ? data.items : [];
            return [provider, Array.from(new Set(models.map(modelIdOf).filter(Boolean)))] as const;
          } catch {
            return [provider, [] as string[]] as const;
          }
        })
      );
      const providers: ProviderInfo[] = [];
      const modelsByProvider: Record<string, string[]> = {};
      for (const [provider, models] of lists) {
        if (models.length === 0) continue;
        providers.push(provider);
        modelsByProvider[provider.name] = models;
      }
      return { providers, modelsByProvider };
    },
    enabled: enabled && Boolean(providersEndpoint) && Boolean(modelsEndpoint) && !capabilitiesQuery.isLoading && !capabilitiesQuery.isError,
    staleTime: 30_000,
  });
}
