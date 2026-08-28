import { describe, expect, it } from 'vitest';
import { MODALITY_COLORS } from '../types/flow';
import {
  buildHostMemoryView,
  buildSessionCacheViews,
  contextEstimateHint,
  filterResidencyRows,
  isProviderResidentRow,
  meterFraction,
  meterLevel,
  modalityFromTask,
  resolveModalityChip,
  residentStateLabel,
  rowConfigOnlyV1,
  rowContextView,
  rowResidentState,
  rowSizeText,
  rowStateKindV1,
  unloadConflictOffersForce,
} from './modelResidencyView';

describe('modality resolution', () => {
  it('maps tasks to fallback modalities', () => {
    expect(modalityFromTask('text_generation')).toBe('text');
    expect(modalityFromTask('image_generation')).toBe('image');
    expect(modalityFromTask('image_to_video')).toBe('video');
    expect(modalityFromTask('tts')).toBe('voice');
    expect(modalityFromTask('stt')).toBe('voice');
    expect(modalityFromTask('music_generation')).toBe('music');
    expect(modalityFromTask('embedding')).toBe('embedding');
    expect(modalityFromTask(null)).toBe('unknown');
    expect(modalityFromTask('')).toBe('unknown');
  });

  it('prefers the contract modality_ui map over the local fallback', () => {
    const chip = resolveModalityChip(
      { version: 1, colors: { text_generation: { color: '#123456', label: 'LLM' } } },
      'text_generation'
    );
    expect(chip.color).toBe('#123456');
    expect(chip.label).toBe('LLM');
  });

  it('falls back to MODALITY_COLORS when the contract has no entry', () => {
    const chip = resolveModalityChip({ version: 1, colors: {} }, 'image_generation');
    expect(chip.color).toBe(MODALITY_COLORS.image);
    expect(chip.label).toBe('Image');

    const noContract = resolveModalityChip(null, 'music_generation');
    expect(noContract.color).toBe(MODALITY_COLORS.music);
  });

  it('renders a distinct Unknown chip for null task', () => {
    const chip = resolveModalityChip(null, null);
    expect(chip.label).toBe('Unknown');
    expect(chip.color).toBe(MODALITY_COLORS.unknown);
  });

  it('accepts contract maps keyed by modality instead of task', () => {
    const chip = resolveModalityChip(
      { version: 1, colors: { text: { color: '#ABCDEF' } } },
      'text_generation'
    );
    expect(chip.color).toBe('#ABCDEF');
  });
});

describe('row_v1 field readers', () => {
  it('keeps resident tri-state distinct', () => {
    expect(rowResidentState({ resident: true })).toBe('yes');
    expect(rowResidentState({ resident: false })).toBe('no');
    expect(rowResidentState({ resident: null })).toBe('unknown');
    expect(rowResidentState({})).toBe('unknown');
    expect(residentStateLabel('unknown')).toBe('Unknown');
  });

  it('formats sizes and context with calibration marker', () => {
    expect(rowSizeText({ size_bytes: 2 * 1024 ** 3 })).toBe('2.0 GB');
    expect(rowSizeText({ size_bytes: null })).toBe('');

    expect(rowContextView({ context_length: 32768, calibrated_context_length: 30000, context_calibrated: true })).toEqual({
      text: '30,000',
      calibrated: true,
    });
    expect(rowContextView({ context_length: 32768, context_calibrated: false })).toEqual({
      text: '32,768',
      calibrated: false,
    });
    expect(rowContextView({})).toEqual({ text: '', calibrated: false });
  });

  it('derives state kind from state text and residency', () => {
    expect(rowStateKindV1({ state: 'loaded', resident: true })).toBe('ok');
    expect(rowStateKindV1({ state: 'load_failed', resident: false })).toBe('error');
    expect(rowStateKindV1({ resident: null })).toBe('muted');
  });

  it('flags default-config-only rows', () => {
    expect(rowConfigOnlyV1({ default: true, resident: false })).toBe(true);
    expect(rowConfigOnlyV1({ default: true, resident: true })).toBe(false);
    expect(rowConfigOnlyV1({ default: true, resident: null })).toBe(false);
  });
});

