import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import type { Pin } from '../types/flow';
import {
  descriptorEndpointAvailable,
  endpointFromDescriptor,
  gatewayJson,
  type GatewayContracts,
  type GatewayEndpointDescriptor,
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

type ArtifactListInputFieldProps = {
  pin: Pin;
  value: CanonicalArtifactRef[];
  onChange: (value: CanonicalArtifactRef[]) => void;
  sessionId: string;
  gatewayContracts: GatewayContracts | null | undefined;
  disabled?: boolean;
};

type SourceMode = 'existing' | 'upload' | 'folder';
type SearchScope = 'all' | 'session';

type SourceDescriptor = {
  label: string;
  summary: string;
  flowReceives: string;
  reusable: string;
  access: string;
  actionLabel?: string;
};

function stringFrom(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function endpointDeniedMessage(descriptor: GatewayEndpointDescriptor | null | undefined): string {
  const record =
    descriptor && typeof descriptor === 'object'
      ? (descriptor as Record<string, unknown>)
      : null;
  if (record?.available !== false) return '';
  const denied = typeof record.denied_reason === 'string' ? record.denied_reason.trim() : '';
  const role = typeof record.required_role === 'string' ? record.required_role.trim() : '';
  if (denied === 'admin_required' || role === 'admin') {
    return 'Requires admin/operator access in hosted mode.';
  }
  return denied ? `Unavailable: ${denied}.` : 'Unavailable.';
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

export function artifactListSourceDescriptor(
  mode: SourceMode,
  descriptors?: {
    upload?: GatewayEndpointDescriptor | null;
  }
): SourceDescriptor {
  if (mode === 'existing') {
    return {
      label: 'Artifacts',
      summary: 'Reuse saved files that are already available in AbstractFlow.',
      flowReceives: 'Files',
      reusable: 'Yes',
      access: 'No local or server path is used during the run',
    };
  }
  if (mode === 'upload') {
    return {
      label: 'Local Files',
      summary: 'Choose one or more files from this computer. Each file is copied into the workflow before the run.',
      flowReceives: 'Files',
      reusable: 'Yes',
      access: endpointDeniedMessage(descriptors?.upload) || 'Uses this computer/browser as the source',
      actionLabel: 'Choose local files',
    };
  }
  return {
    label: 'Local Folder',
    summary: 'Choose one or more folders from this computer. The workflow receives the files from those folders, with relative paths preserved. This is not a live writable folder path.',
    flowReceives: 'Files from the selected folders',
    reusable: 'Yes',
    access: endpointDeniedMessage(descriptors?.upload) || 'Uses this computer/browser as the source',
    actionLabel: 'Choose local folder',
  };
}

export function artifactListSelectionSummary(
  value: CanonicalArtifactRef[],
  source: SourceMode | 'mixed' | null
): Array<{ label: string; value: string }> {
  const count = value.length;
  const sourceLabel =
    source === 'upload'
      ? 'Local Files'
      : source === 'folder'
        ? 'Local Folder'
        : source === 'existing'
          ? 'Artifacts'
          : source === 'mixed'
            ? 'Mixed Sources'
            : 'Selected Files';
  const first = value[0];
  const reference =
    count === 0
      ? ''
      : count === 1
        ? stringFrom(first?.source_path) || stringFrom(first?.filename) || artifactIdFromRef(first)
        : `${count} files selected`;
  return [
    { label: 'Source', value: sourceLabel },
    {
      label: 'Workflow gets',
      value: source === 'folder' ? 'Files from the selected folders' : 'Files',
    },
    { label: 'Reusable', value: 'Yes' },
    { label: 'Selected', value: reference || `${count} files selected` },
  ];
}

function refKey(ref: CanonicalArtifactRef): string {
  return `${artifactOwnerRunId(ref)}::${artifactIdFromRef(ref)}`;
}

function refLabel(ref: CanonicalArtifactRef): string {
  return ref.source_path || ref.filename || artifactIdFromRef(ref);
}

function relativeSourcePath(file: File): string {
  const raw = stringFrom((file as File & { webkitRelativePath?: string }).webkitRelativePath) || file.name;
  const parts = raw
    .replace(/\\/g, '/')
    .split('/')
    .map((part) => part.trim())
    .filter((part) => part && part !== '.' && part !== '..');
  return parts.join('/') || file.name;
}

function supportsDirectorySelection(): boolean {
  if (typeof document === 'undefined') return false;
  const input = document.createElement('input') as HTMLInputElement & { webkitdirectory?: boolean };
  return 'webkitdirectory' in input;
}

export function ArtifactListInputField({
  pin,
  value,
  onChange,
  sessionId,
  gatewayContracts,
  disabled = false,
}: ArtifactListInputFieldProps) {
  const [mode, setMode] = useState<SourceMode>('existing');
  const [selectionSource, setSelectionSource] = useState<SourceMode | 'mixed' | null>(null);
  const [busy, setBusy] = useState(false);
  const [busyMessage, setBusyMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<CanonicalArtifactRef[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  const [searchScope, setSearchScope] = useState<SearchScope>('all');
  const filesInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const input = folderInputRef.current as (HTMLInputElement & { webkitdirectory?: boolean; directory?: boolean }) | null;
    if (!input) return;
    input.setAttribute('webkitdirectory', '');
    input.setAttribute('directory', '');
    input.multiple = true;
  }, []);

  useEffect(() => {
    if (value.length === 0) setSelectionSource(null);
  }, [value.length]);

  const artifacts = gatewayContracts?.common?.artifacts || gatewayContracts?.flow_editor?.artifacts;
  const attachments = gatewayContracts?.common?.attachments;
  const uploadDescriptor = attachments?.upload;
  const searchDescriptor = artifacts?.search;
  const sessionListDescriptor = artifacts?.session_list;
  const uploadAvailable = descriptorEndpointAvailable(uploadDescriptor);
  const searchAvailable = descriptorEndpointAvailable(searchDescriptor);
  const sessionListAvailable = descriptorEndpointAvailable(sessionListDescriptor);
  const modeDescriptor = artifactListSourceDescriptor(mode, { upload: uploadDescriptor });
  const selectedSummary = artifactListSelectionSummary(value, selectionSource);

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
        const modality = artifactModalityForPinType(pin);
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
            const next = Array.isArray(payload.items)
              ? payload.items
                  .map((item) => artifactRefFromMetadata(item))
                  .filter((item): item is CanonicalArtifactRef => !!item)
              : [];
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
      }, 200);
      return () => {
        active = false;
        window.clearTimeout(timer);
      };
    }
    if (!sessionListAvailable || !sid) {
      setItems([]);
      setLoadingItems(false);
      setError(null);
      return;
    }
    let active = true;
    setLoadingItems(true);
    setError(null);
    const url = endpointFromDescriptor(sessionListDescriptor, `/api/gateway/sessions/${encodeURIComponent(sid)}/artifacts`, {
      session_id: sid,
    });
    gatewayJson<{ items?: unknown[] }>(url)
      .then((payload) => {
        if (!active) return;
        const next = Array.isArray(payload.items)
          ? payload.items
              .map((item) => artifactRefFromMetadata(item))
              .filter((item): item is CanonicalArtifactRef => !!item)
          : [];
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

  const existingKeys = useMemo(() => new Set(value.map((item) => refKey(item))), [value]);

  const updateSelectionSource = (next: SourceMode) => {
    setSelectionSource((prev) => {
      if (!prev || prev === next) return next;
      return 'mixed';
    });
  };

  const mergeRefs = (refs: CanonicalArtifactRef[], source: SourceMode) => {
    if (refs.length === 0) return;
    const seen = new Set(value.map((item) => refKey(item)));
    const next = [...value];
    for (const ref of refs) {
      const key = refKey(ref);
      if (!artifactIdFromRef(ref) || seen.has(key)) continue;
      seen.add(key);
      next.push(ref);
    }
    updateSelectionSource(source);
    onChange(next);
  };

  const toggleExisting = (ref: CanonicalArtifactRef) => {
    const key = refKey(ref);
    if (existingKeys.has(key)) {
      onChange(value.filter((item) => refKey(item) !== key));
      return;
    }
    mergeRefs([ref], 'existing');
  };

  const removeRef = (key: string) => {
    onChange(value.filter((item) => refKey(item) !== key));
  };

  const uploadFiles = async (files: File[], source: SourceMode) => {
    if (!uploadAvailable) {
      setError('Local upload is unavailable.');
      return;
    }
    const sid = sessionId.trim();
    if (!sid) {
      setError('Set a session id to create or reuse artifacts.');
      return;
    }
    const url = endpointFromDescriptor(uploadDescriptor, '/api/gateway/attachments/upload');
    setBusy(true);
    setError(null);
    const uploaded: CanonicalArtifactRef[] = [];
    try {
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        setBusyMessage(`Uploading ${index + 1}/${files.length}...`);
        const form = new FormData();
        form.append('session_id', sid);
        form.append('file', file, file.name);
        form.append('filename', file.name);
        if (file.type) form.append('content_type', file.type);
        if (source === 'folder') form.append('source_path', relativeSourcePath(file));
        const payload = await gatewayJson<Record<string, unknown>>(url, { method: 'POST', body: form, timeoutMs: 0 });
        const ref = artifactRefFromUploadResponse(payload);
        if (ref) uploaded.push(ref);
      }
      mergeRefs(uploaded, source);
    } catch (err) {
      if (uploaded.length > 0) {
        mergeRefs(uploaded, source);
      }
      const detail = err instanceof Error ? err.message : 'Failed to upload files';
      setError(uploaded.length > 0 ? `${detail} Uploaded ${uploaded.length} file(s) before the failure.` : detail);
    } finally {
      setBusy(false);
      setBusyMessage('');
    }
  };

  const onLocalFilesPicked = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    event.currentTarget.value = '';
    if (files.length === 0) return;
    void uploadFiles(files, 'upload');
  };

  const onLocalFolderPicked = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    event.currentTarget.value = '';
    if (files.length === 0) return;
    void uploadFiles(files, 'folder');
  };

  return (
    <div className="artifact-input-field">
      <div className="artifact-source-card">
        <div className="artifact-source-card-header">
          <div className="artifact-source-card-title">{modeDescriptor.label}</div>
        </div>
        <div className="artifact-source-card-summary">{modeDescriptor.summary}</div>
          <div className="artifact-source-card-grid">
            <div className="artifact-source-card-item">
            <strong>Workflow gets</strong>
            <span>{modeDescriptor.flowReceives}</span>
          </div>
          <div className="artifact-source-card-item">
            <strong>Reusable</strong>
            <span>{modeDescriptor.reusable}</span>
          </div>
          <div className="artifact-source-card-item">
            <strong>Access</strong>
            <span>{modeDescriptor.access}</span>
          </div>
        </div>
      </div>

      <div className="artifact-input-tabs" role="tablist" aria-label={`${pin.label} source`}>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'existing'}
          className={`artifact-input-tab${mode === 'existing' ? ' active' : ''}`}
          onClick={() => setMode('existing')}
          disabled={disabled || busy}
        >
          Artifacts
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'upload'}
          className={`artifact-input-tab${mode === 'upload' ? ' active' : ''}`}
          onClick={() => setMode('upload')}
          disabled={disabled || busy}
        >
          Local Files
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'folder'}
          className={`artifact-input-tab${mode === 'folder' ? ' active' : ''}`}
          onClick={() => setMode('folder')}
          disabled={disabled || busy}
        >
          Local Folder
        </button>
      </div>

      {mode === 'existing' ? (
        <div className="artifact-input-existing">
          <div className="artifact-inline-controls">
            <select className="run-form-select" value={searchScope} onChange={(e) => setSearchScope(e.target.value === 'session' ? 'session' : 'all')} disabled={disabled || busy || !searchAvailable}>
              <option value="all">All artifacts</option>
              <option value="session">This session</option>
            </select>
            <input
              type="text"
              className="run-form-input"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="Search artifacts..."
              disabled={disabled || busy}
            />
          </div>
          <textarea
            className="run-form-textarea"
            rows={2}
            value={tagFilter}
            onChange={(e) => setTagFilter(e.target.value)}
            placeholder="Optional metadata filters: kind=attachment,source=upload"
            disabled={disabled || busy}
          />
          {loadingItems ? <div className="run-form-note">Loading artifacts...</div> : null}
          {!loadingItems && filteredItems.length === 0 ? <div className="run-form-note">No matching artifacts.</div> : null}
          <div className="artifact-source-list">
            {filteredItems.map((item) => {
              const key = refKey(item);
              const selected = existingKeys.has(key);
              return (
                <button
                  type="button"
                  key={key}
                  className="artifact-item-button"
                  onClick={() => toggleExisting(item)}
                  disabled={disabled || busy}
                >
                  <span className="artifact-item-main">
                    <span>{refLabel(item)}</span>
                    <span>{selected ? 'Remove' : 'Add'}</span>
                  </span>
                  {item.content_type ? <span className="artifact-item-sub">{item.content_type}</span> : null}
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="artifact-input-existing">
          <input
            ref={mode === 'upload' ? filesInputRef : folderInputRef}
            type="file"
            className="artifact-input-file"
            accept={artifactAcceptForPin(pin)}
            disabled={disabled || busy || !uploadAvailable || !sessionId.trim()}
            multiple
            onChange={mode === 'upload' ? onLocalFilesPicked : onLocalFolderPicked}
          />
          {mode === 'folder' && !supportsDirectorySelection() ? (
            <div className="run-form-note">This browser does not expose folder selection here. Use Local Files or a supported browser.</div>
          ) : null}
          <button
            type="button"
            className="run-form-action"
            disabled={disabled || busy || !uploadAvailable || !sessionId.trim() || (mode === 'folder' && !supportsDirectorySelection())}
            onClick={() => (mode === 'upload' ? filesInputRef.current : folderInputRef.current)?.click()}
          >
            {busy ? busyMessage || 'Working...' : modeDescriptor.actionLabel || 'Choose local files'}
          </button>
          {!busy && mode === 'upload' ? (
            <div className="run-form-note">Choose again to add more files before you run.</div>
          ) : null}
          {!busy && mode === 'folder' && supportsDirectorySelection() ? (
            <div className="run-form-note">Choose again to add another folder before you run.</div>
          ) : null}
        </div>
      )}

      {!sessionId.trim() ? <div className="run-form-note">Set a session id to create or reuse saved file inputs.</div> : null}
      {mode !== 'existing' && !uploadAvailable ? <div className="run-form-note">Local upload is unavailable.</div> : null}
      {error ? <div className="artifact-input-error">{error}</div> : null}

      {value.length > 0 ? (
        <div className="artifact-input-selected">
          <span className="artifact-id-pill" title={`${value.length} files selected`}>
            {value.length === 1 ? refLabel(value[0]) : `${value.length} files selected`}
          </span>
          <button type="button" className="run-form-action" disabled={disabled || busy} onClick={() => onChange([])}>
            Clear all
          </button>
          <div className="run-form-note run-form-note-compact">
            {selectedSummary.map((item) => `${item.label}: ${item.value}`).join(' · ')}
          </div>
          <div className="artifact-source-list">
            {value.map((item) => {
              const key = refKey(item);
              return (
                <button
                  type="button"
                  key={key}
                  className="artifact-item-button"
                  onClick={() => removeRef(key)}
                  disabled={disabled || busy}
                >
                  <span className="artifact-item-main">
                    <span>{refLabel(item)}</span>
                    <span>Remove</span>
                  </span>
                  {item.content_type ? <span className="artifact-item-sub">{item.content_type}</span> : null}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default ArtifactListInputField;
