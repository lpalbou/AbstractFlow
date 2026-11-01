/**
 * Decision node (`decide`) typed output pins.
 *
 * One Decision node asks ONE question about ONE state; the question type
 * (`choice` | `noul` | `score`) decides which typed outputs exist, and the
 * option names / level labels give those pins their JSON Schema (`enum`,
 * probability keys), so Break Object and Switch "Sync cases from enum" work
 * straight off the pins. The editor rewrites the outputs whenever the type,
 * options or levels change (like Switch cases) and re-derives them on load.
 * Pure: values in, pins out.
 */
import type { FlowNodeData, Pin } from '../types/flow';

export const DECISION_QUESTION_TYPES = ['choice', 'noul', 'score'] as const;
export type DecisionQuestionType = (typeof DECISION_QUESTION_TYPES)[number];

export const DECISION_QUESTION_TYPE_LABELS: Record<DecisionQuestionType, string> = {
  choice: 'Choice (one of the options)',
  noul: 'Yes / no (probability)',
  score: 'Score (ordered levels)',
};

/** The short labels of the on-card `question_type` select. */
export const DECISION_QUESTION_TYPE_SHORT_LABELS: Record<DecisionQuestionType, string> = {
  choice: 'Choice',
  noul: 'Yes-no (noul)',
  score: 'Score',
};

/**
 * The `question_type` input pin's schema: an enum (so the card renders a select,
 * utils/jsonSchemaEditor.ts pinEnumOptions) whose members are titled through
 * `oneOf` `{const, title}`.
 */
export const DECISION_QUESTION_TYPE_SCHEMA: Record<string, unknown> = {
  type: 'string',
  enum: [...DECISION_QUESTION_TYPES],
  oneOf: DECISION_QUESTION_TYPES.map((type) => ({ const: type, title: DECISION_QUESTION_TYPE_SHORT_LABELS[type] })),
};

/** `choice` unless the value names another known type. */
export function normalizeDecisionQuestionType(value: unknown): DecisionQuestionType {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return (DECISION_QUESTION_TYPES as readonly string[]).includes(raw) ? (raw as DecisionQuestionType) : 'choice';
}

/** Option names from `["a","b"]` or `{a: "description", b: "..."}`; blanks dropped, order kept. */
export function decisionOptionNames(value: unknown): string[] {
  const names: string[] = [];
  const push = (name: unknown) => {
    const clean = typeof name === 'string' ? name.trim() : '';
    if (clean && !names.includes(clean)) names.push(clean);
  };
  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === 'string') push(item);
      else if (item && typeof item === 'object') push((item as Record<string, unknown>).name);
    }
  } else if (value && typeof value === 'object') {
    for (const key of Object.keys(value as Record<string, unknown>)) push(key);
  }
  return names;
}

/** Ordered level labels (lowest first) from a string list; blanks dropped. */
export function decisionLevels(value: unknown): string[] {
  return decisionOptionNames(Array.isArray(value) ? value : []);
}

function numberProperties(keys: string[]): Record<string, unknown> {
  return Object.fromEntries(keys.map((key) => [key, { type: 'number' }]));
}

function enumSchema(values: string[]): Record<string, unknown> {
  return values.length > 0 ? { type: 'string', enum: values } : { type: 'string' };
}

/** The `answer` object schema (what the runtime fills, and what Break Object splits). */
export function decisionAnswerSchema(type: DecisionQuestionType, options: string[], levels: string[]): Record<string, unknown> {
  if (type === 'noul') {
    return { type: 'object', properties: { type: { const: 'noul' }, noul: { type: 'number' } } };
  }
  if (type === 'score') {
    return {
      type: 'object',
      properties: {
        type: { const: 'score' },
        score: { type: 'number' },
        confidence: { type: 'number' },
        legend: { type: 'object', properties: Object.fromEntries(levels.map((label, index) => [String(index), { const: label }])) },
        probabilities: { type: 'object', properties: numberProperties(levels.map((_, index) => String(index))) },
      },
    };
  }
  return {
    type: 'object',
    properties: {
      type: { const: 'choice' },
      choice: enumSchema(options),
      confidence: { type: 'number' },
      probabilities: { type: 'object', properties: numberProperties(options) },
    },
  };
}

