import type { FlowNodeData, NodeType, Pin } from '../types/flow';
import { createNodeData, getNodeTemplate } from '../types/nodes';
import { hasStructuredResponseSchema, isStructuredResponseDataPin } from './structuredOutputs';

export type PinDisclosureDirection = 'input' | 'output';

export type PinLike = {
  id: string;
  type?: string;
};

export type PinValueMap = Record<string, unknown>;

export type PinDisclosureClass = 'primary' | 'advanced' | 'default' | 'diagnostic' | 'unmanaged';

export type PinDisclosureReason =
  | 'execution'
  | 'connected'
  | 'configured'
  | 'primary'
  | 'expanded'
  | 'unsupported'
  | 'compact-hidden'
  | 'unmanaged';

type NodeDisclosurePolicy = {
  primaryInputs?: string[];
  primaryOutputs?: string[];
  advancedInputs?: string[];
  advancedOutputs?: string[];
  defaultInputs?: string[];
  defaultOutputs?: string[];
  diagnosticOutputs?: string[];
  compactInputs?: boolean;
  compactOutputs?: boolean;
};

export type ThinkingSupportHint = {
  supported?: boolean | null;
};

export type PinDisclosureDecision = {
  pinId: string;
  direction: PinDisclosureDirection;
  visible: boolean;
  className: PinDisclosureClass;
  reason: PinDisclosureReason;
};

export type DirectionalNodePinDisclosureResult<TPin extends PinLike = Pin> = {
  visiblePins: TPin[];
  hiddenPins: TPin[];
  hiddenCount: number;
  expandable: boolean;
  decisions: PinDisclosureDecision[];
};

export type NodePinDisclosureResult = {
  inputPins: Pin[];
  outputPins: Pin[];
  hiddenInputPins: Pin[];
  hiddenOutputPins: Pin[];
  hiddenInputCount: number;
  hiddenOutputCount: number;
  hiddenCount: number;
  expandable: boolean;
  inputDecisions: PinDisclosureDecision[];
  outputDecisions: PinDisclosureDecision[];
};

const MEDIA_DIAGNOSTIC_OUTPUTS = ['artifact_ref', 'artifact_id', 'content_type', 'outputs', 'meta', 'success'];
const MEDIA_NODE_TYPES = new Set<string>([
  'generate_image',
  'edit_image',
  'image_to_image',
  'upscale_image',
  'generate_video',
  'text_to_video',
  'image_to_video',
  'generate_voice',
  'generate_music',
  'transcribe_audio',
  'listen_voice',
]);

const CONFIG_PIN_ALIASES: Record<string, string[]> = {
  allowed_models: ['allowedModels'],
  allowed_providers: ['allowedProviders'],
  capability_route: ['capabilityRoute'],
  session_id: ['sessionId'],
  use_context: ['include_context'],
};

const VIDEO_DEFAULT_PIN_VALUES = {
  format: 'mp4',
  width: 512,
  height: 512,
  frames: 41,
  fps: 24,
  steps: 20,
  guidance_scale: 5.0,
  guidance: 5.0,
};

const DEFAULT_PIN_VALUES_BY_NODE_TYPE: Record<string, PinValueMap> = {
  agent: {
    use_context: false,
    max_iterations: 50,
  },
  llm_call: {
    use_context: false,
  },
  subflow: {
    inherit_context: false,
  },
  model_residency: {
    operation: 'load',
    task: 'text_generation',
  },
  generate_image: {
    format: 'png',
    steps: 20,
  },
  edit_image: {
    format: 'png',
    steps: 20,
  },
  image_to_image: {
    format: 'png',
    steps: 20,
  },
  upscale_image: {
    format: 'png',
    resolution: '2x',
    softness: 0.25,
  },
  generate_video: VIDEO_DEFAULT_PIN_VALUES,
  text_to_video: VIDEO_DEFAULT_PIN_VALUES,
  image_to_video: VIDEO_DEFAULT_PIN_VALUES,
  generate_voice: {
    format: 'wav',
    quality_preset: 'standard',
    speed: 1.0,
  },
  generate_music: {
    format: 'wav',
  },
  transcribe_audio: {
    format: 'json',
    temperature: 0,
  },
  listen_voice: {
    max_duration_s: 30,
  },
  code: {
    permissions: 'sandbox',
  },
  for: {
    step: 1,
  },
  compare: {
    op: '==',
  },
  replace: {
    mode: 'all',
  },
  stringify_json: {
    mode: 'beautify',
  },
  memory_note: {
    keep_in_context: false,
    scope: 'run',
  },
  memory_query: {
    scope: 'run',
    recall_level: 'standard',
    limit: 5,
    tags_mode: 'all',
  },
  memory_tag: {
    scope: 'run',
    merge: true,
  },
  memory_compact: {
    preserve_recent: 6,
    compression_mode: 'standard',
  },
  memory_rehydrate: {
    placement: 'after_summary',
    recall_level: 'standard',
  },
  memory_kg_query: {
    scope: 'run',
    recall_level: 'standard',
    limit: 100,
  },
  memory_kg_resolve: {
    scope: 'run',
    recall_level: 'standard',
  },
  memory_kg_assert: {
    scope: 'run',
    allow_custom_predicates: false,
  },
  memact_compose: {
    marker: 'KG:',
  },
  emit_event: {
    name: 'my_event',
    scope: 'session',
    session_id: '',
  },
  on_event: {
    scope: 'session',
  },
  on_schedule: {
    schedule: '15s',
    recurrent: true,
  },
  provider_models: {
    provider: '',
    capability_route: 'output.text',
  },
};

