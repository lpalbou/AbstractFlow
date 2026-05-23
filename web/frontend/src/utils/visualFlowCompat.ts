import type { FlowNodeData, JsonValue, Pin, VisualEdge, VisualNode } from '../types/flow';

const LEGACY_MUSIC_OUTPUT_SPEC_KIND = 'abstractflow.runtime_compat.generate_music.output_spec.v1';
const LEGACY_MUSIC_FACADE_KIND = 'abstractflow.runtime_compat.generate_music.facade.v1';

const OUTPUT_FIELD_TO_INPUT_PIN: Record<string, string> = {
  provider: 'music_provider',
  model: 'music_model',
  backend: 'music_provider',
  music_backend: 'music_provider',
  backend_music: 'music_provider',
  format: 'format',
  lyrics: 'lyrics',
  duration_s: 'duration_s',
  seed: 'seed',
  num_inference_steps: 'num_inference_steps',
  guidance_scale: 'guidance_scale',
  instrumental: 'instrumental',
  enhance_prompt: 'enhance_prompt',
  structure_prompt: 'structure_prompt',
  auto_lyrics: 'auto_lyrics',
  text_planner_mode: 'text_planner_mode',
  vocal_language: 'vocal_language',
  negative_prompt: 'negative_prompt',
  sample_rate: 'sample_rate',
  bpm: 'bpm',
  keyscale: 'keyscale',
  timesignature: 'timesignature',
  composition_plan: 'composition_plan',
  positive_styles: 'positive_styles',
  negative_styles: 'negative_styles',
  planning: 'planning',
  extra: 'extra',
};