/** The output pins of a Decision node for one question type: exec-out, the typed pins, then the common pins. */
export function decisionOutputPins(type: DecisionQuestionType, options: string[] = [], levels: string[] = []): Pin[] {
  const typed: Pin[] =
    type === 'noul'
      ? [
          { id: 'noul', label: 'noul', type: 'number', description: 'Probability that the answer is yes/true (0..1).' },
          { id: 'verdict', label: 'verdict', type: 'boolean', description: 'True when noul ≥ 0.5.' },
        ]
      : type === 'score'
        ? [
            { id: 'score', label: 'score', type: 'number', description: 'Expected level index (0 = the first level), a decimal between levels.' },
            {
              id: 'level',
              label: 'level',
              type: 'string',
              description: 'The level label nearest the score.',
              schema: enumSchema(levels),
            },
            { id: 'confidence', label: 'confidence', type: 'number', description: 'Confidence in the level (0..1).' },
            {
              id: 'probabilities',
              label: 'probabilities',
              type: 'object',
              description: 'Probability per level, keyed by level index ("0", "1", …).',
              schema: { type: 'object', properties: numberProperties(levels.map((_, index) => String(index))) },
            },
          ]
        : [
            { id: 'choice', label: 'choice', type: 'string', description: 'The chosen option name.', schema: enumSchema(options) },
            { id: 'confidence', label: 'confidence', type: 'number', description: 'Confidence in the choice (0..1).' },
            {
              id: 'probabilities',
              label: 'probabilities',
              type: 'object',
              description: 'Probability per option, keyed by option name.',
              schema: { type: 'object', properties: numberProperties(options) },
            },
          ];
  return [
    { id: 'exec-out', label: '', type: 'execution' },
    ...typed,
    {
      id: 'answer',
      label: 'answer',
      type: 'object',
      description: 'The whole typed answer as one object (type, the typed fields, probabilities). Break Object splits it.',
      schema: decisionAnswerSchema(type, options, levels),
    },
    { id: 'model', label: 'model', type: 'string', description: 'The provider/model that answered.' },
    { id: 'success', label: 'success', type: 'boolean', description: 'True when an answer exists.' },
    {
      id: 'answers',
      label: 'answers',
      type: 'object',
      description: 'Advanced form: every answer keyed by question name (the single form keys its one answer "answer").',
    },
    { id: 'meta', label: 'meta', type: 'object', description: 'Execution metadata (schema, modality, provider/model, token usage).' },
  ];
}

/** The outputs a Decision node should have, read from its pin defaults (question_type, options, levels). */
export function decisionOutputPinsForData(data: Pick<FlowNodeData, 'pinDefaults'>): Pin[] {
  const defaults = (data.pinDefaults || {}) as Record<string, unknown>;
  return decisionOutputPins(
    normalizeDecisionQuestionType(defaults.question_type),
    decisionOptionNames(defaults.options),
    decisionLevels(defaults.levels)
  );
}

/** A Decision node's data with its outputs re-derived from its pin defaults (load migration; a no-op for other nodes). */
export function withDecisionOutputs<T extends Pick<FlowNodeData, 'nodeType' | 'pinDefaults' | 'outputs'>>(data: T): T {
  if (data.nodeType !== 'decide') return data;
  return { ...data, outputs: decisionOutputPinsForData(data) };
}

/**
 * The options pin default after the Properties panel edited its rows: a `{name: description}`
 * object keeps the descriptions of the rows it still has (by position, so renaming a row keeps
 * its description); a plain list stays a list. Blank rows stay while they are being typed.
 */
export function mergeDecisionOptionRows(previous: unknown, rows: string[]): unknown {
  if (rows.length === 0) return undefined;
  if (previous && typeof previous === 'object' && !Array.isArray(previous)) {
    const entries = Object.entries(previous as Record<string, unknown>);
    const merged: Record<string, unknown> = {};
    rows.forEach((name, index) => {
      const description = index < entries.length ? entries[index][1] : null;
      merged[name] = description ?? null;
    });
    return merged;
  }
  return rows;
}