describe('residency row filtering', () => {
  const rows = [
    { provider: 'a', model: 'm1', resident: true },
    { provider: 'b', model: 'm2', resident: false },
    { provider: 'c', model: 'm3', resident: null },
  ];

  it('hides non-resident rows by default and reports the hidden count', () => {
    const { visible, hiddenCount } = filterResidencyRows(rows, true, false);
    expect(visible).toHaveLength(1);
    expect(visible[0].provider).toBe('a');
    expect(hiddenCount).toBe(2);
  });

  it('shows everything when the toggle is on', () => {
    const { visible, hiddenCount } = filterResidencyRows(rows, true, true);
    expect(visible).toHaveLength(3);
    expect(hiddenCount).toBe(0);
  });

  it('uses legacy provider-resident heuristics when rows are not v1', () => {
    const legacy = [
      { provider: 'a', model: 'm1', provider_resident: true },
      { provider: 'b', model: 'm2', state: 'provider_not_loaded' },
    ];
    expect(isProviderResidentRow(legacy[0])).toBe(true);
    const { visible, hiddenCount } = filterResidencyRows(legacy, false, false);
    expect(visible).toHaveLength(1);
    expect(hiddenCount).toBe(1);
  });
});

describe('unload 409 force decision', () => {
  it('offers force retry for 409 model_locked', () => {
    expect(unloadConflictOffersForce({ status: 409, detail: { error: 'model_locked' } })).toBe(true);
  });

  it('offers force retry for a truly bodyless 409', () => {
    expect(unloadConflictOffersForce({ status: 409, detail: '' })).toBe(true);
    expect(unloadConflictOffersForce({ status: 409, detail: null })).toBe(true);
    expect(unloadConflictOffersForce({ status: 409, detail: undefined })).toBe(true);
    expect(unloadConflictOffersForce({ status: 409, detail: 'model_locked' })).toBe(true);
  });

  it('refuses for an unparseable non-empty 409 body (e.g. HTML proxy page)', () => {
    expect(unloadConflictOffersForce({ status: 409, detail: '<html><body>Proxy conflict</body></html>' })).toBe(false);
    expect(unloadConflictOffersForce({ status: 409, detail: 'some other conflict text' })).toBe(false);
  });

  it('refuses for a parsed 409 body without a recognizable lock code', () => {
    expect(unloadConflictOffersForce({ status: 409, detail: { message: 'busy' } })).toBe(false);
    expect(unloadConflictOffersForce({ status: 409, detail: {} })).toBe(false);
  });

  it('refuses for non-409 or different error codes', () => {
    expect(unloadConflictOffersForce({ status: 500, detail: { error: 'model_locked' } })).toBe(false);
    expect(unloadConflictOffersForce({ status: 409, detail: { error: 'other_conflict' } })).toBe(false);
    expect(unloadConflictOffersForce(new Error('nope'))).toBe(false);
    expect(unloadConflictOffersForce(null)).toBe(false);
  });
});

describe('meter computation', () => {
  it('computes clamped fractions', () => {
    expect(meterFraction(50, 100)).toBe(0.5);
    expect(meterFraction(150, 100)).toBe(1);
    expect(meterFraction(-5, 100)).toBe(0);
    expect(meterFraction(50, 0)).toBeNull();
    expect(meterFraction('x', 100)).toBeNull();
  });

  it('maps fractions to theme levels', () => {
    expect(meterLevel(0.2)).toBe('ok');
    expect(meterLevel(0.8)).toBe('warn');
    expect(meterLevel(0.95)).toBe('error');
    expect(meterLevel(null)).toBe('ok');
  });
});

