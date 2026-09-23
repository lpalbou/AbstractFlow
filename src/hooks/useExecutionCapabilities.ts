import { useQuery } from '@tanstack/react-query';
import { gatewayJson, gatewayPath } from '../utils/gatewayClient';

export function executionRoute(provider: string, model: string, defaults: unknown) {
  const rows = (defaults as { routes?: Array<Record<string, unknown>> })?.routes;
  const route = ['output.text', 'input.text'].map(key => Array.isArray(rows) ? rows.find(row => row.key === key && row.source !== 'not_configured') : undefined)
    .find(row => typeof row?.provider === 'string' && typeof row?.model === 'string');
  const p = provider.trim() || String(route?.provider || '');
  const m = model.trim() || ((!provider.trim() || provider.trim() === route?.provider) ? String(route?.model || '') : '');
  return { provider: p, model: m };
}

/** Resolve inherited identity for discovery only; never pin it into the flow. */
export function useExecutionCapabilities(provider: string, model: string, enabled = true) {
  const defaults = useQuery({
    queryKey: ['gateway', 'execution-default-route'],
    queryFn: () => gatewayJson(gatewayPath('/api/gateway/config/capability-defaults')),
    enabled: enabled && (!provider || !model), staleTime: 30_000,
  });
  const route = executionRoute(provider, model, defaults.data);
  const result = useQuery({
    queryKey: ['model-execution-capabilities', route.provider, route.model],
    queryFn: () => gatewayJson(gatewayPath('/api/gateway/discovery/models/capabilities', {}, {provider:route.provider, model_name:route.model})),
    enabled: enabled && Boolean(route.provider && route.model), staleTime: 30_000,
  });
  return { ...result, isFetching: result.isFetching || defaults.isFetching, isError: result.isError || defaults.isError };
}
