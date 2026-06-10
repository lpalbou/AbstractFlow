import { describe, expect, it } from 'vitest';
import { extractRunWorkspaceRoot, fileUrlFromWorkspacePath, selectRunWorkspaceRunId } from './runWorkspace';

describe('run workspace helpers', () => {
  it('prefers gateway workspace defaults over raw input data', () => {
    expect(
      extractRunWorkspaceRoot({
        workspace: { workspace_root: '/gateway/run-space' },
        input_data: { workspace_root: '/user/requested-space' },
      })
    ).toBe('/gateway/run-space');
  });

  it('falls back to input_data workspace root', () => {
    expect(extractRunWorkspaceRoot({ input_data: { workspace_root: '/from/input-data' } })).toBe('/from/input-data');
  });

  it('falls back to top-level workspace root', () => {
    expect(extractRunWorkspaceRoot({ workspace_root: '/top-level' })).toBe('/top-level');
  });

  it('ignores blank and non-string path values', () => {
    expect(
      extractRunWorkspaceRoot(
        { workspace: { workspace_root: '   ' } },
        { input_data: { workspace_root: { path: '/not-a-string' } } },
        { workspace_root: ['/not-a-string'] }
      )
    ).toBe('');
  });

  it('creates file URLs only for absolute local paths', () => {
    expect(fileUrlFromWorkspacePath('/Users/albou/run space')).toBe('file:///Users/albou/run%20space');
    expect(fileUrlFromWorkspacePath('relative/run')).toBe('');
  });

  it('uses the reloaded run summary id before event-derived fallback ids', () => {
    expect(selectRunWorkspaceRunId({ run_id: 'selected-root-run' }, 'event-child-run')).toBe('selected-root-run');
    expect(selectRunWorkspaceRunId(null, 'event-root-run')).toBe('event-root-run');
  });
});
