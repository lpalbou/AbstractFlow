function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function pickStringPath(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function workspaceRootFromRecord(record: Record<string, unknown>): string {
  const workspace = isRecord(record.workspace) ? record.workspace : null;
  const fromWorkspace =
    pickStringPath(workspace?.workspace_root) ||
    pickStringPath(workspace?.workspaceRoot) ||
    pickStringPath(workspace?.root) ||
    pickStringPath(workspace?.path);
  if (fromWorkspace) return fromWorkspace;

  const inputData = isRecord(record.input_data) ? record.input_data : isRecord(record.inputData) ? record.inputData : null;
  const fromInput = pickStringPath(inputData?.workspace_root) || pickStringPath(inputData?.workspaceRoot);
  if (fromInput) return fromInput;

  return pickStringPath(record.workspace_root) || pickStringPath(record.workspaceRoot);
}

export function extractRunWorkspaceRoot(...sources: unknown[]): string {
  for (const source of sources) {
    if (!isRecord(source)) continue;
    const root = workspaceRootFromRecord(source);
    if (root) return root;
  }
  return '';
}

export function selectRunWorkspaceRunId(runSummary: unknown, ...fallbackRunIds: unknown[]): string {
  const fromSummary = isRecord(runSummary) ? pickStringPath(runSummary.run_id) : '';
  if (fromSummary) return fromSummary;
  for (const fallback of fallbackRunIds) {
    const runId = pickStringPath(fallback);
    if (runId) return runId;
  }
  return '';
}

export function fileUrlFromWorkspacePath(path: string): string {
  const trimmed = String(path || '').trim();
  if (!trimmed || /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return '';
  if (!trimmed.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(trimmed)) return '';
  const normalized = trimmed.replace(/\\/g, '/');
  const withLeadingSlash = /^[A-Za-z]:\//.test(normalized) ? `/${normalized}` : normalized;
  return `file://${encodeURI(withLeadingSlash)}`;
}
