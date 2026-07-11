import { useEffect, useState, type ReactNode } from 'react';
import {
  endpointFromDescriptor,
  gatewayFetch,
  type GatewayEndpointDescriptor,
} from '../utils/gatewayClient';
import {
  previewKindFor,
  TEXT_PREVIEW_CHAR_CAP,
  TEXT_PREVIEW_FETCH_CAP_BYTES,
  type ArtifactPreviewKind,
} from '../utils/artifactPreview';
import { MarkdownRenderer } from './MarkdownRenderer';

export type ArtifactPlayerKind = 'image' | 'audio' | 'video' | 'pdf' | 'markdown' | 'text' | 'file';

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

export function useArtifactObjectUrl(
  src: string | null | undefined,
  contentType?: string,
  fallbackSrcs?: string[],
  cacheKey?: string
) {
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
  }, [cacheKey, contentType, fallbackSrcs, src]);

  return state;
}

/** Fetch an artifact's TEXT content for inline preview (backlog 0116).
 * Clamped at TEXT_PREVIEW_CHAR_CAP with an explicit truncated flag — the
 * clamp is labeled in the UI, never silent. */
export function useArtifactText(
  src: string | null | undefined,
  fallbackSrcs?: string[],
  enabled = true
) {
  const [state, setState] = useState<{ text: string; truncated: boolean; loading: boolean; error: string | null }>({
    text: '',
    truncated: false,
    loading: false,
    error: null,
  });

  useEffect(() => {
    if (!enabled) {
      setState({ text: '', truncated: false, loading: false, error: null });
      return;
    }
    const seen = new Set<string>();
    const urls = [src, ...(Array.isArray(fallbackSrcs) ? fallbackSrcs : [])]
      .map((value) => (typeof value === 'string' ? value.trim() : ''))
      .filter((value) => {
        if (!value || seen.has(value)) return false;
        seen.add(value);
        return true;
      });
    if (!urls.length) {
      setState({ text: '', truncated: false, loading: false, error: null });
      return;
    }

    let active = true;
    setState({ text: '', truncated: false, loading: true, error: null });

    (async () => {
      let lastError = '';
      for (const url of urls) {
        try {
          const res = await gatewayFetch(url, { timeoutMs: 0 });
          // Size guard (review P2-9): refuse to materialize huge bodies just
          // to clamp them — an honest refusal with Download beats an OOM tab.
          const contentLength = Number(res.headers.get('content-length') || '');
          if (Number.isFinite(contentLength) && contentLength > TEXT_PREVIEW_FETCH_CAP_BYTES) {
            if (active) {
              setState({
                text: '',
                truncated: false,
                loading: false,
                error: `Artifact is too large to preview inline (${Math.round(contentLength / 1_000_000)} MB) — use Download.`,
              });
            }
            return;
          }
          const raw = await res.text();
          if (!active) return;
          const truncated = raw.length > TEXT_PREVIEW_CHAR_CAP;
          setState({
            text: truncated ? raw.slice(0, TEXT_PREVIEW_CHAR_CAP) : raw,
            truncated,
            loading: false,
            error: null,
          });
          return;
        } catch (err) {
          lastError = err instanceof Error ? err.message : 'Failed to load artifact text';
        }
      }
      if (active) setState({ text: '', truncated: false, loading: false, error: lastError || 'Failed to load artifact text' });
    })();

    return () => {
      active = false;
    };
  }, [enabled, fallbackSrcs, src]);

  return state;
}

export function artifactPlayerKindFromContent(
  contentType: string | null | undefined,
  modality?: string,
  name?: string | null
): ArtifactPlayerKind {
  const kind: ArtifactPreviewKind = previewKindFor(contentType, name, modality);
  return kind === 'binary' ? 'file' : kind;
}

/** Dependency-free image lightbox (backlog 0116): click-out or Escape closes. */
export function ImageLightbox({
  src,
  alt,
  onClose,
}: {
  src: string;
  alt?: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="artifact-lightbox" role="dialog" aria-modal="true" onClick={onClose}>
      <img src={src} alt={alt || 'Artifact preview'} className="artifact-lightbox-img" onClick={(e) => e.stopPropagation()} />
      <button type="button" className="artifact-lightbox-close" aria-label="Close preview" onClick={onClose}>
        ×
      </button>
    </div>
  );
}

function PreviewActions({ href, downloadName, children }: { href: string; downloadName?: string; children?: ReactNode }) {
  return (
    <div className="artifact-player-actions">
      <a className="run-output-link" href={href} target="_blank" rel="noreferrer">
        Open in tab
      </a>
      <a className="run-output-link" href={href} download={downloadName || true}>
        Download
      </a>
      {children}
    </div>
  );
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
  const resolvedKind = kind || artifactPlayerKindFromContent(contentType, undefined, downloadName || label);
  const isTextual = resolvedKind === 'text' || resolvedKind === 'markdown';
  // PDFs detected by filename often arrive typeless/octet-stream; the iframe
  // viewer needs a correctly typed blob or browsers download instead of
  // rendering (review finding P1-1). Force the type for the pdf branch.
  const blobContentType = resolvedKind === 'pdf' ? 'application/pdf' : contentType;
  const { objectUrl, loading, error } = useArtifactObjectUrl(isTextual ? null : src, blobContentType, fallbackSrcs);
  const textState = useArtifactText(src, fallbackSrcs, isTextual);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const displayUrl = objectUrl || src || '';

  if (isTextual) {
    return (
      <div className={`artifact-player ${compact ? 'compact' : ''}`}>
        {textState.loading ? (
          <div className="artifact-player-empty">Loading artifact…</div>
        ) : textState.error ? (
          <div className="artifact-player-error">{textState.error}</div>
        ) : (
          <>
            {resolvedKind === 'markdown' ? (
              <div className="artifact-player-text markdown">
                <MarkdownRenderer markdown={textState.text} />
              </div>
            ) : (
              <pre className="artifact-player-text">{textState.text}</pre>
            )}
            {textState.truncated ? (
              <div className="artifact-player-truncation">
                #TRUNCATION Preview clamped at {TEXT_PREVIEW_CHAR_CAP.toLocaleString()} characters — download for the
                full content.
              </div>
            ) : null}
            {src ? <PreviewActions href={src} downloadName={downloadName} /> : null}
          </>
        )}
      </div>
    );
  }

  return (
    <div className={`artifact-player ${compact ? 'compact' : ''}`}>
      {loading ? (
        <div className="artifact-player-empty">Loading artifact...</div>
      ) : error ? (
        <div className="artifact-player-error">{error}</div>
      ) : displayUrl && resolvedKind === 'image' ? (
        <>
          <button
            type="button"
            className="artifact-player-zoom"
            title="Click to zoom"
            onClick={() => setLightboxOpen(true)}
          >
            <img src={displayUrl} alt={label || downloadName || 'Artifact'} className="artifact-player-image" />
          </button>
          {lightboxOpen ? (
            <ImageLightbox src={displayUrl} alt={label || downloadName} onClose={() => setLightboxOpen(false)} />
          ) : null}
        </>
      ) : displayUrl && resolvedKind === 'audio' ? (
        <audio src={displayUrl} controls className="artifact-player-audio" />
      ) : displayUrl && resolvedKind === 'video' ? (
        <video src={displayUrl} controls className="artifact-player-video" />
      ) : displayUrl && resolvedKind === 'pdf' ? (
        <>
          <iframe src={displayUrl} title={label || downloadName || 'PDF artifact'} className="artifact-player-pdf" />
          <PreviewActions href={displayUrl} downloadName={downloadName} />
        </>
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
