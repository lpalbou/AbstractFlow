import { useEffect, useState } from 'react';
import {
  endpointFromDescriptor,
  gatewayFetch,
  type GatewayEndpointDescriptor,
} from '../utils/gatewayClient';

export type ArtifactPlayerKind = 'image' | 'audio' | 'video' | 'text' | 'file';

export function artifactContentUrl(
  artifactContentDescriptor: GatewayEndpointDescriptor | string | null | undefined,
  runId: string,
  artifactId: string
): string {
  return endpointFromDescriptor(
    artifactContentDescriptor,
    '/api/gateway/runs/{run_id}/artifacts/{artifact_id}/content',
    {
      run_id: runId,
      artifact_id: artifactId,
    }
  );
}

export function useArtifactObjectUrl(src: string | null | undefined, contentType?: string, fallbackSrcs?: string[]) {
  const [state, setState] = useState<{ objectUrl: string; loading: boolean; error: string | null }>({
    objectUrl: '',
    loading: false,
    error: null,
  });

  useEffect(() => {
    const seen = new Set<string>();
    const urls = [src, ...(Array.isArray(fallbackSrcs) ? fallbackSrcs : [])]
      .map((value) => (typeof value === 'string' ? value.trim() : ''))
      .filter((value) => {
        if (!value || seen.has(value)) return false;
        seen.add(value);
        return true;
      });
    if (!urls.length) {
      setState({ objectUrl: '', loading: false, error: null });
      return;
    }

    let active = true;
    let objectUrl = '';
    setState({ objectUrl: '', loading: true, error: null });

    (async () => {
      let lastError = '';
      for (const url of urls) {
        try {
          const res = await gatewayFetch(url, { timeoutMs: 0 });
          const rawBlob = await res.blob();
          const blob =
            contentType && rawBlob.type !== contentType
              ? new Blob([await rawBlob.arrayBuffer()], { type: contentType })
              : rawBlob;
          objectUrl = URL.createObjectURL(blob);
          if (active) setState({ objectUrl, loading: false, error: null });
          else URL.revokeObjectURL(objectUrl);
          return;
        } catch (err) {
          lastError = err instanceof Error ? err.message : 'Failed to load artifact';
        }
      }
      if (active) setState({ objectUrl: '', loading: false, error: lastError || 'Failed to load artifact' });
    })();

    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [contentType, fallbackSrcs, src]);

  return state;
}

export function artifactPlayerKindFromContent(contentType: string | null | undefined, modality?: string): ArtifactPlayerKind {
  const type = String(contentType || '').toLowerCase();
  const mode = String(modality || '').toLowerCase();
  if (type.startsWith('image/') || mode === 'image') return 'image';
  if (type.startsWith('audio/') || mode === 'audio' || mode === 'voice' || mode === 'music') return 'audio';
  if (type.startsWith('video/') || mode === 'video') return 'video';
  if (type.startsWith('text/') || mode === 'text') return 'text';
  return 'file';
}

export function ArtifactPlayer({
  src,
  fallbackSrcs,
  contentType,
  kind,
  label,
  downloadName,
  compact = false,
}: {
  src: string | null | undefined;
  fallbackSrcs?: string[];
  contentType?: string;
  kind?: ArtifactPlayerKind;
  label?: string;
  downloadName?: string;
  compact?: boolean;
}) {
  const { objectUrl, loading, error } = useArtifactObjectUrl(src, contentType, fallbackSrcs);
  const displayUrl = objectUrl || src || '';
  const resolvedKind = kind || artifactPlayerKindFromContent(contentType);

  return (
    <div className={`artifact-player ${compact ? 'compact' : ''}`}>
      {loading ? (
        <div className="artifact-player-empty">Loading artifact...</div>
      ) : error ? (
        <div className="artifact-player-error">{error}</div>
      ) : displayUrl && resolvedKind === 'image' ? (
        <img src={displayUrl} alt={label || downloadName || 'Artifact'} className="artifact-player-image" />
      ) : displayUrl && resolvedKind === 'audio' ? (
        <audio src={displayUrl} controls className="artifact-player-audio" />
      ) : displayUrl && resolvedKind === 'video' ? (
        <video src={displayUrl} controls className="artifact-player-video" />
      ) : displayUrl ? (
        <a className="run-output-link" href={displayUrl} target="_blank" rel="noreferrer" download={downloadName}>
          Open artifact content
        </a>
      ) : (
        <div className="artifact-player-empty">No artifact selected.</div>
      )}
    </div>
  );
}
