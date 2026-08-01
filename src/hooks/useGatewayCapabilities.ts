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
    // This one query gates Save, Run, Publish and the flow library. The app's
    // global default is refetchOnWindowFocus:false (main.tsx), which left a
    // single transient failure — a gateway restart, an expired session —
    // poisoning those controls for the rest of the tab's life, healing only by
    // luck when some other component happened to mount a new observer. Let it
    // recover on its own instead.
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
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
