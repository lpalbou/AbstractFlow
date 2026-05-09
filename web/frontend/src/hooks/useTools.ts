import { useQuery } from '@tanstack/react-query';
import { useGatewayCapabilities, gatewayContractsFromCapabilities } from './useGatewayCapabilities';
import { gatewayJson, gatewayPath } from '../utils/gatewayClient';

export interface ToolSpec {
  name: string;
  description?: string;
  /**
   * Tool parameter schema (best-effort, JSON-safe).
   * Convention: absence of `default` means "required".
   */
  parameters?: Record<string, { type?: string; default?: any }>;
  required_args?: string[];
  toolset?: string;
  tags?: string[];
  when_to_use?: string;
  examples?: unknown[];
}

export function useTools(enabled: boolean) {
  const capabilitiesQuery = useGatewayCapabilities(enabled);
  const contracts = gatewayContractsFromCapabilities(capabilitiesQuery.data);
  const endpoint = contracts?.common?.discovery?.tools || '/api/gateway/discovery/tools';

  return useQuery({
    queryKey: ['tools', endpoint],
    queryFn: async () => {
      const res = await gatewayJson<{ items?: ToolSpec[] }>(gatewayPath(endpoint));
      if (!Array.isArray(res.items)) {
        console.warn('#FALLBACK: tools response missing items; returning empty list');
        return [];
      }
      return res.items;
    },
    enabled: enabled && !capabilitiesQuery.isLoading,
    staleTime: 30_000,
  });
}
