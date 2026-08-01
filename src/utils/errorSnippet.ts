/**
 * One readable line out of an arbitrary error payload.
 *
 * The run-failure toast used to take `JSON.stringify(err, null, 2)` and show
 * its FIRST non-empty line. For every object-shaped error — which is what the
 * gateway actually returns — that line is literally `{`, so the toast read
 * "Workflow failed / {" and the whole diagnostic was unreachable without
 * clicking to copy. This picks the message a human wants instead.
 */

/** Keys that carry a human-readable message, in the order we prefer them. */
const MESSAGE_KEYS = [
  'detail',
  'message',
  // FastAPI's own validation shape, and the gateway is FastAPI: a 422 is
  // `{detail:[{type,loc,msg,input}]}` — LIVE-captured. Without `msg` none of
  // the keys above match, so every validation failure fell through to the
  // compact-JSON branch and the toast showed the raw payload.
  'msg',
  'error',
  'error_message',
  'reason',
  // A completed-but-unsuccessful run carries `error: null` and puts the human
  // sentence in the flow's own result — `{type:'flow_complete', success:false,
  // error:null, result:{response:'…'}}`. Without these the snippet fell through
  // to the compact-JSON branch and showed machinery instead of the outcome.
  'stopped_reason',
  'response',
  'report',
  'title',
  'description',
] as const;

/** Keys that name WHERE it failed, appended as context when present. */
const LOCATION_KEYS = ['node', 'node_id', 'nodeId', 'node_label', 'pin', 'step'] as const;

const MAX_LEN = 180;

function clamp(text: string): string {
  const one = text.replace(/\s+/g, ' ').trim();
  return one.length > MAX_LEN ? `${one.slice(0, MAX_LEN - 1)}…` : one;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Pull the most specific message out of a nested payload. Gateway errors nest
 * (`{detail: {error: "...", node: "builder"}}`), so recurse into a message key
 * whose value is itself an object rather than stringifying it.
 */
function deepMessage(value: unknown, depth = 0): string | null {
  if (depth > 5) return null;
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = deepMessage(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (!isRecord(value)) return null;
  for (const key of MESSAGE_KEYS) {
    if (!(key in value)) continue;
    const found = deepMessage(value[key], depth + 1);
    if (found) return found;
  }
  // `result` is a carrier, not a message: recurse into it so a completed run's
  // outcome sentence is found, but only after the real message keys have missed.
  const carrier = value.result ?? value.output;
  if (carrier !== undefined) {
    const found = deepMessage(carrier, depth + 1);
    if (found) return found;
  }
  return null;
}

function locationOf(value: unknown): string | null {
  if (!isRecord(value)) return null;
  for (const key of LOCATION_KEYS) {
    const raw = value[key];
    if (typeof raw === 'string' && raw.trim()) return raw.trim();
  }
  // One level down: `{detail: {node: "..."}}`
  for (const key of MESSAGE_KEYS) {
    const nested = value[key];
    if (isRecord(nested)) {
      const found = locationOf(nested);
      if (found) return found;
    }
  }
  return null;
}

/**
 * @param error   the raw error value (string, Error, or parsed JSON payload)
 * @param fallback the already-formatted full text, used when nothing better exists
 */
export function errorSnippet(error: unknown, fallback: string): string {
  if (error instanceof Error) {
    return clamp(error.message || fallback);
  }
  if (typeof error === 'string') {
    const firstLine = error.split('\n').find((l) => l.trim());
    return clamp(firstLine || error);
  }

  const message = deepMessage(error);
  if (message) {
    const where = locationOf(error);
    // Only add the location when the message does not already name it.
    return clamp(where && !message.includes(where) ? `${message} (at ${where})` : message);
  }

  // No recognizable message key: show COMPACT json rather than the first line
  // of pretty-printed json, which is always a lone brace.
  try {
    const compact = JSON.stringify(error);
    if (compact && compact !== '{}' && compact !== 'null') return clamp(compact);
  } catch {
    /* fall through to the formatted fallback */
  }
  const STRUCTURAL = new Set(['{', '}', '[', ']', '{}', '[]', 'null']);
  const firstMeaningful = fallback
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l && !STRUCTURAL.has(l));
  return clamp(firstMeaningful || 'Unknown error');
}
