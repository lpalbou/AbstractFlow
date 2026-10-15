/**
 * One line that says what a tool call asks for, for a collapsed approval row:
 * `query="AI news October 11", num_results=10, safe_search="moderate", …`.
 * Strings are quoted, objects and arrays are shown as `{…}` / `[…]`, and the
 * line stops (with "…") once it is long enough to read at a glance.
 */
const MAX_VALUE = 48;
const MAX_LINE = 140;

function valueText(value: unknown): string {
  if (typeof value === 'string') return `"${value.length > MAX_VALUE ? `${value.slice(0, MAX_VALUE - 1)}…` : value}"`;
  if (Array.isArray(value)) return value.length ? '[…]' : '[]';
  if (value && typeof value === 'object') return Object.keys(value).length ? '{…}' : '{}';
  return String(value);
}

export function toolCallPreview(args: unknown): string {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return args === undefined ? '' : valueText(args);
  let line = '';
  for (const [key, value] of Object.entries(args as Record<string, unknown>)) {
    const part = `${key}=${valueText(value)}`;
    const next = line ? `${line}, ${part}` : part;
    if (next.length > MAX_LINE) return line ? `${line}, …` : `${next.slice(0, MAX_LINE - 1)}…`;
    line = next;
  }
  return line;
}
