// The run level of the workspace model (R11): a one-off run chooses its own
// workspaces. The payload rides the run-start body as
// `workspace: {posture, default_mode, folders}`; absent = "Use my default"
// (the gateway resolves session > account > gateway). The gateway clamps it to
// the eligible set and caps and refuses a wider request with a sentence; the
// editor computes nothing.
import type { WorkspaceRunValue } from '@abstractframework/ui-kit';

export type RunWorkspace = WorkspaceRunValue;

/** Options of a run start beside its input data. */
export type RunStartOptions = { workspace?: RunWorkspace | null };
