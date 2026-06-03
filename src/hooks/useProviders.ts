import { useQuery } from '@tanstack/react-query';
import type { ProviderInfo } from '../types/flow';
import { useGatewayCapabilities, gatewayContractsFromCapabilities } from './useGatewayCapabilities';
import { gatewayJson, gatewayPath } from '../utils/gatewayClient';

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

export function useModels(provider: string | undefined, enabled: boolean) {
  const p = (provider || '').trim();
  const capabilitiesQuery = useGatewayCapabilities(enabled && Boolean(p));
  const contracts = gatewayContractsFromCapabilities(capabilitiesQuery.data);
  const endpoint = contracts?.common?.discovery?.provider_models || '';

  return useQuery({
    queryKey: ['providers', p, 'models', endpoint],
    queryFn: async () => {
      const res = await gatewayJson<{ items?: string[]; models?: string[] }>(gatewayPath(endpoint, { provider_name: p }));
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



