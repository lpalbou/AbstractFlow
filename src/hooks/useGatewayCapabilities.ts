import { useQuery } from '@tanstack/react-query';
import {
  gatewayJson,
  gatewayPath,
  getGatewayContracts,
  getGatewayFlowEditorReadiness,
  type GatewayCapabilitiesResponse,
  type GatewayContracts,
  type GatewayFlowEditorReadiness,
} from '../utils/gatewayClient';

export function useGatewayCapabilities(enabled = true) {
  return useQuery({
    queryKey: ['gateway', 'capabilities'],
    queryFn: () => gatewayJson<GatewayCapabilitiesResponse>(gatewayPath('/discovery/capabilities')),
    enabled,
    staleTime: 60_000,
    retry: 1,
  });
}

export function gatewayContractsFromCapabilities(data: GatewayCapabilitiesResponse | undefined | null): GatewayContracts | null {
  return getGatewayContracts(data);
}

export function gatewayReadinessFromCapabilities(
  data: GatewayCapabilitiesResponse | undefined | null
): GatewayFlowEditorReadiness {
  return getGatewayFlowEditorReadiness(getGatewayContracts(data));
}
