// Run → File System Access (round 11, DESIGN R11.6): the kit WorkspaceChooser
// at the RUN level, the same model and words as the gateway console,
// AbstractCode, Observer and the Assistant. The value is this run's own
// workspaces (`{posture, default_mode, folders}`, null = "Use my default");
// it rides the run-start body as `workspace` (RunFlowModal → useWebSocket).
// What it means is the gateway's dry run (POST api/gateway/workspace/effective/me):
// the effective line, the gateway line and the caps come from there, and a
// change the gateway refuses is shown with its sentence + "Not saved." and not
// kept. No policy logic here (no path checks, no clamp, no caps).
import { useCallback, useEffect, useState } from 'react';
import {
  WorkspaceChooser,
  workspaceDryRun,
  workspaceErrorSentence,
  type WorkspaceEffective,
  type WorkspaceRequest,
} from '@abstractframework/ui-kit';
import { gatewayJson, jsonRequest } from '../utils/gatewayClient';
import type { RunWorkspace } from '../utils/runWorkspaceChoice';

/** The kit client's request over Flow's gateway transport (session CSRF, the gateway's sentence on 4xx). */
export const flowWorkspaceRequest: WorkspaceRequest = (path, init) =>
  gatewayJson(path, init.body !== undefined ? jsonRequest(init.body, { method: init.method }) : { method: init.method });

export function RunWorkspaceFolders(props: {
  enabled: boolean;
  value: RunWorkspace | null;
  onChange: (next: RunWorkspace | null) => void;
  disabled?: boolean;
  request?: WorkspaceRequest;
}) {
  const { enabled, value, onChange, disabled, request = flowWorkspaceRequest } = props;
  const [effective, setEffective] = useState<WorkspaceEffective | null>(null);
  const [error, setError] = useState<string | null>(null);
  const valueKey = JSON.stringify(value);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    setError(null);
    workspaceDryRun(request)(value)
      .then((next) => live && setEffective(next))
      .catch((e) => live && setError(`Could not read your workspaces: ${workspaceErrorSentence(e)}`));
    return () => {
      live = false;
    };
    // `value` is identified by `valueKey`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, valueKey, request]);
  // A change is dry-run first: a refusal rejects (the kit shows the sentence) and the value stays.
  const change = useCallback(
    async (next: RunWorkspace | null) => {
      const answer = await workspaceDryRun(request)(next);
      setEffective(answer);
      onChange(next);
    },
    [request, onChange],
  );
  return (
    <WorkspaceChooser
      level="run"
      idPrefix="flow-run-workspace"
      value={value}
      effective={effective}
      onChange={change}
      loadError={error}
      unavailableReason={disabled ? 'A run is in progress.' : null}
    />
  );
}
