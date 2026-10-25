/**
 * Provider and model choices for an automation's inputs (UX review #22): the
 * gateway's providers and the chosen (or default) provider's models, and the
 * gateway's default text model (capability defaults, route output.text), so
 * the first option can say "Use the default (…)".
 */
import { useEffect, useState } from 'react';
import { useModels, useProviders } from '../../hooks/useProviders';
import { gatewayCapabilityDefaults, type GatewayContracts } from '../../utils/gatewayClient';
import { resolveCodeAssistantModel } from '../../utils/codeAssistant';
import { TEXT_OUTPUT_CAPABILITY_ROUTE } from '../../utils/capabilityRoutes';
import type { ModelCatalog } from '../../utils/automationInputs';

export function useModelCatalog(contracts: GatewayContracts | null, provider: string): ModelCatalog {
  const [defaults, setDefaults] = useState<{ provider: string; model: string } | null>(null);
  useEffect(() => {
    let alive = true;
    if (!contracts) return undefined;
    gatewayCapabilityDefaults(contracts)
      .then((answer) => {
        const resolved = resolveCodeAssistantModel(answer);
        if (alive) setDefaults(resolved ? { provider: resolved.provider, model: resolved.model } : null);
      })
      .catch(() => {
        if (alive) setDefaults(null); // the first option then reads "Use the gateway's default"
      });
    return () => {
      alive = false;
    };
  }, [contracts]);
  const providers = useProviders(true);
  const models = useModels(provider.trim() || defaults?.provider || '', true, TEXT_OUTPUT_CAPABILITY_ROUTE);
  return {
    providers: (providers.data || []).map((p) => ({ value: p.name, label: p.display_name || p.name })),
    models: models.data || [],
    defaultProvider: defaults?.provider || '',
    defaultModel: defaults?.model || '',
  };
}