const GENERATION_TUNING_INPUTS = [
  'width',
  'height',
  'frames',
  'fps',
  'format',
  'seed',
  'seeds',
  'count',
  'steps',
  'num_inference_steps',
  'guidance_scale',
  'guidance_2',
  'flow_shift',
  'strength',
  'scale',
  'resolution',
  'softness',
  'quantize',
  'vae_tiling',
  'lora_adapters',
  'negative_prompt',
  'extra',
  'quality_preset',
  'speed',
  'profile',
  'instructions',
  'lyrics',
  'duration_s',
  'instrumental',
  'enhance_prompt',
  'structure_prompt',
  'auto_lyrics',
  'text_planner_mode',
  'vocal_language',
  'sample_rate',
  'bpm',
  'keyscale',
  'timesignature',
  'composition_plan',
  'positive_styles',
  'negative_styles',
  'planning',
];

const PROVIDER_MODEL_INPUTS = [
  'provider',
  'model',
  'image_provider',
  'image_model',
  'video_provider',
  'video_model',
  'tts_provider',
  'tts_model',
  'stt_provider',
  'stt_model',
  'music_provider',
  'music_model',
];

const LLM_AGENT_ADVANCED_INPUTS = [
  'use_context',
  'context',
  'memory',
  'provider',
  'model',
  'tools',
  'prompt_cache_binding',
  'max_iterations',
  'max_in_tokens',
  'temperature',
  'seed',
  'thinking',
  'resp_schema',
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

const MEMORY_SCOPE_INPUTS = [
  'scope',
  'recall_level',
  'limit',
  'tags',
  'tags_mode',
  'usernames',
  'locations',
  'since',
  'until',
  'active_at',
  'owner_id',
  'min_score',
  'max_input_tokens',
  'model',
  'max_candidates',
  'include_semantic',
  'placement',
  'max_messages',
  'preserve_recent',
  'compression_mode',
  'focus',
  'merge',
  'attributes_defaults',
  'allow_custom_predicates',
  'stimulus',
  'marker',
  'max_items',
  'keep_in_context',
  'location',
  'sources',
];

const POLICY_BY_NODE_TYPE: Partial<Record<NodeType, NodeDisclosurePolicy>> = {
  agent: {
    compactInputs: true,
    compactOutputs: true,
    primaryInputs: ['system', 'prompt', 'tools'],
    primaryOutputs: ['response'],
    advancedOutputs: ['data'],
    advancedInputs: LLM_AGENT_ADVANCED_INPUTS,
    diagnosticOutputs: ['success', 'meta', 'scratchpad', 'tool_calls', 'tool_results', 'result'],
  },
  llm_call: {
    compactInputs: true,
    compactOutputs: true,
    primaryInputs: ['system', 'prompt'],
    primaryOutputs: ['response'],
    advancedOutputs: ['data'],
    advancedInputs: LLM_AGENT_ADVANCED_INPUTS.filter((pin) => pin !== 'max_iterations'),
    diagnosticOutputs: ['success', 'meta', 'tool_calls', 'result', 'raw', 'gen_time', 'ttft_ms'],
  },
  subflow: {
    compactInputs: true,
    primaryInputs: ['input'],
    advancedInputs: ['inherit_context', ...PROVIDER_MODEL_INPUTS, 'tools', 'scope', 'query', 'query_text'],
  },
  model_residency: {
    compactInputs: true,
    compactOutputs: true,
    primaryInputs: ['operation', 'task'],
    primaryOutputs: ['success', 'affected_models', 'models'],
    advancedInputs: ['provider', 'model', 'runtime_id', 'base_url', 'timeout_s', 'provider_api_key', 'options', 'pin', 'required'],
    diagnosticOutputs: ['error', 'warnings', 'result'],
  },
  generate_image: {
    compactInputs: true,
    compactOutputs: true,
    primaryInputs: ['prompt'],
    primaryOutputs: ['image_artifact'],
    advancedOutputs: ['image_artifacts'],
    advancedInputs: [...PROVIDER_MODEL_INPUTS, ...GENERATION_TUNING_INPUTS],
    diagnosticOutputs: MEDIA_DIAGNOSTIC_OUTPUTS,
  },
  edit_image: {
    compactInputs: true,
    compactOutputs: true,
    primaryInputs: ['prompt', 'image_artifact'],
    primaryOutputs: ['image_artifact'],
    advancedOutputs: ['image_artifacts'],
    advancedInputs: ['mask_artifact', ...PROVIDER_MODEL_INPUTS, ...GENERATION_TUNING_INPUTS],
    diagnosticOutputs: MEDIA_DIAGNOSTIC_OUTPUTS,
  },
  image_to_image: {
    compactInputs: true,
    compactOutputs: true,
    primaryInputs: ['prompt', 'source_image'],
    primaryOutputs: ['image_artifact'],
    advancedOutputs: ['image_artifacts'],
    advancedInputs: ['mask_artifact', ...PROVIDER_MODEL_INPUTS, ...GENERATION_TUNING_INPUTS],
    diagnosticOutputs: MEDIA_DIAGNOSTIC_OUTPUTS,
  },
  upscale_image: {
    compactInputs: true,
    compactOutputs: true,
    primaryInputs: ['image_artifact'],
    primaryOutputs: ['image_artifact'],
    advancedInputs: [...PROVIDER_MODEL_INPUTS, ...GENERATION_TUNING_INPUTS],
    diagnosticOutputs: MEDIA_DIAGNOSTIC_OUTPUTS,
  },
  generate_video: {
    compactInputs: true,
    compactOutputs: true,
    primaryInputs: ['prompt'],
    primaryOutputs: ['video_artifact'],
    advancedOutputs: ['video_artifacts'],
    advancedInputs: [...PROVIDER_MODEL_INPUTS, ...GENERATION_TUNING_INPUTS],
    diagnosticOutputs: MEDIA_DIAGNOSTIC_OUTPUTS,
  },
  text_to_video: {
    compactInputs: true,
    compactOutputs: true,
    primaryInputs: ['prompt'],
    primaryOutputs: ['video_artifact'],
    advancedOutputs: ['video_artifacts'],
    advancedInputs: [...PROVIDER_MODEL_INPUTS, ...GENERATION_TUNING_INPUTS],
    diagnosticOutputs: MEDIA_DIAGNOSTIC_OUTPUTS,
  },
  image_to_video: {
    compactInputs: true,
    compactOutputs: true,
    primaryInputs: ['prompt', 'source_image'],
    primaryOutputs: ['video_artifact'],
    advancedOutputs: ['video_artifacts'],
    advancedInputs: [...PROVIDER_MODEL_INPUTS, ...GENERATION_TUNING_INPUTS],
    diagnosticOutputs: MEDIA_DIAGNOSTIC_OUTPUTS,
  },
  generate_voice: {
    compactInputs: true,
    compactOutputs: true,
    primaryInputs: ['text'],
    primaryOutputs: ['audio_artifact'],
    advancedInputs: [...PROVIDER_MODEL_INPUTS, 'voice', ...GENERATION_TUNING_INPUTS],
    diagnosticOutputs: MEDIA_DIAGNOSTIC_OUTPUTS,
  },
  generate_music: {
    compactInputs: true,
    compactOutputs: true,
    primaryInputs: ['prompt'],
    primaryOutputs: ['music_artifact'],
    advancedInputs: [...PROVIDER_MODEL_INPUTS, ...GENERATION_TUNING_INPUTS],
    diagnosticOutputs: ['audio_artifact', ...MEDIA_DIAGNOSTIC_OUTPUTS],
  },
  transcribe_audio: {
    compactInputs: true,
    compactOutputs: true,
    primaryInputs: ['audio_artifact'],
    primaryOutputs: ['text'],
    advancedInputs: [...PROVIDER_MODEL_INPUTS, 'language', 'prompt', 'format', 'temperature'],
    diagnosticOutputs: ['transcript_artifact', 'artifact_ref', 'artifact_id', 'meta', 'success'],
  },
  listen_voice: {
    compactInputs: true,
    compactOutputs: true,
    primaryInputs: ['prompt'],
    primaryOutputs: ['audio_artifact', 'text'],
    advancedInputs: [...PROVIDER_MODEL_INPUTS, 'language', 'max_duration_s', 'wait_key'],
    diagnosticOutputs: ['artifact_ref', 'artifact_id'],
  },
  tool_calls: {
    compactInputs: true,
    primaryInputs: ['tool_calls'],
    advancedInputs: ['allowed_tools'],
  },
  ask_user: {
    compactInputs: true,
    primaryInputs: ['prompt'],
    advancedInputs: ['choices'],
  },
  answer_user: {
    compactInputs: true,
    primaryInputs: ['message'],
    advancedInputs: ['level'],
  },
  code: {
    compactInputs: true,
    compactOutputs: true,
    primaryInputs: ['input'],
    primaryOutputs: ['output'],
    advancedInputs: ['permissions'],
    diagnosticOutputs: ['success', 'execution'],
  },
  add_message: {
    compactInputs: true,
    compactOutputs: true,
    primaryInputs: ['role', 'content'],
    primaryOutputs: ['message', 'context'],
    diagnosticOutputs: ['task', 'messages'],
  },
  emit_event: {
    compactInputs: true,
    compactOutputs: true,
    primaryInputs: ['name', 'scope', 'payload'],
    primaryOutputs: ['delivered'],
    advancedInputs: ['session_id'],
    diagnosticOutputs: ['delivered_to', 'wait_key'],
  },
  wait_event: {
    compactInputs: true,
    primaryInputs: ['event_key'],
    advancedInputs: ['prompt', 'choices', 'allow_free_text'],
  },
  wait_until: {
    compactInputs: true,
    primaryInputs: ['duration'],
  },
  loop: {
    compactInputs: true,
    primaryInputs: ['items'],
  },
  for: {
    compactInputs: true,
    primaryInputs: ['start', 'end'],
    advancedInputs: ['step'],
  },
  while: {
    compactInputs: true,
    primaryInputs: ['condition'],
  },
  if: {
    compactInputs: true,
    primaryInputs: ['condition'],
  },
  switch: {
    compactInputs: true,
    primaryInputs: ['value'],
  },
  compare: {
    compactInputs: true,
    primaryInputs: ['a', 'op', 'b'],
  },
  and: {
    compactInputs: true,
    primaryInputs: ['a', 'b'],
  },
  or: {
    compactInputs: true,
    primaryInputs: ['a', 'b'],
  },
  not: {
    compactInputs: true,
    primaryInputs: ['value'],
  },
  on_schedule: {
    compactInputs: true,
    primaryInputs: ['schedule'],
    advancedInputs: ['recurrent'],
  },
  read_file: {
    compactInputs: true,
    primaryInputs: ['file_path'],
  },
  write_file: {
    compactInputs: true,
    primaryInputs: ['file_path', 'content'],
  },
  read_pdf: {
    compactInputs: true,
    primaryInputs: ['file_path'],
    advancedInputs: ['page_start', 'page_end', 'max_chars'],
  },
  write_pdf: {
    compactInputs: true,
    primaryInputs: ['file_path', 'content'],
    advancedInputs: ['title'],
  },
  concat: {
    compactInputs: true,
    primaryInputs: ['a', 'b'],
  },
  split: {
    compactInputs: true,
    primaryInputs: ['text', 'delimiter'],
  },
  join: {
    compactInputs: true,
    primaryInputs: ['items', 'delimiter'],
  },
  format: {
    compactInputs: true,
    primaryInputs: ['template', 'values'],
  },
  string_template: {
    compactInputs: true,
    primaryInputs: ['template', 'vars'],
  },
  uppercase: {
    compactInputs: true,
    primaryInputs: ['text'],
  },
  lowercase: {
    compactInputs: true,
    primaryInputs: ['text'],
  },
  trim: {
    compactInputs: true,
    primaryInputs: ['text'],
  },
  is_empty_string: {
    compactInputs: true,
    primaryInputs: ['text'],
  },
  contains: {
    compactInputs: true,
    primaryInputs: ['text', 'pattern'],
  },
  length: {
    compactInputs: true,
    primaryInputs: ['text'],
  },
  coalesce: {
    compactInputs: true,
    primaryInputs: ['a', 'b'],
  },
  get: {
    compactInputs: true,
    primaryInputs: ['object', 'key'],
    advancedInputs: ['default'],
  },
  get_element: {
    compactInputs: true,
    compactOutputs: true,
    primaryInputs: ['array', 'index'],
    primaryOutputs: ['result'],
    advancedInputs: ['default'],
    diagnosticOutputs: ['found'],
  },
  get_random_element: {
    compactInputs: true,
    compactOutputs: true,
    primaryInputs: ['array'],
    primaryOutputs: ['result'],
    advancedInputs: ['default'],
    diagnosticOutputs: ['found'],
  },
  set: {
    compactInputs: true,
    primaryInputs: ['object', 'key', 'value'],
  },
  merge: {
    compactInputs: true,
    primaryInputs: ['a', 'b'],
  },
  make_array: {
    compactInputs: true,
    primaryInputs: ['a'],
  },
  array_length: {
    compactInputs: true,
    primaryInputs: ['array'],
  },
  has_tools: {
    compactInputs: true,
    primaryInputs: ['array'],
  },
  array_append: {
    compactInputs: true,
    primaryInputs: ['array', 'item'],
  },
  array_dedup: {
    compactInputs: true,
    primaryInputs: ['array'],
    advancedInputs: ['key'],
  },
  array_map: {
    compactInputs: true,
    primaryInputs: ['items', 'key'],
  },
  array_filter: {
    compactInputs: true,
    primaryInputs: ['items', 'key', 'value'],
  },
  array_concat: {
    compactInputs: true,
    primaryInputs: ['a', 'b'],
  },
  parse_json: {
    compactInputs: true,
    primaryInputs: ['text'],
  },
  replace: {
    compactInputs: true,
    primaryInputs: ['text', 'pattern', 'replacement'],
    advancedInputs: ['mode'],
  },
  substring: {
    compactInputs: true,
    primaryInputs: ['text', 'start'],
    advancedInputs: ['end'],
  },
  stringify_json: {
    compactInputs: true,
    primaryInputs: ['value'],
    advancedInputs: ['mode'],
  },
  provider_catalog: {
    compactInputs: true,
    primaryInputs: [],
    advancedInputs: ['allowed_providers'],
  },
  provider_models: {
    compactInputs: true,
    primaryInputs: ['provider'],
    advancedInputs: ['capability_route'],
  },
  make_context: {
    compactInputs: true,
    primaryInputs: ['task', 'messages'],
    advancedInputs: ['context_extra'],
  },
  make_meta: {
    compactInputs: true,
    primaryInputs: ['schema', 'output_mode'],
    advancedInputs: [
      'version',
      'provider',
      'model',
      'sub_run_id',
      'iterations',
      'tool_calls',
      'tool_results',
      'finish_reason',
      'gen_time',
      'ttft_ms',
      'usage',
      'trace',
      'warnings',
      'debug',
      'extra',
    ],
  },
  make_scratchpad: {
    compactInputs: true,
    primaryInputs: ['task', 'messages'],
    advancedInputs: ['sub_run_id', 'workflow_id', 'context_extra', 'node_traces', 'steps', 'tool_calls', 'tool_results'],
  },
  memory_note: {
    compactInputs: true,
    primaryInputs: ['content'],
    advancedInputs: MEMORY_SCOPE_INPUTS,
  },
  memory_query: {
    compactInputs: true,
    primaryInputs: ['query'],
    advancedInputs: MEMORY_SCOPE_INPUTS,
  },
  memory_tag: {
    compactInputs: true,
    primaryInputs: ['span_id', 'tags'],
    advancedInputs: MEMORY_SCOPE_INPUTS,
  },
  memory_compact: {
    compactInputs: true,
    primaryInputs: [],
    advancedInputs: MEMORY_SCOPE_INPUTS,
  },
  memory_rehydrate: {
    compactInputs: true,
    primaryInputs: ['span_ids'],
    advancedInputs: MEMORY_SCOPE_INPUTS,
  },
  memory_kg_query: {
    compactInputs: true,
    compactOutputs: true,
    primaryInputs: ['query_text', 'subject', 'predicate', 'object'],
    primaryOutputs: ['items', 'count', 'ok'],
    advancedInputs: MEMORY_SCOPE_INPUTS,
    diagnosticOutputs: ['packets', 'active_memory_text', 'packed_count', 'dropped', 'estimated_tokens', 'raw'],
  },
  memory_kg_resolve: {
    compactInputs: true,
    compactOutputs: true,
    primaryInputs: ['label'],
    primaryOutputs: ['candidates', 'count', 'ok'],
    advancedInputs: MEMORY_SCOPE_INPUTS,
    diagnosticOutputs: ['raw'],
  },
  memact_compose: {
    compactInputs: true,
    compactOutputs: true,
    primaryInputs: ['kg_result'],
    primaryOutputs: ['ok', 'delta'],
    advancedInputs: MEMORY_SCOPE_INPUTS,
    diagnosticOutputs: ['trace', 'active_memory', 'memact_blocks', 'memact_system_prompt'],
  },
  memory_kg_assert: {
    compactInputs: true,
    compactOutputs: true,
    primaryInputs: ['assertions', 'scope'],
    primaryOutputs: ['count', 'ok'],
    advancedInputs: MEMORY_SCOPE_INPUTS,
    diagnosticOutputs: ['assertion_ids'],
  },
};

const DEFAULT_DATA_CACHE = new Map<string, FlowNodeData | null>();

export function isMediaPresentationNode(nodeType: NodeType | string): boolean {
  return MEDIA_NODE_TYPES.has(nodeType);
}

function defaultNodeData(nodeType: NodeType | string): FlowNodeData | null {
  const cacheKey = String(nodeType);
  if (DEFAULT_DATA_CACHE.has(cacheKey)) return DEFAULT_DATA_CACHE.get(cacheKey) ?? null;
  const template = getNodeTemplate(nodeType as NodeType);
  const value = template ? createNodeData(template) : null;
  DEFAULT_DATA_CACHE.set(cacheKey, value);
  return value;
}

function isReasoningNodeType(nodeType: NodeType | string): boolean {
  return nodeType === 'agent' || nodeType === 'llm_call';
}

function selectedReasoningModel(data: FlowNodeData | undefined, nodeType: NodeType | string): string {
  if (!data) return '';
  const candidates: unknown[] = [];
  if (nodeType === 'agent') {
    candidates.push(data.agentConfig?.model);
  } else if (nodeType === 'llm_call') {
    candidates.push(data.effectConfig?.model);
  }
  candidates.push(data.pinDefaults?.model);
  for (const value of candidates) {
    const text = typeof value === 'string' ? value.trim() : '';
    if (text) return text;
  }
  return '';
}

function modelNameLooksThinkingCapable(modelName: string): boolean {
  const clean = String(modelName || '').trim();
  if (!clean) return false;
  return THINKING_MODEL_PATTERNS.some((pattern) => pattern.test(clean));
}

function supportsThinkingFromData(data: FlowNodeData | undefined, nodeType: NodeType | string, hint?: ThinkingSupportHint): boolean {
  if (!isReasoningNodeType(nodeType)) return false;
  if (typeof hint?.supported === 'boolean') return hint.supported;
  return modelNameLooksThinkingCapable(selectedReasoningModel(data, nodeType));
}

function hasPolicyPin(values: readonly string[] | undefined, pinId: string): boolean {
  return Boolean(values?.includes(pinId));
}

function connectedSet(values: ReadonlySet<string> | readonly string[] | undefined): ReadonlySet<string> {
  if (!values) return new Set<string>();
  if (typeof (values as ReadonlySet<string>).has === 'function') return values as ReadonlySet<string>;
  return new Set(values as readonly string[]);
}

function isEmptyValue(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (Object.keys(record).length === 0) return true;
    const artifactId = record.$artifact ?? record.artifact_id ?? record.id;
    if (typeof artifactId === 'string' && artifactId.trim().length > 0) return false;
    return Object.values(record).every(isEmptyValue);
  }
  return false;
}

