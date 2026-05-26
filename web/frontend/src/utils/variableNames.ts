const VARIABLE_SEGMENT_RE = /^[A-Za-z][A-Za-z0-9_]*$/;

export function normalizeVariableName(value: unknown): string {
  return String(value ?? '').trim();
}

export function validateVariableName(value: unknown): string | null {
  const name = normalizeVariableName(value);
  if (!name) return 'Enter a variable name.';
  if (name.startsWith('_')) return 'Names starting with "_" are reserved.';
  if (name.startsWith('.') || name.endsWith('.') || name.includes('..')) {
    return 'Use dotted identifier paths like state.user_name.';
  }
  const segments = name.split('.');
  if (!segments.every((segment) => VARIABLE_SEGMENT_RE.test(segment))) {
    return 'Use letters, numbers, underscores, and dotted paths.';
  }
  return null;
}

export function variableNameCustomOptionLabel(value: string): string {
  return `Create variable "${value}"`;
}
