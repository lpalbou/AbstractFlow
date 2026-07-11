/**
 * $act_only act-frame references (visit seam-spec, a2a thread 0013, frozen).
 *
 * Act-only tools (diary-class, G1: "the book's words never rest outside the
 * book") put a typed REFERENCE — never the words — on every durable surface:
 *
 *   {"$act_only": {"tool": "diary_read", "entry_id": "diary_…",
 *                  "reason": "…", "gist": "<one line>"}}
 *
 * The ref rides tool-message CONTENT as exact JSON with a LONE top-level key
 * (detection is parse, never regex — the spec's contract), so clients may see
 * it either as a JSON string (message content) or as a decoded object
 * (ledger step results). Flow renders these as act-frame chips; it never
 * resolves them (rendering is a pure read — resolution happens only at the
 * provider boundary, runtime-side).
 */

export interface ActOnlyRef {
  tool: string;
  entry_id?: string;
  reason?: string;
  gist?: string;
}

const MAX_SCAN_DEPTH = 6;
const MAX_REFS = 24;
const MAX_PARSE_LENGTH = 20_000;

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function refFromFrame(frame: unknown): ActOnlyRef | null {
  if (!frame || typeof frame !== 'object' || Array.isArray(frame)) return null;
  const record = frame as Record<string, unknown>;
  const tool = cleanString(record.tool);
  if (!tool) return null;
  return {
    tool,
    entry_id: cleanString(record.entry_id) || undefined,
    reason: cleanString(record.reason) || undefined,
    gist: cleanString(record.gist) || undefined,
  };
}

/**
 * Recognize a single act-only ref: an object whose LONE top-level key is
 * `$act_only` (the frozen detection contract), or a JSON string decoding to
 * exactly that shape.
 */
export function parseActOnlyRef(value: unknown): ActOnlyRef | null {
  if (typeof value === 'string') {
    const text = value.trim();
    // Cheap gate before parsing: the ref is small, exact JSON.
    if (!text || text.length > MAX_PARSE_LENGTH || !text.startsWith('{') || !text.includes('$act_only')) return null;
    try {
      return parseActOnlyRef(JSON.parse(text));
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== 1 || keys[0] !== '$act_only') return null;
  return refFromFrame(record.$act_only);
}

/**
 * Collect act-only refs anywhere inside a step output / message list
 * (bounded depth and count — render affordance, not an audit).
 */
export function collectActOnlyRefs(value: unknown, depth = 0, out: ActOnlyRef[] = []): ActOnlyRef[] {
  if (out.length >= MAX_REFS || depth > MAX_SCAN_DEPTH) return out;
  const direct = parseActOnlyRef(value);
  if (direct) {
    out.push(direct);
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectActOnlyRefs(item, depth + 1, out);
      if (out.length >= MAX_REFS) break;
    }
    return out;
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value as Record<string, unknown>)) {
      collectActOnlyRefs(item, depth + 1, out);
      if (out.length >= MAX_REFS) break;
    }
  }
  return out;
}

/** One-line chip label: what happened, without the words. */
export function actOnlyRefLabel(ref: ActOnlyRef): string {
  const parts = [ref.tool];
  if (ref.entry_id) parts.push(ref.entry_id);
  return parts.join(' · ');
}