const GENERATE_MUSIC_OUTPUTS: Pin[] = [
  { id: 'exec-out', label: '', type: 'execution' },
  { id: 'music_artifact', label: 'music_artifact', type: 'object', description: 'Artifact ref for generated music.' },
  { id: 'audio_artifact', label: 'audio_artifact', type: 'object', description: 'Alias artifact ref for audio-compatible downstream nodes.' },
  { id: 'artifact_ref', label: 'artifact_ref', type: 'object' },
  { id: 'artifact_id', label: 'artifact_id', type: 'string' },
  { id: 'content_type', label: 'content_type', type: 'string' },
  { id: 'outputs', label: 'outputs', type: 'object' },
  { id: 'meta', label: 'meta', type: 'object' },
  { id: 'success', label: 'success', type: 'boolean' },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function asJsonValue(value: unknown): JsonValue | undefined {
  if (value === null) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value as JsonValue;
  if (isRecord(value)) return value as JsonValue;
  return undefined;
}

function mergePinsById(existing: unknown, required: Pin[]): Pin[] {
  const pins = Array.isArray(existing) ? existing.filter((pin): pin is Pin => isRecord(pin) && typeof pin.id === 'string') : [];
  const byId = new Map(pins.map((pin) => [pin.id, pin] as const));
  const out: Pin[] = [];
  const used = new Set<string>();
  for (const pin of required) {
    const prior = byId.get(pin.id);
    out.push(prior ? { ...pin, ...prior, type: pin.type, label: pin.label || prior.label } : pin);
    used.add(pin.id);
  }
  for (const pin of pins) {
    if (!used.has(pin.id)) out.push(pin);
  }
  return out;
}

function compatKind(node: Pick<VisualNode, 'data'> | null | undefined): string {
  const meta = isRecord(node?.data) ? (node?.data as Record<string, unknown>)._abstractflowRuntimeCompat : null;
  return isRecord(meta) && typeof meta.kind === 'string' ? meta.kind : '';
}

export function isLegacyMusicCompatNode(node: Pick<VisualNode, 'data'> | null | undefined): boolean {
  const kind = compatKind(node);
  return kind === LEGACY_MUSIC_OUTPUT_SPEC_KIND || kind === LEGACY_MUSIC_FACADE_KIND;
}

function legacyOutputSpecForNode(node: VisualNode): Record<string, unknown> {
  const data = isRecord(node.data) ? (node.data as unknown as FlowNodeData) : ({} as FlowNodeData);
  const effectConfig = isRecord(data.effectConfig) ? (data.effectConfig as Record<string, unknown>) : {};
  const output = isRecord(effectConfig.output) ? effectConfig.output : {};
  return output;
}

function normalizeLegacyMusicFacadeNode(node: VisualNode): VisualNode {
  const data = isRecord(node.data) ? (node.data as unknown as FlowNodeData) : ({} as FlowNodeData);
  const effectConfig = isRecord(data.effectConfig) ? (data.effectConfig as Record<string, unknown>) : {};
  const output = legacyOutputSpecForNode(node);
  const nextEffectConfig: Record<string, JsonValue> = { ...(effectConfig as Record<string, JsonValue>) };
  delete nextEffectConfig.output;

  const runtimeProvider = asJsonValue(effectConfig.provider);
  const runtimeModel = asJsonValue(effectConfig.model);
  delete nextEffectConfig.provider;
  delete nextEffectConfig.model;
  if (runtimeProvider !== undefined && nextEffectConfig.runtime_provider === undefined) {
    nextEffectConfig.runtime_provider = runtimeProvider;
  }
  if (runtimeModel !== undefined && nextEffectConfig.runtime_model === undefined) {
    nextEffectConfig.runtime_model = runtimeModel;
  }

  const legacyBackend = asJsonValue(output.backend ?? output.music_backend ?? output.backend_music);
  if (typeof legacyBackend === 'string' && legacyBackend.trim()) {
    nextEffectConfig.music_provider = legacyBackend;
  }

  for (const [outputField, inputPin] of Object.entries(OUTPUT_FIELD_TO_INPUT_PIN)) {
    const value = asJsonValue(output[outputField]);
    if (value !== undefined && nextEffectConfig[inputPin] === undefined) {
      nextEffectConfig[inputPin] = value;
    }
  }
  delete nextEffectConfig.music_backend;
  delete nextEffectConfig.musicBackend;
  delete nextEffectConfig.backend_music;
  delete nextEffectConfig.backend;

  const nextData: Record<string, unknown> = {
    ...data,
    nodeType: 'generate_music',
    effectConfig: nextEffectConfig as FlowNodeData['effectConfig'],
    outputs: mergePinsById(data.outputs, GENERATE_MUSIC_OUTPUTS),
  };
  delete nextData._abstractflowRuntimeCompat;

  return {
    ...node,
    type: 'generate_music',
    data: nextData as unknown as FlowNodeData,
  };
}

export function normalizeLegacyMusicCompatVisualFlow(
  visualNodes: VisualNode[],
  visualEdges: VisualEdge[]
): { nodes: VisualNode[]; edges: VisualEdge[] } {
  const outputSpecById = new Map<string, string>();
  const legacyFacadeIds = new Set<string>();

  for (const node of visualNodes) {
    const kind = compatKind(node);
    if (kind === LEGACY_MUSIC_OUTPUT_SPEC_KIND) {
      const meta = isRecord(node.data) ? (node.data as Record<string, unknown>)._abstractflowRuntimeCompat : null;
      const forNodeId = isRecord(meta) && typeof meta.forNodeId === 'string' ? meta.forNodeId : '';
      if (forNodeId) outputSpecById.set(node.id, forNodeId);
    } else if (
      kind === LEGACY_MUSIC_FACADE_KIND ||
      (node.type === 'llm_call' &&
        isRecord(node.data) &&
        (node.data as unknown as FlowNodeData).nodeType === 'generate_music' &&
        isRecord((node.data as unknown as FlowNodeData).effectConfig) &&
        isRecord(((node.data as unknown as FlowNodeData).effectConfig as Record<string, unknown>).output))
    ) {
      legacyFacadeIds.add(node.id);
    }
  }

  if (outputSpecById.size === 0 && legacyFacadeIds.size === 0) {
    return { nodes: visualNodes, edges: visualEdges };
  }

  const nextNodes = visualNodes
    .filter((node) => !outputSpecById.has(node.id))
    .map((node) => (legacyFacadeIds.has(node.id) ? normalizeLegacyMusicFacadeNode(node) : node));

  const nextEdges: VisualEdge[] = [];
  const usedEdgeIds = new Set<string>();
  const pushEdge = (edge: VisualEdge) => {
    let id = edge.id;
    if (usedEdgeIds.has(id)) {
      let i = 2;
      while (usedEdgeIds.has(`${id}_${i}`)) i += 1;
      id = `${id}_${i}`;
    }
    usedEdgeIds.add(id);
    nextEdges.push({ ...edge, id });
  };

  for (const edge of visualEdges) {
    const specTargetNodeId = outputSpecById.get(edge.target);
    if (specTargetNodeId) {
      const targetHandle = OUTPUT_FIELD_TO_INPUT_PIN[String(edge.targetHandle || '')];
      if (targetHandle) {
        pushEdge({
          ...edge,
          target: specTargetNodeId,
          targetHandle,
        });
      }
      continue;
    }
    if (outputSpecById.has(edge.source)) {
      continue;
    }
    if (legacyFacadeIds.has(edge.source) && edge.sourceHandle === 'artifact_ref') {
      pushEdge({ ...edge, sourceHandle: 'music_artifact' });
      continue;
    }
    pushEdge(edge);
  }

  return { nodes: nextNodes, edges: nextEdges };
}
