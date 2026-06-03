import { useQuery } from '@tanstack/react-query';
import { useGatewayCapabilities, gatewayContractsFromCapabilities } from './useGatewayCapabilities';
import { gatewayJson, gatewayPath } from '../utils/gatewayClient';

export type SemanticsPredicate = {
  id: string;
  label?: string | null;
  inverse?: string | null;
  description?: string | null;
};

export type SemanticsEntityType = {
  id: string;
  label?: string | null;
  parent?: string | null;
  description?: string | null;
};

export type SemanticsRegistry = {
  ok: boolean;
  version: number;
  prefixes: Record<string, string>;
  predicates: SemanticsPredicate[];
  entity_types: SemanticsEntityType[];
};

export function useSemanticsRegistry(enabled: boolean) {
  const capabilitiesQuery = useGatewayCapabilities(enabled);
  const contracts = gatewayContractsFromCapabilities(capabilitiesQuery.data);
  const endpoint = contracts?.common?.discovery?.semantics || '';

  return useQuery({
    queryKey: ['semantics-registry', endpoint],
    queryFn: () => gatewayJson<SemanticsRegistry>(gatewayPath(endpoint)),
    enabled: enabled && Boolean(endpoint) && !capabilitiesQuery.isLoading && !capabilitiesQuery.isError,
    staleTime: 60_000,
  });
}
