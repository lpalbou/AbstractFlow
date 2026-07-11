export type ThinkingOption = {
  value: string;
  label: string;
};

export const DEFAULT_THINKING_OPTIONS: ThinkingOption[] = [
  { value: '', label: 'Auto (Gateway default)' },
  { value: 'off', label: 'off' },
  { value: 'low', label: 'low' },
  { value: 'medium', label: 'medium' },
  { value: 'high', label: 'high' },
  { value: 'xhigh', label: 'xhigh' },
];

const THINKING_MODEL_PATTERNS = [
  /\bo[134](?:[-.]|$)/i,
  /\bgpt[-_.]?5/i,
  /\bgpt[-_.]?oss/i,
  /\bclaude.*(?:4|opus|sonnet|haiku)/i,
  /\bdeepseek.*(?:r1|v4)/i,
  /\bqwen3\b/i,
  /\bqwen3[.-]/i,
  /\bthinking\b/i,
  /\breasoning\b/i,
  /\bseed[-_.]?oss\b/i,
];

function stringListFrom(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    const text = typeof item === 'string' ? item.trim() : '';
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
  }
  return out;
}

function recordFrom(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

export function modelNameLooksThinkingCapable(modelName: string): boolean {
  const clean = String(modelName || '').trim();
  if (!clean) return false;
  return THINKING_MODEL_PATTERNS.some((pattern) => pattern.test(clean));
}

export function thinkingOptionsFromModelCapabilities(payload: unknown, modelName: string): ThinkingOption[] {
  const response = recordFrom(payload);
  const caps = recordFrom(response?.capabilities) || response;
  const levels = stringListFrom(caps?.reasoning_levels || caps?.thinking_levels);
  const support =
    caps?.thinking_support === true ||
    caps?.thinking_budget === true ||
    typeof caps?.thinking_control_mode === 'string' ||
    levels.length > 0;

  if (levels.length > 0) {
    return [
      { value: '', label: 'Auto (Gateway default)' },
      ...levels.map((value) => ({ value, label: value })),
    ];
  }

  if (support || modelNameLooksThinkingCapable(modelName)) return DEFAULT_THINKING_OPTIONS;
  return [];
}
