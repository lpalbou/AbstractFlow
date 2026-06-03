import type { Pin } from '../types/flow';

export type ArtifactModality = 'artifact' | 'image' | 'audio' | 'text' | 'video';

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

export function isArtifactPinType(pinType: string | undefined | null): boolean {
  return ['artifact', 'artifact_image', 'artifact_audio', 'artifact_text', 'artifact_video'].includes(String(pinType || ''));
}

export function artifactModalityForPinType(pinType: string | undefined | null): ArtifactModality {
  switch (String(pinType || '')) {
    case 'artifact_image':
      return 'image';
    case 'artifact_audio':
      return 'audio';
    case 'artifact_text':
      return 'text';
    case 'artifact_video':
      return 'video';
    default:
      return 'artifact';
  }
}

export function artifactAcceptForPin(pinType: string | undefined | null): string | undefined {
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

export function artifactModalityFromContentType(contentType: unknown): string {
  const type = stringFrom(contentType).toLowerCase();
  if (type.startsWith('image/')) return 'image';
  if (type.startsWith('audio/')) return 'audio';
  if (type.startsWith('video/')) return 'video';
  if (type.startsWith('text/') || ['application/json', 'application/xml', 'application/x-yaml'].includes(type)) return 'text';
  return 'file';
}

export function artifactMatchesPin(ref: unknown, pin: Pick<Pin, 'type'>): boolean {
  const expected = artifactModalityForPinType(pin.type);
  if (expected === 'artifact') return true;
  const record = recordFrom(ref);
  const modality = stringFrom(record.modality).toLowerCase() || artifactModalityFromContentType(record.content_type);
  if (expected === 'audio') return ['audio', 'voice', 'music', 'sound'].includes(modality);
  return modality === expected;
}
