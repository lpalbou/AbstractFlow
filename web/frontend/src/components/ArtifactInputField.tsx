import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import type { Pin } from '../types/flow';
import {
  descriptorEndpointAvailable,
  endpointFromDescriptor,
  gatewayFetch,
  gatewayJson,
  jsonRequest,
  type GatewayContracts,
} from '../utils/gatewayClient';
import {
  artifactAcceptForPin,
  artifactIdFromRef,
  artifactMatchesPin,
  artifactModalityForPinType,
  artifactOwnerRunId,
  artifactRefFromMetadata,
  artifactRefFromUploadResponse,
  type CanonicalArtifactRef,
} from '../utils/artifactInputs';
import { ArtifactPlayer, artifactContentUrl, artifactPlayerKindFromContent } from './ArtifactPlayer';

type ArtifactInputFieldProps = {
  pin: Pin;
  value: CanonicalArtifactRef | null;
  onChange: (value: CanonicalArtifactRef | null) => void;
  sessionId: string;
  gatewayContracts: GatewayContracts | null | undefined;
  disabled?: boolean;
  workspaceRoot?: string;
  workspaceAccessMode?: string;
  workspaceIgnoredPaths?: string[];
};

type SourceMode = 'upload' | 'workspace' | 'existing';
type SearchScope = 'all' | 'session';

function refLabel(ref: CanonicalArtifactRef): string {
  return ref.filename || ref.source_path || artifactIdFromRef(ref);
}

function parseTagFilterText(raw: string): Record<string, string> | null {
  const text = String(raw || '').trim();
  if (!text) return {};
  if (text.startsWith('{')) {
    try {
      const parsed = JSON.parse(text) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
      const out: Record<string, string> = {};
      for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
        const k = String(key || '').trim();
        const v = String(value ?? '').trim();
        if (k && v) out[k] = v;
      }
      return out;
    } catch {
      return null;
    }
  }
  const out: Record<string, string> = {};
  for (const part of text.split(/[,\n]+/)) {
    const piece = part.trim();
    if (!piece) continue;
    const sep = piece.includes('=') ? '=' : piece.includes(':') ? ':' : '';
    if (!sep) return null;
    const [key, ...rest] = piece.split(sep);
    const k = String(key || '').trim();
    const v = rest.join(sep).trim();
    if (k && v) out[k] = v;
  }
  return out;
}

