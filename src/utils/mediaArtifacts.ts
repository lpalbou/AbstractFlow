import type { FlowNodeData, Pin, PinType } from '../types/flow';

export type ArtifactModality = 'generic' | 'image' | 'audio' | 'text' | 'video';

export type ArtifactPinSpec = {
  role: 'artifact' | 'non_artifact' | 'unknown';
  modality: ArtifactModality;
  list: boolean;
};

const ARTIFACT_TYPE_MODALITY: Partial<Record<PinType, ArtifactModality>> = {
  artifact: 'generic',
  artifact_image: 'image',
  artifact_audio: 'audio',
  artifact_text: 'text',
  artifact_video: 'video',
  artifacts: 'generic',
  artifacts_image: 'image',
  artifacts_audio: 'audio',
  artifacts_text: 'text',
  artifacts_video: 'video',
};

const ARTIFACT_LIST_TYPES = new Set<PinType>([
  'artifacts',
  'artifacts_image',
  'artifacts_audio',
  'artifacts_text',
  'artifacts_video',
]);

const MEDIA_NODE_TYPES = new Set([
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

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function modalityLabel(modality: ArtifactModality): string {
  return modality === 'generic' ? 'artifact' : `${modality} artifact`;
}

function modalityFromToken(token: string): ArtifactModality | null {
  const id = clean(token);
  if (!id) return null;
  if (id === 'artifact' || id === 'artifact_ref') return 'generic';
  if (id === 'image_artifact' || id === 'source_image' || id === 'mask_artifact') return 'image';
  if (id === 'audio_artifact' || id === 'voice_artifact' || id === 'music_artifact') return 'audio';
  if (id === 'text_artifact' || id === 'transcript_artifact') return 'text';
  if (id === 'video_artifact') return 'video';
  return null;
}

function modalityFromContentType(value: string): ArtifactModality | null {
  const contentType = clean(value);
  if (!contentType) return null;
  if (contentType.startsWith('image/')) return 'image';
  if (contentType.startsWith('audio/')) return 'audio';
  if (contentType.startsWith('video/')) return 'video';
  if (contentType.startsWith('text/') || contentType === 'application/json') return 'text';
  return null;
}

function normalizeArtifactModality(value: unknown): ArtifactModality | null {
  const modality = clean(value);
  if (!modality) return null;
  if (modality === 'image') return 'image';
  if (modality === 'audio' || modality === 'voice' || modality === 'music' || modality === 'sound') return 'audio';
  if (modality === 'text' || modality === 'transcript') return 'text';
  if (modality === 'video') return 'video';
  if (modality === 'artifact' || modality === 'generic') return 'generic';
  return null;
}

export function artifactSpecForPin(
  nodeData: Pick<FlowNodeData, 'nodeType'> | null | undefined,
  pin: Pick<Pin, 'id' | 'label' | 'type'> | null | undefined
): ArtifactPinSpec {
  if (!pin) return { role: 'unknown', modality: 'generic', list: false };

  const typeModality = ARTIFACT_TYPE_MODALITY[pin.type];
  if (typeModality) return { role: 'artifact', modality: typeModality, list: ARTIFACT_LIST_TYPES.has(pin.type) };

  const pinId = clean(pin.id);
  const nodeType = clean(nodeData?.nodeType);
  if ((pinId === 'outputs' || pinId === 'meta') && MEDIA_NODE_TYPES.has(nodeType)) {
    return { role: 'non_artifact', modality: 'generic', list: false };
  }

  // Name-based inference is for built-in media templates and artifact literal
  // nodes only. Custom object pins remain the advanced escape hatch.
  if (MEDIA_NODE_TYPES.has(nodeType) || nodeType === 'literal_json') {
    const idModality = modalityFromToken(pin.id) || modalityFromToken(pin.label);
    if (idModality) return { role: 'artifact', modality: idModality, list: false };
  }

  return { role: 'unknown', modality: 'generic', list: false };
}

export function artifactSpecForValue(value: unknown): ArtifactPinSpec {
  if (Array.isArray(value)) {
    if (value.length === 0) return { role: 'unknown', modality: 'generic', list: true };
    const specs = value.map((item) => artifactSpecForValue(item));
    if (specs.some((spec) => spec.role !== 'artifact')) return { role: 'unknown', modality: 'generic', list: true };
    const concrete = specs.filter((spec) => spec.modality !== 'generic');
    const modality =
      concrete.length === 0
        ? 'generic'
        : concrete.every((spec) => spec.modality === concrete[0].modality)
          ? concrete[0].modality
          : 'generic';
    return { role: 'artifact', modality, list: true };
  }
  if (!value || typeof value !== 'object') return { role: 'unknown', modality: 'generic', list: false };
  const record = value as Record<string, unknown>;
  const hasArtifactId = [record.$artifact, record.artifact_id, record.id].some((item) => typeof item === 'string' && item.trim());
  if (!hasArtifactId) return { role: 'unknown', modality: 'generic', list: false };
  const modality =
    normalizeArtifactModality(record.modality || record.type || record.kind) ||
    modalityFromContentType(typeof record.content_type === 'string' ? record.content_type : '');
  return { role: 'artifact', modality: modality || 'generic', list: false };
}

export function artifactModalitiesCompatible(source: ArtifactPinSpec, target: ArtifactPinSpec): boolean {
  if (target.role !== 'artifact') return true;
  if (source.role === 'unknown') return true;
  if (source.role === 'non_artifact') return false;
  if (!target.list && source.list) return false;
  if (source.modality === 'generic' || target.modality === 'generic') return true;
  return source.modality === target.modality;
}

export function artifactMismatchMessage(source: ArtifactPinSpec, target: ArtifactPinSpec): string | null {
  if (artifactModalitiesCompatible(source, target)) return null;
  if (source.role === 'non_artifact') {
    return `Needs ${target.list ? `list of ${modalityLabel(target.modality)}s` : modalityLabel(target.modality)}, got object payload.`;
  }
  if (!target.list && source.list) {
    return `Needs ${modalityLabel(target.modality)}, got artifact list.`;
  }
  return `Needs ${target.list ? `list of ${modalityLabel(target.modality)}s` : modalityLabel(target.modality)}, got ${modalityLabel(source.modality)}.`;
}

export function getArtifactConnectionError(
  sourceNode: Pick<FlowNodeData, 'nodeType'> | null | undefined,
  sourcePin: Pick<Pin, 'id' | 'label' | 'type'> | null | undefined,
  targetNode: Pick<FlowNodeData, 'nodeType'> | null | undefined,
  targetPin: Pick<Pin, 'id' | 'label' | 'type'> | null | undefined
): string | null {
  const source = artifactSpecForPin(sourceNode, sourcePin);
  const target = artifactSpecForPin(targetNode, targetPin);
  return artifactMismatchMessage(source, target);
}

export function getConfiguredArtifactInputError(
  targetNode: Pick<FlowNodeData, 'nodeType'> | null | undefined,
  targetPin: Pick<Pin, 'id' | 'label' | 'type'> | null | undefined,
  value: unknown
): string | null {
  const target = artifactSpecForPin(targetNode, targetPin);
  if (target.role !== 'artifact') return null;
  const source = artifactSpecForValue(value);
  return artifactMismatchMessage(source, target);
}

export function artifactPinTypesCompatible(sourceType: PinType, targetType: PinType): boolean | null {
  const sourceModality = ARTIFACT_TYPE_MODALITY[sourceType];
  const targetModality = ARTIFACT_TYPE_MODALITY[targetType];
  if (!sourceModality && !targetModality) return null;
  if (sourceType === 'object' || targetType === 'object' || sourceType === 'any' || targetType === 'any') return true;
  if (
    (ARTIFACT_LIST_TYPES.has(sourceType) && targetType === 'array') ||
    (sourceType === 'array' && ARTIFACT_LIST_TYPES.has(targetType))
  ) {
    return true;
  }
  if (!sourceModality || !targetModality) return false;
  if (!ARTIFACT_LIST_TYPES.has(targetType) && ARTIFACT_LIST_TYPES.has(sourceType)) return false;
  return sourceModality === 'generic' || targetModality === 'generic' || sourceModality === targetModality;
}
