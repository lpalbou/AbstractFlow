import { describe, expect, it } from 'vitest';
import {
  MODEL_RESIDENCY_ROW_SCHEMA,
  normalizeModelResidencyResponse,
  residencyResponseHasRowV1,
} from './useModelResidency';

describe('normalizeModelResidencyResponse row_v1 preference', () => {
  it('prefers rows when row_schema is model_residency_row_v1', () => {
    const out = normalizeModelResidencyResponse({
      ok: true,
      row_schema: MODEL_RESIDENCY_ROW_SCHEMA,
      rows: [
        {
          runtime_id: 'rt-1',
          task: 'text_generation',
          provider: 'lmstudio',
          model: 'qwen3-8b',
          resident: true,
          locked: false,
          lockable: true,
          size_bytes: 123456789,
          context_length: 32768,
          calibrated_context_length: 30000,
          context_calibrated: true,
        },
      ],
      // Legacy aliases present at the same time must LOSE to rows.
      models: [{ provider: 'legacy', model: 'legacy-model' }],
    });

    expect(out.row_schema).toBe(MODEL_RESIDENCY_ROW_SCHEMA);
    expect(out.models).toHaveLength(1);
    expect(out.models?.[0].provider).toBe('lmstudio');
    expect(out.rows).toHaveLength(1);
    expect(out.rows?.[0].calibrated_context_length).toBe(30000);
    expect(residencyResponseHasRowV1(out)).toBe(true);
  });

  it('preserves tri-state resident null through normalization', () => {
    const out = normalizeModelResidencyResponse({
      row_schema: MODEL_RESIDENCY_ROW_SCHEMA,
      rows: [{ provider: 'p', model: 'm', resident: null }],
    });
    expect(out.rows?.[0].resident).toBeNull();
  });

  it('does not let empty schema rows blank a populated legacy models array', () => {
    // Transitional/buggy gateway: row_schema advertised with rows: [] BUT a
    // populated legacy array alongside — legacy must render, not an empty panel.
    const out = normalizeModelResidencyResponse({
      row_schema: MODEL_RESIDENCY_ROW_SCHEMA,
      rows: [],
      models: [{ provider: 'legacy', model: 'legacy-model' }],
    });
    expect(out.models).toHaveLength(1);
    expect(out.models?.[0].provider).toBe('legacy');
    expect(residencyResponseHasRowV1(out)).toBe(false);
  });

  it('accepts empty schema rows when nothing legacy is populated', () => {
    const out = normalizeModelResidencyResponse({
      row_schema: MODEL_RESIDENCY_ROW_SCHEMA,
      rows: [],
    });
    expect(out.models).toEqual([]);
    expect(residencyResponseHasRowV1(out)).toBe(true);
  });

  it('falls back to the legacy chain when rows is non-array junk despite row_schema', () => {
    const out = normalizeModelResidencyResponse({
      row_schema: MODEL_RESIDENCY_ROW_SCHEMA,
      rows: 'junk',
      models: [{ provider: 'legacy', model: 'legacy-model' }],
    });
    expect(out.models).toHaveLength(1);
    expect(out.models?.[0].provider).toBe('legacy');
    expect(out.rows).toBeUndefined();
    expect(residencyResponseHasRowV1(out)).toBe(false);
  });

  it('ignores rows without the advertised schema and falls back to legacy aliases', () => {
    const out = normalizeModelResidencyResponse({
      rows: [{ provider: 'ignored', model: 'ignored' }],
      items: [{ provider: 'legacy', model: 'legacy-model' }],
    });
    expect(out.models).toHaveLength(1);
    expect(out.models?.[0].provider).toBe('legacy');
    expect(residencyResponseHasRowV1(out)).toBe(false);
  });

  it('keeps the legacy alias chain working (models/items/loaded/runtimes/data)', () => {
    for (const key of ['models', 'items', 'loaded', 'runtimes', 'data']) {
      const out = normalizeModelResidencyResponse({ [key]: [{ provider: 'p', model: 'm' }] });
      expect(out.models, key).toHaveLength(1);
    }
  });

  it('drops junk entries and survives junk payloads', () => {
    const out = normalizeModelResidencyResponse({
      row_schema: MODEL_RESIDENCY_ROW_SCHEMA,
      rows: [{ provider: 'p', model: 'm' }, 'junk', 42, null],
    });
    expect(out.models).toHaveLength(1);

    const bad = normalizeModelResidencyResponse('nonsense');
    expect(bad.ok).toBe(false);
    expect(bad.models).toEqual([]);

    const arr = normalizeModelResidencyResponse([{ provider: 'p', model: 'm' }]);
    expect(arr.models).toHaveLength(1);
    expect(residencyResponseHasRowV1(arr)).toBe(false);
  });

  it('still camelCase-normalizes identifiers inside preferred rows', () => {
    const out = normalizeModelResidencyResponse({
      row_schema: MODEL_RESIDENCY_ROW_SCHEMA,
      rows: [{ runtimeId: 'rt-9', provider: 'p', model: 'm' }],
    });
    expect(out.models?.[0].runtime_id).toBe('rt-9');
  });
});
