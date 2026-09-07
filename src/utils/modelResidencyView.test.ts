import { describe, expect, it } from 'vitest';
import { MODALITY_COLORS } from '../types/flow';
import {
  buildHostMemoryView,
  buildMemoryBreakdown,
  buildSessionCacheViews,
  deviceMemoryView,
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
  rowCacheBytes,
  rowDisplaySize,
  rowLockAction,
  rowLockAdopts,
  rowResidentState,
  rowSizeCell,
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
    expect(rowSizeText({ size_bytes: 2 * 1024 ** 3 })).toBe('2.0 GiB');
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
    // The label names the SCOPE of the number in the only two permitted
    // phrasings: this payload carries only the process-local allocation.
    expect(view.meters[1].label).toBe('Accelerator heap · mps (this process only)');
    expect(view.meters[1].note).toBe('memory-mapped GGUF weights are not counted here');
    expect(view.meters[2].fraction).toBeCloseTo(0.25);
  });

  it('states the gateway process RSS exactly ONCE, as a breakdown item', () => {
    const view = buildHostMemoryView(state);
    // The standalone RSS row is gone: a panel that prints RSS twice invites
    // the double-counting this breakdown exists to remove.
    expect(view).not.toHaveProperty('rssText');
    const rss = view.breakdown.items.filter((i) => i.key === 'process_rss');
    expect(rss).toHaveLength(1);
    expect(rss[0].bytesText).toBe('123.0 MiB');
    expect(rss[0].name).toBe('gateway process RSS');
  });

  it('formats totals and degraded pills with reasons', () => {
    const view = buildHostMemoryView(state);
    expect(view.totals).toContainEqual({ label: 'size bytes', value: '4.0 GiB' });
    expect(view.totals).toContainEqual({ label: 'models', value: '3' });
    expect(view.degraded).toEqual([{ name: 'gpu_metrics', reason: 'nvml unavailable' }]);
  });

  it('survives absent or junk host state', () => {
    expect(buildHostMemoryView(null).meters).toEqual([]);
    expect(buildHostMemoryView({}).breakdown.items).toEqual([]);
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
    expect(views[0].sizeText).toBe('2.0 KiB');
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

describe('display size coalescing', () => {
  it('takes the first KNOWN of size_bytes -> size_vram_bytes -> est_weights_bytes', () => {
    expect(rowDisplaySize({ size_bytes: 3, size_vram_bytes: 2, est_weights_bytes: 1 })).toMatchObject({
      bytes: 3,
      source: 'size_bytes',
    });
    expect(rowDisplaySize({ size_vram_bytes: 2, est_weights_bytes: 1 })).toMatchObject({
      bytes: 2,
      source: 'size_vram_bytes',
    });
    expect(rowDisplaySize({ est_weights_bytes: 1 })).toMatchObject({ bytes: 1, source: 'est_weights_bytes' });
    expect(rowDisplaySize({})).toMatchObject({ bytes: null, source: '' });
    // A reported zero is a FACT, not an absence.
    expect(rowDisplaySize({ size_bytes: 0 }).bytes).toBe(0);
  });

  it('labels an estimate as an estimate, never as a measurement', () => {
    expect(rowDisplaySize({ est_weights_bytes: 1 }).label).toContain('ESTIMATED');
    expect(rowDisplaySize({ size_bytes: 1 }).label).toBe('reported size');
  });

  it('renders the size cell with the cache as a secondary figure', () => {
    // The `~` marks the ESTIMATE in the rendered text, matching the TUIs.
    const cell = rowSizeCell({ est_weights_bytes: 3 * 1024 ** 3, cache_bytes: 400 * 1024 ** 2 });
    expect(cell.text).toBe('~3.0 GiB + 400.0 MiB cache');
    expect(cell.title).toContain('ESTIMATED');
    expect(cell.title).toContain('prompt/KV cache');

    // The row that used to render blank now renders its estimate.
    expect(rowSizeCell({ est_weights_bytes: 2048 }).text).toBe('~2.0 KiB');
    // Nothing known stays honestly empty, and the title says why.
    const unknown = rowSizeCell({});
    expect(unknown.text).toBe('');
    expect(unknown.title).toContain('Size unknown');
    // VRAM stays visible in the tooltip when it is not the headline figure.
    expect(rowSizeCell({ size_bytes: 10, size_vram_bytes: 8 }).title).toContain('VRAM');
  });

  it('reads cache bytes defensively', () => {
    expect(rowCacheBytes({ cache_bytes: 42 })).toBe(42);
    expect(rowCacheBytes({})).toBeNull();
    expect(rowCacheBytes({ cache_bytes: -1 })).toBeNull();
  });
});

describe('lock control per row', () => {
  it('offers Lock on every resident row, including sweep-resident ones', () => {
    // lockable UNREPORTED (null): locking adopts the externally loaded model.
    expect(rowLockAction({ resident: true })).toBe('lock');
    expect(rowLockAction({ resident: true, lockable: true })).toBe('lock');
    // Only an EXPLICIT refusal withholds the control.
    expect(rowLockAction({ resident: true, lockable: false })).toBeNull();
  });

  it('always offers Unlock for a locked row, resident or evicted', () => {
    expect(rowLockAction({ resident: true, locked: true })).toBe('unlock');
    expect(rowLockAction({ resident: false, locked: true })).toBe('unlock');
    expect(rowLockAction({ resident: null, locked: true, lockable: false })).toBe('unlock');
  });

  it('offers nothing on a non-resident, unlocked row', () => {
    expect(rowLockAction({ resident: false })).toBeNull();
    expect(rowLockAction({ resident: null })).toBeNull();
    expect(rowLockAction({})).toBeNull();
  });
});

describe('deviceMemoryView (the accelerator heap meter)', () => {
  it('prefers the all-processes figure and the wired limit over the process-local pair', () => {
    // The LIVE payload measured on the operator's Mac (2026-08-27): the
    // process-local allocation reads 0 while 105 GB is actually in use.
    const view = deviceMemoryView({
      backend: 'metal',
      allocated_bytes: 0,
      host_in_use_bytes: 105_743_990_784,
      wired_limit_bytes: 115_343_360_000,
      total_bytes: 137_438_953_472,
    })!;
    expect(view.scope).toBe('all processes');
    expect(view.usedBytes).toBe(105_743_990_784);
    expect(view.ceilingBytes).toBe(115_343_360_000);
    // EXACT label — never "Device (host)", never anything that reads as
    // whole-system usage.
    expect(view.label).toBe('Accelerator heap · metal (all processes)');
    expect(view.note).toBe('memory-mapped GGUF weights are not counted here');
    expect(view.detail).toContain('memory-mapped GGUF weights are not counted here');
    expect(view.detail).toContain('host_in_use_bytes');
    expect(view.detail).toContain('wired limit');
    // The scope word "host" is gone from every rendered string.
    expect(view.label).not.toMatch(/host/i);
    expect(view.detail).not.toContain('host-wide');
    expect(view.detail).not.toContain('Host-wide');
  });

  it('falls back to the process-local figure and SAYS it is this process only', () => {
    const view = deviceMemoryView({ backend: 'cuda', allocated_bytes: 500, total_bytes: 1000 })!;
    expect(view.scope).toBe('this process only');
    expect(view.usedBytes).toBe(500);
    expect(view.ceilingBytes).toBe(1000);
    expect(view.label).toBe('Accelerator heap · cuda (this process only)');
    expect(view.note).toBe('memory-mapped GGUF weights are not counted here');
    expect(view.detail).toContain('this process only');
  });

  it('uses the literal "device" when the backend is unknown', () => {
    expect(deviceMemoryView({ host_in_use_bytes: 10 })!.label).toBe('Accelerator heap · device (all processes)');
    expect(deviceMemoryView({ allocated_bytes: 10 })!.label).toBe('Accelerator heap · device (this process only)');
    expect(deviceMemoryView({ backend: '   ', allocated_bytes: 10 })!.label).toBe(
      'Accelerator heap · device (this process only)'
    );
  });

  it('derives the process figure from total - free, and keeps unknown unknown', () => {
    expect(deviceMemoryView({ total_bytes: 2000, free_bytes: 500 })!.usedBytes).toBe(1500);
    const blank = deviceMemoryView({ backend: 'metal' })!;
    expect(blank.usedBytes).toBeNull();
    expect(blank.ceilingBytes).toBeNull();
    expect(deviceMemoryView(null)).toBeNull();
    expect(deviceMemoryView('junk')).toBeNull();
  });

  it('never renders a 0 B bar when the all-processes figure is available', () => {
    const state = {
      memory: {
        device: { backend: 'metal', allocated_bytes: 0, host_in_use_bytes: 900, wired_limit_bytes: 1000 },
      },
    };
    const meter = buildHostMemoryView(state).meters.find((m) => m.id === 'device')!;
    expect(meter.usedText).toBe('900 B');
    expect(meter.totalText).toBe('1000 B');
    expect(meter.fraction).toBeCloseTo(0.9);
    expect(meter.label).toBe('Accelerator heap · metal (all processes)');
    expect(meter.note).toBe('memory-mapped GGUF weights are not counted here');
    expect(meter.title).toContain('host_in_use_bytes');
  });

  it('keeps RAM first — the accelerator heap is never the system meter', () => {
    const view = buildHostMemoryView({
      memory: {
        ram: { total_bytes: 1000, used_bytes: 600 },
        device: { backend: 'metal', host_in_use_bytes: 900, wired_limit_bytes: 1000 },
      },
    });
    expect(view.meters.map((m) => m.id)).toEqual(['ram', 'device']);
    expect(view.meters[0].label).toBe('RAM');
  });
});

describe('buildMemoryBreakdown', () => {
  const healthy = {
    memory: {
      device: { backend: 'metal', allocated_bytes: 0, host_in_use_bytes: 1000, wired_limit_bytes: 1200 },
      process: { rss_bytes: 100 },
    },
    models: [
      { provider: 'lmstudio', model: 'big', resident: true, size_bytes: 500, cache_bytes: 50 },
      { provider: 'mlx', model: 'est-only', resident: true, est_weights_bytes: 200 },
      { provider: 'mlx', model: 'not-loaded', resident: false, size_bytes: 900 },
      { provider: 'mlx', model: 'size-unknown', resident: true },
    ],
    session_caches: [{ bytes: 10 }, { bytes: 5 }],
    totals: { session_caches: 2, session_cache_bytes: 60 },
  };

  it('emits one item per resident model with a KNOWN size, weights only', () => {
    const view = buildMemoryBreakdown(healthy);
    expect(view.items.map((i) => i.key)).toEqual([
      'model:lmstudio:big',
      'model:mlx:est-only',
      'model_caches',
      'session_caches',
      'process_rss',
    ]);
    // The model item is the WEIGHTS; its cache belongs to `model_caches`.
    expect(view.items[0].name).toBe('big');
    expect(view.items[0].bytes).toBe(500);
    expect(view.items[0].detail).toBe('resident model weights · reported by the model server (size_bytes)');
    expect(view.items[1].bytes).toBe(200);
    expect(view.items[1].detail).toBe(
      'resident model weights · estimated on-disk weight size (est_weights_bytes)'
    );
    // The estimate marker is on the RENDERED text, as in the TUIs.
    expect(view.items[1].estimated).toBe(true);
    expect(view.items[1].bytesText).toBe('~200 B');
    expect(view.items[0].bytesText).toBe('500 B');
    // A resident row with no known size is SKIPPED — never an invented zero.
    expect(view.items.some((i) => i.name === 'size-unknown')).toBe(false);
  });

  it('keys a model item by runtime_id, else by provider:model — the shared rule', () => {
    // Real sweep rows carry `runtime_id: null`. The fallback must be the SAME
    // on all four surfaces, so it takes no index and no task segment.
    const sweep = buildMemoryBreakdown({
      models: [
        { runtime_id: null, provider: 'lmstudio', model: 'qwen/qwen3-vl-4b', resident: true, size_bytes: 1 },
      ],
    });
    expect(sweep.items[0].key).toBe('model:lmstudio:qwen/qwen3-vl-4b');

    // A non-empty runtime_id always wins.
    const withRuntimeId = buildMemoryBreakdown({
      models: [{ runtime_id: 'local:tg:lmstudio:qwen', provider: 'lmstudio', model: 'qwen', resident: true, size_bytes: 1 }],
    });
    expect(withRuntimeId.items[0].key).toBe('model:local:tg:lmstudio:qwen');

    // Two rows colliding on the key are BOTH kept — a genuine duplicate
    // provider+model row is itself worth seeing.
    const collision = buildMemoryBreakdown({
      models: [
        { runtime_id: null, provider: 'lmstudio', model: 'qwen', resident: true, size_bytes: 1 },
        { runtime_id: null, provider: 'lmstudio', model: 'qwen', resident: true, size_bytes: 2 },
      ],
    });
    expect(collision.items.filter((i) => i.key === 'model:lmstudio:qwen')).toHaveLength(2);
    expect(collision.references.find((r) => r.key === 'sum_model_weights')!.bytes).toBe(3);
  });

  it('labels the cache and process lines with what they measure', () => {
    const view = buildMemoryBreakdown(healthy);
    const byKey = Object.fromEntries(view.items.map((i) => [i.key, i]));
    expect(byKey.model_caches.name).toBe('model KV caches');
    expect(byKey.model_caches.bytes).toBe(50);
    expect(byKey.model_caches.detail).toBe('prompt-cache bytes held for resident models');
    expect(byKey.session_caches.name).toBe('session caches');
    expect(byKey.session_caches.bytes).toBe(60);
    expect(byKey.session_caches.detail).toBe('prompt-cache bytes held by gateway sessions');
    expect(byKey.process_rss.name).toBe('gateway process RSS');
    expect(byKey.process_rss.bytes).toBe(100);
    expect(byKey.process_rss.detail).toBe(
      'resident set size of the gateway process — includes memory-mapped GGUF weights'
    );
  });

  it('emits references separately and never sums them with the items', () => {
    const view = buildMemoryBreakdown(healthy);
    // No RAM block in this payload, so no `ram` reference.
    expect(view.references.map((r) => r.key)).toEqual(['sum_model_weights', 'accelerator']);
    expect(view.references[0].name).toBe('Σ model weights');
    expect(view.references[0].bytes).toBe(700);
    expect(view.references[0].detail).toBe('sum of the resident model weights above');
    expect(view.references[1].name).toBe('Accelerator heap · metal (all processes)');
    expect(view.references[1].bytes).toBe(1000);
    expect(view.references[1].valueText).toBe('1000 B / 1.2 KiB');
    expect(view.references[1].detail).toBe('memory-mapped GGUF weights are not counted here');
    // 700 <= 1000: the GGUF note does NOT fire here.
    expect(view.note).toBe('');
  });

  it('has NO remainder line, ever', () => {
    const view = buildMemoryBreakdown(healthy);
    expect(view).not.toHaveProperty('remainder');
    expect(view).not.toHaveProperty('attributedBytes');
    expect(view.items.some((i) => i.key.includes('nattributed'))).toBe(false);
    expect(JSON.stringify(view)).not.toContain('nattributed');
    expect(JSON.stringify(view)).not.toContain('remainder');
  });

  it('emits the GGUF note when the model weights exceed the accelerator heap', () => {
    const view = buildMemoryBreakdown({
      memory: { device: { host_in_use_bytes: 100 }, process: { rss_bytes: 900 } },
      models: [{ provider: 'p', model: 'm', resident: true, size_bytes: 900 }],
      session_caches: [],
    });
    expect(view.note).toBe(
      'Σ model weights exceeds the accelerator heap. That is the normal case for memory-mapped GGUF weights: llama.cpp maps them from disk, so they are resident as process RSS and are not counted in the accelerator heap.'
    );
  });

  it('emits a line whose value is KNOWN, including a known zero, and omits unknowns', () => {
    const view = buildMemoryBreakdown({
      memory: { device: { allocated_bytes: 0 }, process: { rss_bytes: 100 } },
      models: [],
      session_caches: [],
    });
    // No resident models and no cache rows => those lines are OMITTED, not 0.
    expect(view.items.map((i) => i.key)).toEqual(['process_rss']);
    // A known zero accelerator figure IS emitted, scoped to this process.
    expect(view.references.map((r) => r.key)).toEqual(['accelerator']);
    expect(view.references[0].name).toBe('Accelerator heap · device (this process only)');
    expect(view.references[0].bytes).toBe(0);
    expect(view.references[0].valueText).toBe('0 B');
    expect(view.note).toBe('');
  });

  it('never fabricates lines for degraded or junk snapshots', () => {
    const degraded = buildMemoryBreakdown({
      memory: { device: { host_in_use_bytes: 10 } },
      models: null,
      session_caches: null,
    });
    expect(degraded.items).toEqual([]);
    expect(degraded.references.map((r) => r.key)).toEqual(['accelerator']);
    expect(buildMemoryBreakdown(null).items).toEqual([]);
    expect(buildMemoryBreakdown(null).references).toEqual([]);
    expect(buildMemoryBreakdown({}).items).toEqual([]);
    expect(buildMemoryBreakdown({}).references).toEqual([]);
    expect(buildMemoryBreakdown({}).note).toBe('');
  });

  it('sums session cache rows when the totals block omits the byte figure', () => {
    const view = buildMemoryBreakdown({
      memory: { process: { rss_bytes: 1 } },
      session_caches: [{ bytes: 10 }, { bytes: 5 }, {}],
    });
    const caches = view.items.find((i) => i.key === 'session_caches')!;
    expect(caches.bytes).toBe(15);
    expect(caches.name).toBe('session caches');
  });

  it('prefers totals.cache_bytes_models, else sums the resident rows cache_bytes', () => {
    const summed = buildMemoryBreakdown({
      models: [
        { provider: 'p', model: 'a', resident: true, size_bytes: 1, cache_bytes: 7 },
        { provider: 'p', model: 'b', resident: true, size_bytes: 1, cache_bytes: 3 },
        { provider: 'p', model: 'c', resident: false, cache_bytes: 100 },
      ],
    });
    expect(summed.items.find((i) => i.key === 'model_caches')!.bytes).toBe(10);

    const reported = buildMemoryBreakdown({
      models: [{ provider: 'p', model: 'a', resident: true, size_bytes: 1, cache_bytes: 7 }],
      totals: { cache_bytes_models: 42 },
    });
    expect(reported.items.find((i) => i.key === 'model_caches')!.bytes).toBe(42);

    // No cache figure anywhere => the line is omitted, not zeroed.
    const absent = buildMemoryBreakdown({ models: [{ provider: 'p', model: 'a', resident: true, size_bytes: 1 }] });
    expect(absent.items.map((i) => i.key)).toEqual(['model:p:a']);
  });

  it('emits the RAM reference from ram.used_bytes, with the total when known', () => {
    const withTotal = buildMemoryBreakdown({ memory: { ram: { used_bytes: 600, total_bytes: 1000 } } });
    expect(withTotal.references.map((r) => r.key)).toEqual(['ram']);
    expect(withTotal.references[0].name).toBe('RAM used');
    expect(withTotal.references[0].detail).toBe('system memory in use / installed');
    expect(withTotal.references[0].valueText).toBe('600 B / 1000 B');

    const usedOnly = buildMemoryBreakdown({ memory: { ram: { used_bytes: 600 } } });
    expect(usedOnly.references[0].valueText).toBe('600 B');

    // No used_bytes => no RAM reference at all.
    expect(buildMemoryBreakdown({ memory: { ram: { total_bytes: 1000 } } }).references).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// PART C — the shared fixture. The LIVE payload from the operator's machine,
// pinning the whole breakdown rule set by KEY and BYTE VALUE (not by
// formatted string: the four surfaces format bytes differently).
// ---------------------------------------------------------------------------

describe('PART C shared fixture — the live GGUF payload', () => {
  const LIVE = {
    ok: true,
    memory: {
      ram: {
        total_bytes: 137438953472,
        available_bytes: 96368312320,
        used_bytes: 33741111296,
        percent: 29.9,
      },
      process: { rss_bytes: 76762775552 },
      device: {
        backend: 'metal',
        allocated_bytes: 0,
        total_bytes: 137438953472,
        free_bytes: null,
        host_in_use_bytes: 1042120704,
        wired_limit_bytes: 115343360000,
      },
    },
    models: [
      {
        runtime_id: 'local:text_generation:huggingface:unsloth/Qwen3.8-Flash-Next-GGUF:UD-Q3_K_XL',
        task: 'text_generation',
        provider: 'huggingface',
        model: 'unsloth/Qwen3.8-Flash-Next-GGUF:UD-Q3_K_XL',
        source: 'provider_server',
        resident: true,
        state: 'provider_loaded',
        locked: false,
        lockable: true,
        est_weights_bytes: 89986353824,
        cache_bytes: 2147483648,
        details: { est_weights_bytes: 89986353824, cache_bytes: 2147483648 },
      },
    ],
    totals: {
      models: 1,
      models_resident: 1,
      model_bytes: 89986353824,
      session_caches: 3,
      session_cache_bytes: 4352519172,
    },
  };

  const view = buildMemoryBreakdown(LIVE);

  it('1. emits exactly these item keys, in this order', () => {
    expect(view.items.map((i) => i.key)).toEqual([
      'model:local:text_generation:huggingface:unsloth/Qwen3.8-Flash-Next-GGUF:UD-Q3_K_XL',
      'model_caches',
      'session_caches',
      'process_rss',
    ]);
  });

  it('2. emits exactly these byte values, in this order', () => {
    expect(view.items.map((i) => i.bytes)).toEqual([89986353824, 2147483648, 4352519172, 76762775552]);
  });

  it('3. emits exactly these reference keys, in this order', () => {
    expect(view.references.map((r) => r.key)).toEqual(['sum_model_weights', 'ram', 'accelerator']);
  });

  it('4. sums the model weights to the single resident model', () => {
    expect(view.references.find((r) => r.key === 'sum_model_weights')!.bytes).toBe(89986353824);
  });

  it('5. names the accelerator reference with the PART A2 label and the GGUF caveat', () => {
    const accelerator = view.references.find((r) => r.key === 'accelerator')!;
    expect(accelerator.name).toContain('Accelerator heap · metal (all processes)');
    expect(accelerator.detail).toBe('memory-mapped GGUF weights are not counted here');
    expect(accelerator.bytes).toBe(1042120704);
  });

  it('6. emits the GGUF note, because 89986353824 > 1042120704', () => {
    expect(view.note).toBe(
      'Σ model weights exceeds the accelerator heap. That is the normal case for memory-mapped GGUF weights: llama.cpp maps them from disk, so they are resident as process RSS and are not counted in the accelerator heap.'
    );
  });

  it('7. contains the substring "nattributed" nowhere — the remainder is gone', () => {
    const strings = [
      ...view.items.flatMap((i) => [i.key, i.name, i.detail, i.bytesText]),
      ...view.references.flatMap((r) => [r.key, r.name, r.detail, r.valueText]),
      view.note,
      ...buildHostMemoryView(LIVE).meters.flatMap((m) => [m.label, m.title || '', m.note || '']),
    ];
    for (const value of strings) expect(value).not.toContain('nattributed');
  });

  it('8. contains "host-wide" in no name and no detail', () => {
    const strings = [
      ...view.items.flatMap((i) => [i.name, i.detail]),
      ...view.references.flatMap((r) => [r.name, r.detail]),
      view.note,
      ...buildHostMemoryView(LIVE).meters.flatMap((m) => [m.label, m.title || '', m.note || '']),
    ];
    for (const value of strings) {
      expect(value.toLowerCase()).not.toContain('host-wide');
    }
  });

  it('renders the accelerator meter under RAM, scoped and annotated', () => {
    const meters = buildHostMemoryView(LIVE).meters;
    expect(meters.map((m) => m.id)).toEqual(['ram', 'device']);
    expect(meters[1].label).toBe('Accelerator heap · metal (all processes)');
    expect(meters[1].note).toBe('memory-mapped GGUF weights are not counted here');
  });
});

// ---------------------------------------------------------------------------
// PART D — the one-liners
// ---------------------------------------------------------------------------

describe('PART D1 — adopt wording keys off source, not lockable', () => {
  it('adopts only when the host loaded the model outside the Gateway', () => {
    expect(rowLockAdopts({ source: 'provider_server', resident: true })).toBe(true);
    // The sweep stamps `lockable: true` on every row, so it can never be the
    // adopt selector.
    expect(rowLockAdopts({ source: 'provider_server', lockable: true, resident: true })).toBe(true);
    expect(rowLockAdopts({ source: 'gateway', lockable: true, resident: true })).toBe(false);
    expect(rowLockAdopts({ lockable: true, resident: true })).toBe(false);
    expect(rowLockAdopts({ source: null })).toBe(false);
    expect(rowLockAdopts({})).toBe(false);
  });

  it('leaves the lock GATE untouched', () => {
    // Adopt wording and the gate are independent decisions.
    expect(rowLockAction({ source: 'provider_server', resident: true, lockable: true })).toBe('lock');
    expect(rowLockAction({ source: 'provider_server', resident: true, lockable: false })).toBeNull();
    expect(rowLockAction({ source: 'gateway', resident: true })).toBe('lock');
  });
});

describe('PART D2 — the estimate marker is visible, not tooltip-only', () => {
  it('prefixes an estimated size with ~ and leaves a reported size bare', () => {
    expect(rowSizeCell({ est_weights_bytes: 2 * 1024 ** 3 }).text).toBe('~2.0 GiB');
    expect(rowSizeCell({ size_bytes: 2 * 1024 ** 3 }).text).toBe('2.0 GiB');
    expect(rowSizeCell({ size_vram_bytes: 2 * 1024 ** 3 }).text).toBe('2.0 GiB');
    // The cache figure is measured, so only the size half carries the marker.
    expect(rowSizeCell({ est_weights_bytes: 1024, cache_bytes: 2048 }).text).toBe('~1.0 KiB + 2.0 KiB cache');
    expect(rowSizeCell({ cache_bytes: 2048 }).text).toBe('2.0 KiB cache');
  });

  it('keeps the existing tooltip alongside the marker', () => {
    const estimated = rowSizeCell({ est_weights_bytes: 1024, cache_bytes: 2048 });
    expect(estimated.title).toContain('ESTIMATED');
    expect(estimated.title).toContain('est_weights_bytes');
    expect(estimated.title).toContain('prompt/KV cache');
    // The VRAM secondary figure is untouched by the marker change.
    expect(rowSizeCell({ size_bytes: 1024, size_vram_bytes: 512 }).title).toContain('VRAM');
  });
});
