import { describe, expect, it } from 'vitest';
import {
  adapterRoleOptions,
  mergeLoRAAdapterSelection,
  normalizeStoredLoRAAdapters,
  serializeLoRAAdapters,
  visionAdapterSourceOptions,
} from './visionLora';

describe('vision LoRA helpers', () => {
  it('round-trips stored adapter specs', () => {
    const stored = [
      {
        source: 'repo/adapter-a',
        scale: 0.75,
        target_role: 'transformer',
        weight_name: 'weights.safetensors',
      },
    ];

    const normalized = normalizeStoredLoRAAdapters(stored);

    expect(normalized).toEqual(stored);
    expect(serializeLoRAAdapters(normalized)).toEqual(stored);
  });

  it('keeps currently selected adapters visible even when not present in the fetched catalog', () => {
    const options = visionAdapterSourceOptions(
      [{ id: 'repo/adapter-b', label: 'Adapter B', source: 'repo/adapter-b' }],
      [{ source: 'repo/adapter-a', scale: 1 }]
    );

    expect(options.map((item) => item.value)).toEqual(['repo/adapter-a', 'repo/adapter-b']);
  });

  it('preserves order, keeps previous tuning, and auto-fills a single suggested target role', () => {
    const merged = mergeLoRAAdapterSelection(
      [
        {
          source: 'repo/adapter-a',
          scale: 0.55,
          target_role: 'transformer',
          weight_name: 'old-a.safetensors',
        },
      ],
      ['repo/adapter-b', 'repo/adapter-a'],
      [
        {
          id: 'repo/adapter-a',
          label: 'Adapter A',
          source: 'repo/adapter-a',
          weight_name: 'new-a.safetensors',
        },
        {
          id: 'repo/adapter-b',
          label: 'Adapter B',
          source: 'repo/adapter-b',
          adapter_name: 'cinematic-b',
          suggested_target_roles: ['transformer'],
        },
      ]
    );

    expect(merged).toEqual([
      {
        source: 'repo/adapter-b',
        scale: 1,
        target_role: 'transformer',
        adapter_name: 'cinematic-b',
        weight_name: undefined,
        subfolder: undefined,
      },
      {
        source: 'repo/adapter-a',
        scale: 0.55,
        target_role: 'transformer',
        adapter_name: undefined,
        weight_name: 'new-a.safetensors',
        subfolder: undefined,
      },
    ]);
  });

  it('keeps current target role available in role options', () => {
    const options = adapterRoleOptions(
      {
        id: 'repo/adapter',
        label: 'Adapter',
        source: 'repo/adapter',
        suggested_target_roles: ['transformer'],
      },
      'pipeline'
    );

    expect(options.map((item) => item.value)).toEqual(['', 'transformer', 'pipeline']);
  });
});
