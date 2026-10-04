// Run → File System Access (round 9): the kit WorkspaceChooser, the same
// folder model and words as the gateway console, AbstractCode, Observer and
// the Assistant. The run may use the account's effective folders
// (GET api/gateway/workspace/policy/me); the chosen set rides the run as
// input_data.workspace_allowed_paths (null = follows the account). The gateway
// decides: a folder outside the account's folders is refused at run start
// with a sentence. No policy logic here (no path checks, no clamp).
import { useEffect, useState } from 'react';
import { WorkspaceChooser, workspaceChooserClient, type WorkspaceEffective, type WorkspaceRequest } from '@abstractframework/ui-kit';
import { gatewayJson, jsonRequest } from '../utils/gatewayClient';

/** The kit client's request over Flow's gateway transport (session CSRF, the gateway's sentence on 4xx). */
export const flowWorkspaceRequest: WorkspaceRequest = (path, init) =>
  gatewayJson(path, init.body !== undefined ? jsonRequest(init.body, { method: init.method }) : { method: init.method });

export function RunWorkspaceFolders(props: {
  enabled: boolean;
  selection: string[] | null;
  onSelectionChange: (next: string[] | null) => void;
  disabled?: boolean;
  request?: WorkspaceRequest;
}) {
  const { enabled, selection, onSelectionChange, disabled, request = flowWorkspaceRequest } = props;
  const [effective, setEffective] = useState<WorkspaceEffective | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    setError(null);
    workspaceChooserClient(request)
      .load()
      .then((state) => live && setEffective(state.effective))
      .catch((e) => live && setError(`Could not read your workspace folders: ${e instanceof Error ? e.message : String(e)}`));
    return () => {
      live = false;
    };
  }, [enabled, request]);
  return (
    <WorkspaceChooser
      mode="automation"
      subject="run"
      idPrefix="flow-run-workspace"
      effective={effective}
      selection={selection}
      onSelectionChange={onSelectionChange}
      loadError={error}
      unavailableReason={disabled ? 'A run is in progress.' : null}
    />
  );
}
