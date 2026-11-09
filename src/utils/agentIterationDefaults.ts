// The editor's iteration budget for an Agent node the author has not set: the seed on a
// new node, the backfill for a legacy pin-less unwired node, the Properties field's
// fallback and the pin-disclosure default. Operator 2026-11-08: "by default, set it to 50
// everywhere" (the same number as abstractruntime DEFAULT_MAX_ITERATIONS). Every editor
// site reads this name; a value the author set (7, or a saved 20) is never rewritten.
export const AGENT_MAX_ITERATIONS_DEFAULT = 50;
