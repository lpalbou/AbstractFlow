import { useEffect, useMemo, useState } from 'react';

import {
  descriptorEndpointAvailable,
  endpointFromDescriptor,
  gatewayJson,
  type GatewayContracts,
} from '../utils/gatewayClient';

type WorkspacePathKind = 'file' | 'folder';

type WorkspacePathInputFieldProps = {
  kind: WorkspacePathKind;
  value: string;
  onChange: (value: string) => void;
  gatewayContracts: GatewayContracts | null | undefined;
  disabled?: boolean;
  workspaceRoot?: string;
  workspaceAccessMode?: string;
  workspaceIgnoredPaths?: string[];
};

type WorkspaceListItem = {
  path?: string;
  name?: string;
  kind?: 'file' | 'folder' | string;
  family?: string;
  size_bytes?: number;
  mount?: string;
};

function parentFolder(path: string): string {
  const text = String(path || '').trim().replace(/\/+$/, '');
  if (!text) return '';
  const idx = text.lastIndexOf('/');
  if (idx <= 0) return '';
  return text.slice(0, idx);
}

function formatBytes(value: number | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return '';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

export function WorkspacePathInputField({
  kind,
  value,
  onChange,
  gatewayContracts,
  disabled = false,
  workspaceRoot = '',
  workspaceAccessMode = '',
  workspaceIgnoredPaths = [],
}: WorkspacePathInputFieldProps) {
  const [browsePath, setBrowsePath] = useState(kind === 'folder' ? value : parentFolder(value));
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<WorkspaceListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (kind === 'folder') {
      setBrowsePath(value);
      return;
    }
    setBrowsePath((current) => (current.trim() ? current : parentFolder(value)));
  }, [kind, value]);

  const workspaceContracts = gatewayContracts?.common?.workspace;
  const listDescriptor = workspaceContracts?.list_files;
  const browseAvailable = descriptorEndpointAvailable(listDescriptor);
  const kindLabel = kind === 'folder' ? 'Workspace Folder' : 'Workspace File';
  const consequence = kind === 'folder'
    ? 'Flow receives a canonical server workspace folder path.'
    : 'Flow receives a canonical server workspace file path.';
  const accessSummary = useMemo(() => {
    const mode = String(workspaceAccessMode || 'workspace_only').trim() || 'workspace_only';
    const ignored = workspaceIgnoredPaths.length > 0 ? `${workspaceIgnoredPaths.length} ignored path${workspaceIgnoredPaths.length === 1 ? '' : 's'}` : 'no ignored paths';
    if (workspaceRoot.trim()) return `${mode} under ${workspaceRoot.trim()} (${ignored}).`;
    return `${mode} with the gateway-managed run workspace (${ignored}).`;
  }, [workspaceAccessMode, workspaceIgnoredPaths, workspaceRoot]);

  useEffect(() => {
    if (!browseAvailable || disabled) return;
    let active = true;
    setLoading(true);
    setError(null);
    const endpoint = endpointFromDescriptor(listDescriptor, '/api/gateway/files/list', {}, {
      path: browsePath,
      include_directories: true,
      recursive: false,
      limit: 200,
      query: query.trim() || undefined,
      workspace_root: workspaceRoot.trim() || undefined,
      workspace_access_mode: workspaceAccessMode.trim() || undefined,
      workspace_ignored_paths: workspaceIgnoredPaths.length > 0 ? workspaceIgnoredPaths.join('\n') : undefined,
    });
    gatewayJson<{ items?: WorkspaceListItem[] }>(endpoint)
      .then((payload) => {
        if (!active) return;
        setItems(Array.isArray(payload.items) ? payload.items : []);
      })
      .catch((err) => {
        if (!active) return;
        setItems([]);
        setError(err instanceof Error ? err.message : 'Failed to browse workspace paths');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [
    browseAvailable,
    browsePath,
    disabled,
    kind,
    listDescriptor,
    query,
    workspaceAccessMode,
    workspaceIgnoredPaths,
    workspaceRoot,
  ]);

  return (
    <div className="artifact-input-field">
      <div className="artifact-source-card">
        <div className="artifact-source-card-header">
          <div className="artifact-source-card-title">{kindLabel}</div>
        </div>
        <div className="artifact-source-card-summary">{consequence}</div>
        <div className="artifact-source-card-grid">
          <div className="artifact-source-card-item">
            <strong>Source</strong>
            <span>Server workspace</span>
          </div>
          <div className="artifact-source-card-item">
            <strong>Reusable</strong>
            <span>Path only</span>
          </div>
          <div className="artifact-source-card-item">
            <strong>Access</strong>
            <span>{accessSummary}</span>
          </div>
        </div>
      </div>

      <label className="artifact-inline-label">
        {kind === 'folder' ? 'Workspace folder path' : 'Workspace file path'}
      </label>
      <input
        type="text"
        className="run-form-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={kind === 'folder' ? 'mount-or-folder/path' : 'mount-or-file/path.ext'}
        disabled={disabled}
      />

      <div className="artifact-source-card">
        <div className="artifact-source-card-header">
          <div className="artifact-source-card-title">Browse Server Workspace</div>
        </div>
        {browseAvailable ? (
          <>
            <div className="artifact-source-card-summary">
              Browse the current server workspace root and allowed mounts. Selecting a file or folder fills the path field above.
            </div>
            <div className="artifact-inline-controls">
              <input
                type="text"
                className="run-form-input"
                value={browsePath}
                onChange={(e) => setBrowsePath(e.target.value)}
                placeholder="Folder to browse (leave empty for workspace root)"
                disabled={disabled}
              />
              <input
                type="text"
                className="run-form-input"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filter current folder…"
                disabled={disabled}
              />
            </div>
            {loading ? <p className="run-form-note">Loading workspace entries…</p> : null}
            {error ? <p className="run-form-error">{error}</p> : null}
            {!loading && !error ? (
              <div className="artifact-source-list">
                {items.length === 0 ? <p className="run-form-note">No matching workspace entries.</p> : null}
                {items.map((item) => {
                  const itemPath = String(item.path || '').trim();
                  const itemKind = item.kind === 'folder' ? 'folder' : 'file';
                  const canSelect = kind === 'folder' ? itemKind === 'folder' : itemKind === 'file';
                  const subtitle = [item.family, formatBytes(item.size_bytes), item.mount ? `mount ${item.mount}` : '']
                    .filter(Boolean)
                    .join(' · ');
                  return (
                    <button
                      type="button"
                      key={`${itemKind}:${itemPath}`}
                      className="artifact-item-button"
                      disabled={disabled || !itemPath}
                      onClick={() => {
                        if (!itemPath) return;
                        if (canSelect) {
                          onChange(itemPath);
                          if (kind === 'file') setBrowsePath(parentFolder(itemPath));
                          if (kind === 'folder') setBrowsePath(itemPath);
                          return;
                        }
                        if (itemKind === 'folder') setBrowsePath(itemPath);
                      }}
                    >
                      <span className="artifact-item-main">
                        <span>{itemKind === 'folder' ? '📁' : '📄'} {itemPath || item.name || '(unnamed)'}</span>
                        {!canSelect && itemKind === 'folder' ? <span>Open</span> : null}
                      </span>
                      {subtitle ? <span className="artifact-item-sub">{subtitle}</span> : null}
                    </button>
                  );
                })}
              </div>
            ) : null}
          </>
        ) : (
          <p className="run-form-note">Workspace browsing is unavailable. Enter a canonical server path manually.</p>
        )}
      </div>
    </div>
  );
}

export default WorkspacePathInputField;
