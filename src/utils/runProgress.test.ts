import { describe, expect, it } from 'vitest';
import { formatProgressSummary, progressDisplayPercent } from './runProgress';

describe('run progress display helpers', () => {
  it('renders generated media progress as denoise step progress when frame metadata is present', () => {
    const progress = {
      phase: 'denoise',
      frame: 20,
      total_frames: 81,
      step: 5,
      total_steps: 20,
      frame_progress: 20 / 81,
    };

    expect(formatProgressSummary(progress)).toBe('denoise · step 5/20');
    expect(progressDisplayPercent(progress, 'running')).toBe(25);
  });

  it('uses explicit step_progress before frame_progress', () => {
    const progress = {
      phase: 'denoise',
      frame: 20,
      total_frames: 81,
      step_progress: 0.25,
      frame_progress: 20 / 81,
    };

    expect(formatProgressSummary(progress)).toBe('denoise · frame 20/81');
    expect(progressDisplayPercent(progress, 'running')).toBe(25);
  });

  it('falls back to frame counts only when step counts are absent', () => {
    const progress = {
      phase: 'encode',
      frame: 20,
      total_frames: 80,
    };

    expect(formatProgressSummary(progress)).toBe('encode · frame 20/80');
    expect(progressDisplayPercent(progress, 'running')).toBe(25);
  });
});