describe('buildHostMemoryView', () => {
  const state = {
    ok: true,
    memory: {
      ram: { total_bytes: 1000, available_bytes: 400, used_bytes: 600, percent: 60 },
      process: { rss_bytes: 123 * 1024 * 1024 },
      device: { backend: 'mps', allocated_bytes: 950, total_bytes: 1000, free_bytes: 50 },
    },
    gpu: { supported: true, gpus: [{ name: 'RTX', memory_used_bytes: 250, memory_total_bytes: 1000 }] },
    totals: { models: 3, size_bytes: 4 * 1024 ** 3, note: 'steady' },
    degraded: ['gpu_metrics'],
    reasons: { gpu_metrics: 'nvml unavailable' },
  };

  it('builds RAM/device/GPU meters with levels', () => {
    const view = buildHostMemoryView(state);
    const ids = view.meters.map((m) => m.id);
    expect(ids).toEqual(['ram', 'device', 'gpu-0']);
    expect(view.meters[0].fraction).toBeCloseTo(0.6);
    expect(view.meters[0].level).toBe('ok');
    expect(view.meters[1].level).toBe('error');
    expect(view.meters[1].label).toBe('Device (mps)');
    expect(view.meters[2].fraction).toBeCloseTo(0.25);
    expect(view.rssText).toBe('123.0 MB');
  });

  it('formats totals and degraded pills with reasons', () => {
    const view = buildHostMemoryView(state);
    expect(view.totals).toContainEqual({ label: 'size bytes', value: '4.0 GB' });
    expect(view.totals).toContainEqual({ label: 'models', value: '3' });
    expect(view.degraded).toEqual([{ name: 'gpu_metrics', reason: 'nvml unavailable' }]);
  });

  it('survives absent or junk host state', () => {
    expect(buildHostMemoryView(null).meters).toEqual([]);
    expect(buildHostMemoryView({}).rssText).toBe('');
    expect(buildHostMemoryView({ memory: 'junk' as never }).meters).toEqual([]);
  });
});

describe('buildSessionCacheViews', () => {
  it('reads session cache rows from the list payload', () => {
    const views = buildSessionCacheViews({
      ok: true,
      session_caches: [
        {
          key: 'k1',
          provider: 'anthropic',
          model: 'claude',
          session_id: 's-1',
          bytes: 2048,
          token_count: 1500,
          created_at_s: 1_700_000_000,
        },
      ],
    });
    expect(views).toHaveLength(1);
    expect(views[0].sessionId).toBe('s-1');
    expect(views[0].sizeText).toBe('2.0 KB');
    expect(views[0].tokenText).toBe('1,500');
    expect(views[0].createdText).not.toBe('');
  });

  it('accepts bare arrays and skips junk entries', () => {
    const views = buildSessionCacheViews([{ session_id: 's-2' }, 'junk', null]);
    expect(views).toHaveLength(1);
    expect(views[0].key).toBe('s-2');
    expect(views[0].sizeText).toBe('');
    expect(views[0].createdText).toBe('');
  });

  it('returns empty for junk payloads', () => {
    expect(buildSessionCacheViews(null)).toEqual([]);
    expect(buildSessionCacheViews('nope')).toEqual([]);
    expect(buildSessionCacheViews({})).toEqual([]);
  });
});

describe('contextEstimateHint', () => {
  it('formats predicted context, confidence, and notes', () => {
    expect(
      contextEstimateHint({ confidence: 'high', predicted_max_context: 32768, notes: ['calibrated on host'] })
    ).toBe('Predicted max context 32,768 · confidence high — calibrated on host');
  });

  it('handles numeric confidence and empty payloads', () => {
    expect(contextEstimateHint({ confidence: 0.8, predicted_max_context: 1000 })).toBe(
      'Predicted max context 1,000 · confidence 80%'
    );
    expect(contextEstimateHint({})).toBe('');
    expect(contextEstimateHint(null)).toBe('');
  });
});
