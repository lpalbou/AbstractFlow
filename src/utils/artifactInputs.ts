import type { Pin } from '../types/flow';

export type ArtifactModality = 'artifact' | 'image' | 'audio' | 'text' | 'video';
type ArtifactPinKind = 'single' | 'list' | 'none';
type ArtifactPinLike = string | Pick<Pin, 'type' | 'schema'> | undefined | null;

const SINGLE_ARTIFACT_PIN_TYPES = ['artifact', 'artifact_image', 'artifact_audio', 'artifact_text', 'artifact_video'] as const;
const LIST_ARTIFACT_PIN_TYPES = ['artifacts', 'artifacts_image', 'artifacts_audio', 'artifacts_text', 'artifacts_video'] as const;

export type CanonicalArtifactRef = {
  $artifact: string;
  artifact_id?: string;
  run_id?: string;
  artifact_run_id?: string;
  content_type?: string;
  filename?: string;
  source_path?: string;
  sha256?: string;
  modality?: string;
  target?: string;
  [key: string]: unknown;
};

function recordFrom(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function stringFrom(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function recordFromSchema(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function normalizedArtifactPinType(pinLike: ArtifactPinLike): string {
  if (!pinLike) return '';
  if (typeof pinLike === 'string') return pinLike;
  const rawType = String(pinLike.type || '').trim();
  if (rawType !== 'array') return rawType;
  const schema = recordFromSchema(pinLike.schema);
  if (!schema) return rawType;
  const explicit = stringFrom(schema['x-abstract-type']);
  if (LIST_ARTIFACT_PIN_TYPES.includes(explicit as (typeof LIST_ARTIFACT_PIN_TYPES)[number])) return explicit;
  const items = recordFromSchema(schema.items);
  const itemType = items ? stringFrom(items['x-abstract-type']) : '';
  if (itemType === 'artifact') return 'artifacts';
  if (itemType === 'artifact_image') return 'artifacts_image';
  if (itemType === 'artifact_audio') return 'artifacts_audio';
  if (itemType === 'artifact_text') return 'artifacts_text';
  if (itemType === 'artifact_video') return 'artifacts_video';
  const properties = items ? recordFromSchema(items.properties) : null;
  const artifactProperty = properties ? recordFromSchema(properties.$artifact) : null;
  if (stringFrom(artifactProperty?.type) === 'string') {
    return 'artifacts';
  }
  return rawType;
}

export function isArtifactPinType(pinType: string | undefined | null): boolean {
  return SINGLE_ARTIFACT_PIN_TYPES.includes(String(pinType || '') as (typeof SINGLE_ARTIFACT_PIN_TYPES)[number]);
}

export function isArtifactListPinType(pinType: string | undefined | null): boolean {
  return LIST_ARTIFACT_PIN_TYPES.includes(String(pinType || '') as (typeof LIST_ARTIFACT_PIN_TYPES)[number]);
}

export function isArtifactListLikePin(pin: Pick<Pin, 'type' | 'schema'> | undefined | null): boolean {
  return isArtifactListPinType(normalizedArtifactPinType(pin));
}

export function isArtifactLikePinType(pinType: string | undefined | null): boolean {
  return isArtifactPinType(pinType) || isArtifactListPinType(pinType);
}

function artifactPinKind(pinType: ArtifactPinLike): ArtifactPinKind {
  const normalized = normalizedArtifactPinType(pinType);
  if (isArtifactPinType(normalized)) return 'single';
  if (isArtifactListPinType(normalized)) return 'list';
  return 'none';
}

export function artifactModalityForPinType(pinType: ArtifactPinLike): ArtifactModality {
  switch (normalizedArtifactPinType(pinType)) {
    case 'artifact_image':
    case 'artifacts_image':
      return 'image';
    case 'artifact_audio':
    case 'artifacts_audio':
      return 'audio';
    case 'artifact_text':
    case 'artifacts_text':
      return 'text';
    case 'artifact_video':
    case 'artifacts_video':
      return 'video';
    default:
      return 'artifact';
  }
}

export function artifactAcceptForPin(pinType: ArtifactPinLike): string | undefined {
  switch (artifactModalityForPinType(pinType)) {
    case 'image':
      return 'image/*';
    case 'audio':
      return 'audio/*';
    case 'video':
      return 'video/*';
    case 'text':
      return 'text/*,.txt,.md,.markdown,.json,.jsonl,.csv,.tsv,.yaml,.yml,.xml';
    default:
      return undefined;
  }
}

export function artifactIdFromRef(value: unknown): string {
  const record = recordFrom(value);
  return stringFrom(record.$artifact) || stringFrom(record.artifact_id);
}

export function artifactOwnerRunId(value: unknown): string {
  const record = recordFrom(value);
  return stringFrom(record.run_id) || stringFrom(record.artifact_run_id);
}

export function artifactRefFromRecord(value: unknown): CanonicalArtifactRef | null {
  const record = recordFrom(value);
  const artifactId = artifactIdFromRef(record);
  if (!artifactId) return null;
  return {
    ...record,
    $artifact: artifactId,
    artifact_id: artifactId,
  } as CanonicalArtifactRef;
}

export function artifactRefFromUploadResponse(value: unknown): CanonicalArtifactRef | null {
  const record = recordFrom(value);
  const attachment = artifactRefFromRecord(record.attachment);
  const artifact = artifactRefFromRecord(record.artifact);
  const metadata = recordFrom(record.metadata);
  const selected = artifact || attachment || artifactRefFromRecord(metadata);
  if (!selected) return null;
  const runId = stringFrom(record.run_id) || artifactOwnerRunId(selected) || stringFrom(metadata.run_id);
  const ref: CanonicalArtifactRef = { ...selected };
  if (runId) ref.run_id = runId;
  if (!ref.content_type) ref.content_type = stringFrom(metadata.content_type);
  if (!ref.filename) {
    const tags = recordFrom(metadata.tags);
    const filename = stringFrom(tags.filename);
    if (filename) ref.filename = filename;
  }
  if (!ref.modality && ref.content_type) ref.modality = artifactModalityFromContentType(ref.content_type);
  return ref;
}

export function artifactRefFromMetadata(value: unknown): CanonicalArtifactRef | null {
  const record = recordFrom(value);
  const ref = artifactRefFromRecord(record.ref) || artifactRefFromRecord(record);
  if (!ref) return null;
  const tags = recordFrom(record.tags);
  if (!ref.run_id) ref.run_id = stringFrom(record.run_id);
  if (!ref.content_type) ref.content_type = stringFrom(record.content_type);
  if (!ref.filename) ref.filename = stringFrom(record.filename) || stringFrom(tags.filename);
  if (!ref.source_path) ref.source_path = stringFrom(record.source_path) || stringFrom(tags.path);
  if (!ref.sha256) ref.sha256 = stringFrom(record.sha256) || stringFrom(tags.sha256);
  if (!ref.modality) {
    ref.modality = stringFrom(record.modality) || stringFrom(tags.modality) || artifactModalityFromContentType(ref.content_type);
  }
  return ref;
}

export function parseArtifactRefText(raw: string | undefined | null): CanonicalArtifactRef | null {
  const text = String(raw || '').trim();
  if (!text) return null;
  if (text.startsWith('{')) {
    try {
      return artifactRefFromRecord(JSON.parse(text));
    } catch {
      return null;
    }
  }
  return { $artifact: text, artifact_id: text };
}

export function normalizeArtifactRefs(values: unknown[]): CanonicalArtifactRef[] {
  const refs: CanonicalArtifactRef[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const ref =
      artifactRefFromRecord(value) ||
      (typeof value === 'string' ? parseArtifactRefText(value) : null);
    if (!ref) continue;
    const key = `${artifactOwnerRunId(ref)}::${artifactIdFromRef(ref)}`;
    if (!artifactIdFromRef(ref) || seen.has(key)) continue;
    seen.add(key);
    refs.push(ref);
  }
  return refs;
}

export function artifactRefsFromValue(value: unknown): CanonicalArtifactRef[] {
  if (Array.isArray(value)) return normalizeArtifactRefs(value);
  const single = artifactRefFromRecord(value) || (typeof value === 'string' ? parseArtifactRefText(value) : null);
  return single ? [single] : [];
}

export function parseArtifactRefsText(raw: string | undefined | null): CanonicalArtifactRef[] {
  const text = String(raw || '').trim();
  if (!text) return [];
  if (text.startsWith('[')) {
    try {
      return artifactRefsFromValue(JSON.parse(text));
    } catch {
      return [];
    }
  }
  const single = parseArtifactRefText(text);
  return single ? [single] : [];
}

export function artifactModalityFromContentType(contentType: unknown): string {
  const type = stringFrom(contentType).toLowerCase();
  if (type.startsWith('image/')) return 'image';
  if (type.startsWith('audio/')) return 'audio';
  if (type.startsWith('video/')) return 'video';
  if (type.startsWith('text/') || ['application/json', 'application/xml', 'application/x-yaml'].includes(type)) return 'text';
  return 'file';
}

export function artifactMatchesPin(ref: unknown, pin: Pick<Pin, 'type' | 'schema'>): boolean {
  const kind = artifactPinKind(pin);
  if (kind === 'list' && Array.isArray(ref)) {
    const normalized = normalizedArtifactPinType(pin);
    return ref.every((item) => artifactMatchesPin(item, { type: normalized.replace(/^artifacts/, 'artifact') as Pin['type'] }));
  }
  const expected = artifactModalityForPinType(pin);
  if (expected === 'artifact') return true;
  const record = recordFrom(ref);
  const modality = stringFrom(record.modality).toLowerCase() || artifactModalityFromContentType(record.content_type);
  if (expected === 'audio') return ['audio', 'voice', 'music', 'sound'].includes(modality);
  return modality === expected;
}
