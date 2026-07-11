import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  gatewayJson,
  gatewayPath,
  type GatewayContracts,
  type GatewayGeneratedImageContract,
  type GatewayGeneratedVideoContract,
} from '../utils/gatewayClient';
import {
  visionAdapterItemsFromGatewayCatalog,
  type GatewayVisionAdapterCatalogItem,
} from '../utils/gatewayCatalog';

type SupportedVisionNodeType =
  | 'generate_image'
  | 'edit_image'
  | 'image_to_image'
  | 'generate_video'
  | 'text_to_video'
  | 'image_to_video';

type VisionAdapterRouteConfig = {
  endpoint: string;
  task: string;
  supportsLoRAAdapters: boolean;
};

type UseVisionAdapterCatalogArgs = {
  nodeType: string;
  gatewayContracts: GatewayContracts | null | undefined;
  capabilitiesLoading?: boolean;
  capabilitiesError?: boolean;
  provider: string;
  model: string;
  enabled?: boolean;
};

type UseVisionAdapterCatalogResult = {
  adapterItems: GatewayVisionAdapterCatalogItem[];
  canBrowse: boolean;
  isLoading: boolean;
  endpoint: string;
  task: string;
  supportsLoRAAdapters: boolean;
};

function firstString(...values: unknown[]): string {
  for (const value of values) {
    const clean = typeof value === 'string' ? value.trim() : '';
    if (clean) return clean;
  }
  return '';
}

function generatedImageContract(contracts: GatewayContracts | null | undefined): GatewayGeneratedImageContract | undefined {
  return contracts?.flow_editor?.media?.generated_image || contracts?.assistant?.media?.generated_image;
}

function editedImageContract(contracts: GatewayContracts | null | undefined): GatewayGeneratedImageContract | undefined {
  return contracts?.flow_editor?.media?.edited_image || contracts?.assistant?.media?.edited_image;
}

function generatedVideoContract(contracts: GatewayContracts | null | undefined): GatewayGeneratedVideoContract | undefined {
  return contracts?.flow_editor?.media?.generated_video || contracts?.assistant?.media?.generated_video;
}

function imageToVideoContract(contracts: GatewayContracts | null | undefined): GatewayGeneratedVideoContract | undefined {
  return contracts?.flow_editor?.media?.image_to_video || contracts?.assistant?.media?.image_to_video;
}

function resolveVisionAdapterRouteConfig(
  nodeType: string,
  contracts: GatewayContracts | null | undefined
): VisionAdapterRouteConfig {
  const commonEndpoint = firstString(contracts?.common?.discovery?.vision_adapters);
  const imageContract = generatedImageContract(contracts);
  const editContract = editedImageContract(contracts);
  const videoContract = generatedVideoContract(contracts);
  const i2vContract = imageToVideoContract(contracts);

  const byType: Partial<Record<SupportedVisionNodeType, VisionAdapterRouteConfig>> = {
    generate_image: {
      endpoint: firstString(imageContract?.direct_endpoint?.adapter_catalog_endpoint, commonEndpoint),
      task: firstString(imageContract?.direct_endpoint?.provider_models_task, 'text_to_image'),
      supportsLoRAAdapters: Boolean(imageContract?.direct_endpoint?.supports_lora_adapters),
    },
    edit_image: {
      endpoint: firstString(editContract?.direct_endpoint?.adapter_catalog_endpoint, commonEndpoint),
      task: firstString(editContract?.direct_endpoint?.provider_models_task, 'image_to_image'),
      supportsLoRAAdapters: Boolean(editContract?.direct_endpoint?.supports_lora_adapters),
    },
    image_to_image: {
      endpoint: firstString(editContract?.direct_endpoint?.adapter_catalog_endpoint, commonEndpoint),
      task: firstString(editContract?.direct_endpoint?.provider_models_task, 'image_to_image'),
      supportsLoRAAdapters: Boolean(editContract?.direct_endpoint?.supports_lora_adapters),
    },
    generate_video: {
      endpoint: firstString(videoContract?.direct_endpoint?.adapter_catalog_endpoint, commonEndpoint),
      task: firstString(videoContract?.direct_endpoint?.provider_models_task, 'text_to_video'),
      supportsLoRAAdapters: Boolean(videoContract?.direct_endpoint?.supports_lora_adapters),
    },
    text_to_video: {
      endpoint: firstString(videoContract?.direct_endpoint?.adapter_catalog_endpoint, commonEndpoint),
      task: firstString(videoContract?.direct_endpoint?.provider_models_task, 'text_to_video'),
      supportsLoRAAdapters: Boolean(videoContract?.direct_endpoint?.supports_lora_adapters),
    },
    image_to_video: {
      endpoint: firstString(i2vContract?.direct_endpoint?.adapter_catalog_endpoint, commonEndpoint),
      task: firstString(i2vContract?.direct_endpoint?.provider_models_task, 'image_to_video'),
      supportsLoRAAdapters: Boolean(i2vContract?.direct_endpoint?.supports_lora_adapters),
    },
  };

  return byType[nodeType as SupportedVisionNodeType] || { endpoint: '', task: '', supportsLoRAAdapters: false };
}

export function useVisionAdapterCatalog({
  nodeType,
  gatewayContracts,
  capabilitiesLoading = false,
  capabilitiesError = false,
  provider,
  model,
  enabled = true,
}: UseVisionAdapterCatalogArgs): UseVisionAdapterCatalogResult {
  const route = useMemo(() => resolveVisionAdapterRouteConfig(nodeType, gatewayContracts), [gatewayContracts, nodeType]);
  const cleanProvider = String(provider || '').trim();
  const cleanModel = String(model || '').trim();
  const canBrowse =
    enabled &&
    !capabilitiesLoading &&
    !capabilitiesError &&
    route.supportsLoRAAdapters &&
    !!route.endpoint &&
    !!route.task &&
    !!cleanProvider &&
    !!cleanModel;

  const query = useQuery({
    queryKey: ['vision-adapters', route.endpoint, route.task, cleanProvider, cleanModel],
    queryFn: () =>
      gatewayJson<any>(
        gatewayPath(route.endpoint, {}, {
          task: route.task,
          provider: cleanProvider,
          model: cleanModel,
        }),
        { timeoutMs: 30_000 }
      ),
    enabled: canBrowse,
    staleTime: 30_000,
  });

  const adapterItems = useMemo(() => visionAdapterItemsFromGatewayCatalog(query.data), [query.data]);

  return {
    adapterItems,
    canBrowse,
    isLoading: capabilitiesLoading || (canBrowse && query.isLoading),
    endpoint: route.endpoint,
    task: route.task,
    supportsLoRAAdapters: route.supportsLoRAAdapters,
  };
}
