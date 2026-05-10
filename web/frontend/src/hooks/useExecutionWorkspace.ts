import { useQuery } from '@tanstack/react-query';
import { useGatewayCapabilities, gatewayContractsFromCapabilities } from './useGatewayCapabilities';
import { gatewayJson, gatewayPath } from '../utils/gatewayClient';

export interface ExecutionWorkspaceInfo {
  default_random_root?: string;
  policy?: Record<string, unknown>;
}

export function useExecutionWorkspace(enabled: boolean) {
  const capabilitiesQuery = useGatewayCapabilities(enabled);
  const contracts = gatewayContractsFromCapabilities(capabilitiesQuery.data);
  const endpoint = contracts?.common?.workspace?.policy_endpoint || '';

  return useQuery({
    queryKey: ['runs', 'execution-workspace', endpoint],
    queryFn: async () => {
      const res = await gatewayJson<{ policy?: Record<string, unknown> }>(gatewayPath(endpoint));
      const policy = res && typeof res === 'object' ? res.policy : undefined;
      if (!policy || typeof policy !== 'object') {
        console.warn('#FALLBACK: workspace policy missing; UI defaults may be incomplete');
      }
      return { default_random_root: '', policy };
    },
    enabled: enabled && Boolean(endpoint) && !capabilitiesQuery.isLoading && !capabilitiesQuery.isError,
    staleTime: 30_000,
  });
}
