import { describe, expect, it } from 'vitest';
import { visionAdapterItemsFromGatewayCatalog } from './gatewayCatalog';

describe('visionAdapterItemsFromGatewayCatalog', () => {
  it('keeps distinct adapters from the same repo when weight files differ', () => {
    const payload = {
      catalog: { contract: 'gateway_catalog_v1', version: 1 },
      items: [
        {
          id: 'prithivMLmods/Unblur-Upscale:4x-ClearRealityV1.safetensors',
          provider: 'mlx-gen',
          label: 'mlx-gen / prithivMLmods/Unblur-Upscale:4x-ClearRealityV1.safetensors',
          adapter: 'prithivMLmods/Unblur-Upscale:4x-ClearRealityV1.safetensors',
          repo_id: 'prithivMLmods/Unblur-Upscale',
          weight_name: '4x-ClearRealityV1.safetensors',
          suggested_target_roles: ['image'],
          compatible_tasks: ['image_to_image'],
        },
        {
          id: 'prithivMLmods/Unblur-Upscale:4x-Nomos8kSCHAT.safetensors',
          provider: 'mlx-gen',
          label: 'mlx-gen / prithivMLmods/Unblur-Upscale:4x-Nomos8kSCHAT.safetensors',
          adapter: 'prithivMLmods/Unblur-Upscale:4x-Nomos8kSCHAT.safetensors',
          repo_id: 'prithivMLmods/Unblur-Upscale',
          weight_name: '4x-Nomos8kSCHAT.safetensors',
          suggested_target_roles: ['image'],
          compatible_tasks: ['image_to_image'],
        },
      ],
    };

    const items = visionAdapterItemsFromGatewayCatalog(payload);

    expect(items).toHaveLength(2);
    expect(items.map((item) => item.source)).toEqual([
      'prithivMLmods/Unblur-Upscale:4x-ClearRealityV1.safetensors',
      'prithivMLmods/Unblur-Upscale:4x-Nomos8kSCHAT.safetensors',
    ]);
    expect(items.map((item) => item.weight_name)).toEqual([
      '4x-ClearRealityV1.safetensors',
      '4x-Nomos8kSCHAT.safetensors',
    ]);
  });
});