export function ArtifactInputField({
  pin,
  value,
  onChange,
  sessionId,
  gatewayContracts,
  disabled = false,
  workspaceRoot = '',
  workspaceAccessMode = '',
  workspaceIgnoredPaths = [],
}: ArtifactInputFieldProps) {
  const [mode, setMode] = useState<SourceMode>('existing');
  const [workspacePath, setWorkspacePath] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<CanonicalArtifactRef[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  const [searchScope, setSearchScope] = useState<SearchScope>('all');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const artifacts = gatewayContracts?.common?.artifacts || gatewayContracts?.flow_editor?.artifacts;
  const attachments = gatewayContracts?.common?.attachments;
  const uploadDescriptor = attachments?.upload;
  const importDescriptor = artifacts?.import;
  const searchDescriptor = artifacts?.search;
  const sessionListDescriptor = artifacts?.session_list;
  const contentDescriptor = artifacts?.content;
  const uploadAvailable = descriptorEndpointAvailable(uploadDescriptor);
  const importAvailable = descriptorEndpointAvailable(importDescriptor);
  const searchAvailable = descriptorEndpointAvailable(searchDescriptor);
  const sessionListAvailable = descriptorEndpointAvailable(sessionListDescriptor);
  const contentAvailable = descriptorEndpointAvailable(contentDescriptor);
  const selectedArtifactId = value ? artifactIdFromRef(value) : '';
  const selectedRunId = value ? artifactOwnerRunId(value) : '';

  const filteredItems = useMemo(
    () => items.filter((item) => artifactMatchesPin(item, pin)),
    [items, pin]
  );

  useEffect(() => {
    if (mode !== 'existing') return;
    const sid = sessionId.trim();
    const parsedTags = parseTagFilterText(tagFilter);
    if (parsedTags === null) {
      setItems([]);
      setError('Metadata filters must use JSON or key=value pairs.');
      return;
    }
    if (searchAvailable) {
      if (searchScope === 'session' && !sid) {
        setItems([]);
        setError(null);
        setLoadingItems(false);
        return;
      }
      let active = true;
      const timer = window.setTimeout(() => {
        setLoadingItems(true);
        setError(null);
        const modality = artifactModalityForPinType(pin.type);
        const query: Record<string, string | number> = {
          scope: searchScope,
          limit: 250,
        };
        if (searchScope === 'session') query.session_id = sid;
        if (modality !== 'artifact') query.modality = modality;
        if (searchText.trim()) query.query = searchText.trim();
        if (Object.keys(parsedTags).length > 0) query.tags = JSON.stringify(parsedTags);
        const url = endpointFromDescriptor(searchDescriptor, '/api/gateway/artifacts/search', {}, query);
        gatewayJson<{ items?: unknown[] }>(url)
          .then((payload) => {
            if (!active) return;
            const next = (Array.isArray(payload.items) ? payload.items : [])
              .map((item) => artifactRefFromMetadata(item))
              .filter((item): item is CanonicalArtifactRef => Boolean(item));
            setItems(next);
          })
          .catch((err) => {
            if (!active) return;
            setItems([]);
            setError(err instanceof Error ? err.message : 'Failed to search artifacts');
          })
          .finally(() => {
            if (active) setLoadingItems(false);
          });
      }, 250);
      return () => {
        active = false;
        window.clearTimeout(timer);
      };
    }

    if (!sessionListAvailable || !sid) {
      setItems([]);
      return;
    }
    let active = true;
    setLoadingItems(true);
    setError(null);
    const url = endpointFromDescriptor(
      sessionListDescriptor,
      '/api/gateway/sessions/{session_id}/artifacts',
      { session_id: sid },
      { limit: 500 }
    );
    gatewayJson<{ items?: unknown[] }>(url)
      .then((payload) => {
        if (!active) return;
        const next = (Array.isArray(payload.items) ? payload.items : [])
          .map((item) => artifactRefFromMetadata(item))
          .filter((item): item is CanonicalArtifactRef => Boolean(item));
        setItems(next);
      })
      .catch((err) => {
        if (!active) return;
        setItems([]);
        setError(err instanceof Error ? err.message : 'Failed to list session artifacts');
      })
      .finally(() => {
        if (active) setLoadingItems(false);
      });
    return () => {
      active = false;
    };
  }, [mode, pin.type, searchAvailable, searchDescriptor, searchScope, searchText, sessionId, sessionListAvailable, sessionListDescriptor, tagFilter]);

  const handleUpload = async (file: File | null) => {
    if (!file || disabled || !sessionId.trim() || !uploadAvailable) return;
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('session_id', sessionId.trim());
      form.append('file', file, file.name);
      form.append('filename', file.name);
      if (file.type) form.append('content_type', file.type);
      const url = endpointFromDescriptor(uploadDescriptor, '/api/gateway/attachments/upload');
      const res = await gatewayFetch(url, { method: 'POST', body: form, timeoutMs: 0 });
      const payload = (await res.json()) as Record<string, unknown>;
      const ref = artifactRefFromUploadResponse(payload);
      if (!ref) throw new Error('Gateway upload did not return an artifact reference');
      onChange(ref);
      setItems((prev) => [ref, ...prev.filter((item) => artifactIdFromRef(item) !== artifactIdFromRef(ref))]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Artifact upload failed');
    } finally {
      setBusy(false);
    }
  };

  const handleImport = async () => {
    const path = workspacePath.trim();
    if (!path || disabled || !sessionId.trim() || !importAvailable) return;
    setBusy(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        session_id: sessionId.trim(),
        source: { kind: 'workspace_path', path },
        pin_id: pin.id,
      };
      if (workspaceRoot.trim()) payload.workspace_root = workspaceRoot.trim();
      if (workspaceAccessMode.trim()) payload.workspace_access_mode = workspaceAccessMode.trim();
      if (workspaceIgnoredPaths.length > 0) payload.workspace_ignored_paths = workspaceIgnoredPaths.join('\n');
      const url = endpointFromDescriptor(importDescriptor, '/api/gateway/artifacts/import');
      const ref = artifactRefFromUploadResponse(
        await gatewayJson<Record<string, unknown>>(url, { ...jsonRequest(payload, { method: 'POST' }), timeoutMs: 0 })
      );
      if (!ref) throw new Error('Gateway import did not return an artifact reference');
      onChange(ref);
      setItems((prev) => [ref, ...prev.filter((item) => artifactIdFromRef(item) !== artifactIdFromRef(ref))]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Artifact import failed');
    } finally {
      setBusy(false);
    }
  };

  const previewSrc =
    contentAvailable && selectedArtifactId && selectedRunId
      ? artifactContentUrl(contentDescriptor, selectedRunId, selectedArtifactId)
      : '';
  const selectedContentType = value?.content_type || undefined;
  const selectedModality = value?.modality || artifactModalityForPinType(pin.type);

  return (
    <div className="artifact-input-field">
      <div className="artifact-input-tabs" role="tablist" aria-label={`${pin.label} artifact source`}>
        <button type="button" className={mode === 'existing' ? 'active' : ''} onClick={() => setMode('existing')} disabled={disabled}>
          Existing
        </button>
        <button type="button" className={mode === 'upload' ? 'active' : ''} onClick={() => setMode('upload')} disabled={disabled}>
          Upload
        </button>
        <button type="button" className={mode === 'workspace' ? 'active' : ''} onClick={() => setMode('workspace')} disabled={disabled}>
          Workspace
        </button>
      </div>

      {mode === 'existing' ? (
        <div className="artifact-input-existing">
          {searchAvailable ? (
            <div className="artifact-input-search-row">
              <input
                type="search"
                className="run-form-input"
                value={searchText}
                onChange={(event) => setSearchText(event.target.value)}
                placeholder={`Search ${artifactModalityForPinType(pin.type) === 'artifact' ? '' : `${artifactModalityForPinType(pin.type)} `}artifacts...`}
                disabled={disabled}
              />
              <select
                className="run-form-input artifact-input-scope"
                value={searchScope}
                disabled={disabled}
                onChange={(event) => setSearchScope(event.target.value === 'session' ? 'session' : 'all')}
              >
                <option value="all">All</option>
                <option value="session">Session</option>
              </select>
            </div>
          ) : null}
          {searchAvailable ? (
            <input
              type="text"
              className="run-form-input"
              value={tagFilter}
              onChange={(event) => setTagFilter(event.target.value)}
              placeholder="Metadata filters: key=value, purpose=run_input"
              disabled={disabled}
            />
          ) : null}
          <select
            className="run-form-input"
            value={selectedArtifactId}
            disabled={disabled || loadingItems || (!searchAvailable && (!sessionId.trim() || !sessionListAvailable))}
            onChange={(event) => {
              const next = filteredItems.find((item) => artifactIdFromRef(item) === event.target.value) || null;
              onChange(next);
            }}
          >
            <option value="">{loadingItems ? 'Loading artifacts...' : 'Select artifact...'}</option>
            {filteredItems.map((item) => (
              <option key={`${artifactOwnerRunId(item)}:${artifactIdFromRef(item)}`} value={artifactIdFromRef(item)}>
                {refLabel(item)}
              </option>
            ))}
          </select>
        </div>
      ) : mode === 'upload' ? (
        <div className="run-form-inline">
          <input
            ref={fileInputRef}
            type="file"
            className="artifact-input-file"
            accept={artifactAcceptForPin(pin.type)}
            disabled={disabled || busy || !uploadAvailable || !sessionId.trim()}
            onChange={(event: ChangeEvent<HTMLInputElement>) => {
              const file = event.target.files?.[0] || null;
              event.currentTarget.value = '';
              void handleUpload(file);
            }}
          />
          <button
            type="button"
            className="run-form-action"
            disabled={disabled || busy || !uploadAvailable || !sessionId.trim()}
            onClick={() => fileInputRef.current?.click()}
          >
            {busy ? 'Working...' : 'Choose file'}
          </button>
        </div>
      ) : (
        <div className="run-form-inline">
          <input
            type="text"
            className="run-form-input"
            value={workspacePath}
            onChange={(event) => setWorkspacePath(event.target.value)}
            placeholder="workspace/path.ext"
            disabled={disabled || busy || !importAvailable || !sessionId.trim()}
          />
          <button
            type="button"
            className="run-form-action"
            disabled={disabled || busy || !workspacePath.trim() || !importAvailable || !sessionId.trim()}
            onClick={() => void handleImport()}
          >
            {busy ? 'Working...' : 'Import'}
          </button>
        </div>
      )}

      {!sessionId.trim() ? <div className="run-form-note">Set a session id to select artifacts.</div> : null}
      {mode === 'existing' && !searchAvailable && !sessionListAvailable ? <div className="run-form-note">Artifact listing is unavailable.</div> : null}
      {mode === 'existing' && searchAvailable && searchScope === 'session' && !sessionId.trim() ? (
        <div className="run-form-note">Set a session id to search session artifacts.</div>
      ) : null}
      {mode === 'upload' && !uploadAvailable ? <div className="run-form-note">Artifact upload is unavailable.</div> : null}
      {mode === 'workspace' && !importAvailable ? <div className="run-form-note">Workspace import is unavailable.</div> : null}
      {error ? <div className="artifact-input-error">{error}</div> : null}

      {value ? (
        <div className="artifact-input-selected">
          <span className="artifact-id-pill" title={selectedArtifactId}>
            {refLabel(value)}
          </span>
          <button type="button" className="run-form-action" disabled={disabled} onClick={() => onChange(null)}>
            Clear
          </button>
        </div>
      ) : null}

      {previewSrc ? (
        <ArtifactPlayer
          src={previewSrc}
          contentType={selectedContentType}
          kind={artifactPlayerKindFromContent(selectedContentType, selectedModality)}
          label={value?.filename || selectedArtifactId}
          downloadName={value?.filename || selectedArtifactId}
          compact
        />
      ) : null}
    </div>
  );
}