function stableStringify(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(',')}}`;
}

function valuesEqual(a: unknown, b: unknown): boolean {
  return stableStringify(a) === stableStringify(b);
}

function recordFrom(value: unknown): PinValueMap | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return value as PinValueMap;
}

function recordsFrom(values: readonly unknown[]): PinValueMap[] {
  return values.flatMap((value) => {
    const record = recordFrom(value);
    return record ? [record] : [];
  });
}

function pinConfigKeys(pinId: string): string[] {
  return [pinId, ...(CONFIG_PIN_ALIASES[pinId] || [])];
}

function valuesForPin(records: readonly PinValueMap[], pinId: string): unknown[] {
  const keys = pinConfigKeys(pinId);
  const values: unknown[] = [];
  for (const record of records) {
    for (const key of keys) {
      if (Object.prototype.hasOwnProperty.call(record, key) && record[key] !== undefined) {
        values.push(record[key]);
      }
    }
  }
  return values;
}

function configRecordsForData(data: FlowNodeData | undefined): PinValueMap[] {
  if (!data) return [];
  return recordsFrom([
    data.pinDefaults,
    data.effectConfig,
    data.agentConfig,
    data.eventConfig,
    data.modelCatalogConfig,
    data.providerModelsConfig,
    data.toolParametersConfig,
    data.breakConfig,
    data.concatConfig,
    data.switchConfig,
  ]);
}

function defaultRecordsForNodeType(nodeType: NodeType | string): PinValueMap[] {
  const defaults = defaultNodeData(nodeType);
  return recordsFrom([DEFAULT_PIN_VALUES_BY_NODE_TYPE[String(nodeType)], ...configRecordsForData(defaults || undefined)]);
}

function currentConfiguredValues(args: {
  data?: FlowNodeData;
  pinId: string;
  pinDefaults?: PinValueMap;
  config?: PinValueMap;
}): unknown[] {
  return valuesForPin(recordsFrom([args.pinDefaults, ...configRecordsForData(args.data), args.config]), args.pinId);
}

function defaultCandidates(args: {
  nodeType: NodeType | string;
  pinId: string;
  defaultPinDefaults?: PinValueMap;
  defaultConfig?: PinValueMap;
}): unknown[] {
  const explicitDefaults = valuesForPin(recordsFrom([args.defaultPinDefaults, args.defaultConfig]), args.pinId);
  if (explicitDefaults.length > 0) return explicitDefaults;
  return valuesForPin(defaultRecordsForNodeType(args.nodeType), args.pinId);
}

function hasNonDefaultConfiguredPinValueFor(args: {
  nodeType: NodeType | string;
  data?: FlowNodeData;
  pinId: string;
  pinDefaults?: PinValueMap;
  config?: PinValueMap;
  defaultPinDefaults?: PinValueMap;
  defaultConfig?: PinValueMap;
}): boolean {
  const defaults = defaultCandidates(args);
  for (const value of currentConfiguredValues(args)) {
    if (isEmptyValue(value)) continue;
    if (defaults.some((candidate) => valuesEqual(value, candidate))) continue;
    return true;
  }
  return false;
}

export function hasNonDefaultConfiguredPinValue(
  data: FlowNodeData,
  pinId: string,
  options: {
    pinDefaults?: PinValueMap;
    config?: PinValueMap;
    defaultPinDefaults?: PinValueMap;
    defaultConfig?: PinValueMap;
  } = {}
): boolean {
  return hasNonDefaultConfiguredPinValueFor({
    nodeType: data.nodeType,
    data,
    pinId,
    ...options,
  });
}

function shouldCompact(policy: NodeDisclosurePolicy | undefined, direction: PinDisclosureDirection): boolean {
  if (!policy) return false;
  return direction === 'input' ? Boolean(policy.compactInputs) : Boolean(policy.compactOutputs);
}

function isPolicyPrimary(policy: NodeDisclosurePolicy | undefined, pinId: string, direction: PinDisclosureDirection): boolean {
  if (!policy) return false;
  const ids = direction === 'input' ? policy.primaryInputs : policy.primaryOutputs;
  return hasPolicyPin(ids, pinId);
}

function isPolicyAdvanced(policy: NodeDisclosurePolicy | undefined, pinId: string, direction: PinDisclosureDirection): boolean {
  if (!policy) return false;
  const advanced = direction === 'input' ? policy.advancedInputs : policy.advancedOutputs;
  return hasPolicyPin(advanced, pinId);
}

function isPolicyDefault(policy: NodeDisclosurePolicy | undefined, pinId: string, direction: PinDisclosureDirection): boolean {
  if (!policy) return false;
  const ids = direction === 'input' ? policy.defaultInputs : policy.defaultOutputs;
  return hasPolicyPin(ids, pinId);
}

function isPolicyDiagnostic(policy: NodeDisclosurePolicy | undefined, pinId: string, direction: PinDisclosureDirection): boolean {
  if (!policy || direction !== 'output') return false;
  return hasPolicyPin(policy.diagnosticOutputs, pinId);
}

function classifyPin(args: {
  nodeType: NodeType | string;
  policy: NodeDisclosurePolicy | undefined;
  pinId: string;
  direction: PinDisclosureDirection;
  defaultPinDefaults?: PinValueMap;
  defaultConfig?: PinValueMap;
}): PinDisclosureClass {
  if (isPolicyPrimary(args.policy, args.pinId, args.direction)) return 'primary';
  if (isPolicyDiagnostic(args.policy, args.pinId, args.direction)) return 'diagnostic';
  if (isPolicyAdvanced(args.policy, args.pinId, args.direction)) return 'advanced';
  if (isPolicyDefault(args.policy, args.pinId, args.direction)) return 'default';
  if (
    defaultCandidates({
      nodeType: args.nodeType,
      pinId: args.pinId,
      defaultPinDefaults: args.defaultPinDefaults,
      defaultConfig: args.defaultConfig,
    }).length > 0
  ) {
    return 'default';
  }
  return 'unmanaged';
}

function isBatchArtifactOutputPin(nodeType: NodeType | string, pinId: string): boolean {
  if (pinId === 'image_artifacts') {
    return nodeType === 'generate_image' || nodeType === 'edit_image' || nodeType === 'image_to_image';
  }
  if (pinId === 'video_artifacts') {
    return nodeType === 'generate_video' || nodeType === 'text_to_video' || nodeType === 'image_to_video';
  }
  return false;
}

function hasConfiguredBatchGeneration(data: FlowNodeData | undefined, nodeType: NodeType | string): boolean {
  if (!data || !MEDIA_NODE_TYPES.has(String(nodeType))) return false;
  const countValues = currentConfiguredValues({ data, pinId: 'count' });
  for (const value of countValues) {
    const count = typeof value === 'number' ? value : Number(value);
    if (Number.isFinite(count) && count > 1) return true;
  }
  const seedValues = currentConfiguredValues({ data, pinId: 'seeds' });
  for (const value of seedValues) {
    if (Array.isArray(value) && value.length > 1) return true;
  }
  return false;
}

function decidePinVisibility<TPin extends PinLike>(args: {
  nodeType: NodeType | string;
  data?: FlowNodeData;
  pin: TPin;
  direction: PinDisclosureDirection;
  connectedIds: ReadonlySet<string>;
  expanded: boolean;
  thinkingSupport?: ThinkingSupportHint;
  pinDefaults?: PinValueMap;
  config?: PinValueMap;
  defaultPinDefaults?: PinValueMap;
  defaultConfig?: PinValueMap;
}): PinDisclosureDecision {
  if (args.pin.type === 'execution') {
    return { pinId: args.pin.id, direction: args.direction, visible: true, className: 'primary', reason: 'execution' };
  }

  if (args.connectedIds.has(args.pin.id)) {
    return { pinId: args.pin.id, direction: args.direction, visible: true, className: 'unmanaged', reason: 'connected' };
  }

  if (args.direction === 'output' && isStructuredResponseDataPin(args.pin, String(args.nodeType))) {
    const schemaActive = hasStructuredResponseSchema(args.data) || args.config?.__structured_response_active === true;
    return {
      pinId: args.pin.id,
      direction: args.direction,
      visible: schemaActive,
      className: schemaActive ? 'primary' : 'advanced',
      reason: schemaActive ? 'configured' : 'unsupported',
    };
  }

  if (
    args.direction === 'output' &&
    isBatchArtifactOutputPin(args.nodeType, args.pin.id) &&
    hasConfiguredBatchGeneration(args.data, args.nodeType)
  ) {
    return { pinId: args.pin.id, direction: args.direction, visible: true, className: 'advanced', reason: 'configured' };
  }

  const isUnsupportedThinkingPin =
    args.direction === 'input' &&
    args.pin.id === 'thinking' &&
    isReasoningNodeType(args.nodeType) &&
    !supportsThinkingFromData(args.data, args.nodeType, args.thinkingSupport);

  const policy = POLICY_BY_NODE_TYPE[String(args.nodeType) as NodeType];
  const className = classifyPin({
    nodeType: args.nodeType,
    policy,
    pinId: args.pin.id,
    direction: args.direction,
    defaultPinDefaults: args.defaultPinDefaults,
    defaultConfig: args.defaultConfig,
  });

  if (className === 'primary') {
    return { pinId: args.pin.id, direction: args.direction, visible: true, className, reason: 'primary' };
  }

  if (
    hasNonDefaultConfiguredPinValueFor({
      nodeType: args.nodeType,
      data: args.data,
      pinId: args.pin.id,
      pinDefaults: args.pinDefaults,
      config: args.config,
      defaultPinDefaults: args.defaultPinDefaults,
      defaultConfig: args.defaultConfig,
    })
  ) {
    return { pinId: args.pin.id, direction: args.direction, visible: true, className, reason: 'configured' };
  }

  if (isUnsupportedThinkingPin) {
    return { pinId: args.pin.id, direction: args.direction, visible: false, className: 'advanced', reason: 'unsupported' };
  }

  if (!shouldCompact(policy, args.direction)) {
    return { pinId: args.pin.id, direction: args.direction, visible: true, className, reason: 'unmanaged' };
  }

  if (args.expanded) {
    return { pinId: args.pin.id, direction: args.direction, visible: true, className, reason: 'expanded' };
  }

  if (className === 'advanced' || className === 'default' || className === 'diagnostic') {
    return { pinId: args.pin.id, direction: args.direction, visible: false, className, reason: 'compact-hidden' };
  }

  return { pinId: args.pin.id, direction: args.direction, visible: true, className, reason: 'unmanaged' };
}

export type DirectionalNodePinDisclosureArgs<TPin extends PinLike = Pin> = {
  nodeType?: NodeType | string;
  direction: PinDisclosureDirection;
  pins: readonly TPin[];
  connectedPinIds?: ReadonlySet<string> | readonly string[];
  data?: FlowNodeData;
  pinDefaults?: PinValueMap;
  config?: PinValueMap;
  defaultPinDefaults?: PinValueMap;
  defaultConfig?: PinValueMap;
  thinkingSupport?: ThinkingSupportHint;
  expanded?: boolean;
};

function isCollapsibleClass(className: PinDisclosureClass): boolean {
  return className === 'advanced' || className === 'default' || className === 'diagnostic';
}

export function computeNodePinDisclosure<TPin extends PinLike = Pin>(
  args: DirectionalNodePinDisclosureArgs<TPin>
): DirectionalNodePinDisclosureResult<TPin> {
  const nodeType = args.nodeType || args.data?.nodeType || '';
  const connectedIds = connectedSet(args.connectedPinIds);
  const expanded = Boolean(args.expanded);
  const visiblePins: TPin[] = [];
  const hiddenPins: TPin[] = [];
  const decisions: PinDisclosureDecision[] = [];

  for (const pin of args.pins) {
    const decision = decidePinVisibility({
      nodeType,
      data: args.data,
      pin,
      direction: args.direction,
      connectedIds,
      expanded,
      thinkingSupport: args.thinkingSupport,
      pinDefaults: args.pinDefaults,
      config: args.config,
      defaultPinDefaults: args.defaultPinDefaults,
      defaultConfig: args.defaultConfig,
    });
    decisions.push(decision);
    if (decision.visible) {
      visiblePins.push(pin);
    } else {
      hiddenPins.push(pin);
    }
  }

  const compactHiddenDecisions = decisions.filter((decision) => decision.reason === 'compact-hidden');
  const expandedCandidateDecisions = decisions.filter(
    (decision) => decision.reason === 'expanded' && isCollapsibleClass(decision.className)
  );
  const collapsibleCandidateCount = compactHiddenDecisions.length + expandedCandidateDecisions.length;

  if (collapsibleCandidateCount <= 1) {
    const adjustedDecisions = decisions.map((decision) =>
      decision.reason === 'compact-hidden'
        ? { ...decision, visible: true, reason: 'unmanaged' as const }
        : decision
    );
    const adjustedVisiblePins = args.pins.filter((pin) => {
      const decision = adjustedDecisions.find((item) => item.pinId === pin.id);
      return Boolean(decision?.visible);
    });
    const adjustedHiddenPins = args.pins.filter((pin) => {
      const decision = adjustedDecisions.find((item) => item.pinId === pin.id);
      return decision && !decision.visible;
    });

    return {
      visiblePins: adjustedVisiblePins,
      hiddenPins: adjustedHiddenPins,
      hiddenCount: adjustedHiddenPins.filter((pin) => {
        const decision = adjustedDecisions.find((item) => item.pinId === pin.id);
        return decision?.reason === 'compact-hidden';
      }).length,
      expandable: false,
      decisions: adjustedDecisions,
    };
  }

  return {
    visiblePins,
    hiddenPins,
    hiddenCount: compactHiddenDecisions.length,
    expandable: collapsibleCandidateCount > 0,
    decisions,
  };
}

export function getVisibleNodePins<TPin extends PinLike = Pin>(args: DirectionalNodePinDisclosureArgs<TPin>): TPin[] {
  return computeNodePinDisclosure(args).visiblePins;
}

export function getNodePinDisclosure(args: {
  data: FlowNodeData;
  inputs: readonly Pin[];
  outputs: readonly Pin[];
  connectedInputPinIds: ReadonlySet<string>;
  connectedOutputPinIds: ReadonlySet<string>;
  thinkingSupport?: ThinkingSupportHint;
  expanded: boolean;
}): NodePinDisclosureResult {
  const inputDisclosure = computeNodePinDisclosure({
    nodeType: args.data.nodeType,
    direction: 'input',
    pins: args.inputs,
    connectedPinIds: args.connectedInputPinIds,
    data: args.data,
    thinkingSupport: args.thinkingSupport,
    expanded: args.expanded,
  });
  const structuredResponseSchemaConnected =
    args.connectedInputPinIds.has('resp_schema') || args.connectedInputPinIds.has('response_schema');
  const outputDisclosure = computeNodePinDisclosure({
    nodeType: args.data.nodeType,
    direction: 'output',
    pins: args.outputs,
    connectedPinIds: args.connectedOutputPinIds,
    data: args.data,
    config: structuredResponseSchemaConnected ? { __structured_response_active: true } : undefined,
    expanded: args.expanded,
  });
  const inputPins = inputDisclosure.visiblePins;
  const outputPins = outputDisclosure.visiblePins;
  const hiddenInputCount = inputDisclosure.hiddenCount;
  const hiddenOutputCount = outputDisclosure.hiddenCount;
  const hiddenCount = hiddenInputCount + hiddenOutputCount;
  return {
    inputPins,
    outputPins,
    hiddenInputPins: inputDisclosure.hiddenPins,
    hiddenOutputPins: outputDisclosure.hiddenPins,
    hiddenInputCount,
    hiddenOutputCount,
    hiddenCount,
    expandable: hiddenCount > 0 || args.expanded,
    inputDecisions: inputDisclosure.decisions,
    outputDecisions: outputDisclosure.decisions,
  };
}
