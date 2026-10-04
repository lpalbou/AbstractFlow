// Round 9 (R9.3): Run → File System Access is the kit WorkspaceChooser (same
// rows and words as the console, Code, Observer and the Assistant); the run's
// chosen folders ride input_data.workspace_allowed_paths; no access modes or
// ignored-folder lists; no policy logic in Flow.
import React from 'react';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { WORKSPACE_CHOOSER_TEXT as T, WorkspaceChooser, workspaceChooserClient, workspaceSelectionAfterToggle, workspaceSelectionView } from '@abstractframework/ui-kit';

const SHARED = '/srv/gw/workspaces';
const A = '/data/projects';
const B = '/data/notes';
const DENIED = '/etc/secrets';
const effective = {
  shared_workspace: SHARED,
  folders: [{ path: SHARED, source: 'shared' }, { path: A, source: 'allowed' }],
  available_folders: [{ path: A, enabled: true }, { path: B, enabled: false }],
  own_folders_allowed: false,
  never_allowed: [DENIED],
  summary: 'Private session folder + Shared workspace (workspaces) + 1 folder. Never: 1 folder.',
};
const modal = readFileSync(new URL('./RunFlowModal.tsx', import.meta.url), 'utf8');
const pathField = readFileSync(new URL('./WorkspacePathInputField.tsx', import.meta.url), 'utf8');
const artifactField = readFileSync(new URL('./ArtifactInputField.tsx', import.meta.url), 'utf8');
const chooser = readFileSync(new URL('./RunWorkspaceFolders.tsx', import.meta.url), 'utf8');

describe('Run → File System Access (round 9)', () => {
  it('the run form mounts the kit chooser and sends the chosen set as workspace_allowed_paths only', () => {
    expect(modal).toContain('<RunWorkspaceFolders');
    expect(modal).toContain('inputData.workspace_allowed_paths = workspaceFolders');
    for (const src of [modal, pathField, artifactField]) {
      expect(src).not.toMatch(/workspace_access_mode|workspace_ignored_paths|workspace_or_allowed|all_except_ignored|client_workspace_scope_overrides/);
    }
  });

  it('shared workspace always on; only the account\'s folders can be chosen (never a folder the admin did not allow)', () => {
    const html = renderToStaticMarkup(<WorkspaceChooser mode="automation" subject="run" effective={effective} selection={null} onSelectionChange={() => {}} />);
    expect(html).toContain('data-workspace="shared-always"');
    expect(html).toContain(T.runHelp.replace(/'/g, '&#x27;'));
    expect(html).not.toContain(`aria-label="${B}"`);
    expect(html).not.toContain(DENIED);
    const view = workspaceSelectionView(effective, [B, DENIED]);
    expect(workspaceSelectionAfterToggle(view, A, true)).toEqual([A]);
    expect(workspaceSelectionAfterToggle(view, B, true)).toEqual([]);
  });

  it('reads the caller\'s folders from workspace/policy/me (the kit client) with no local policy logic', async () => {
    const seen: string[] = [];
    await workspaceChooserClient(async (path) => {
      seen.push(path);
      return { ok: true, policy: { enabled_folders: [A], own_folders: [] }, effective };
    }).load();
    expect(seen).toEqual(['api/gateway/workspace/policy/me']);
    expect(chooser).not.toMatch(/never_allowed|available_folders|\.filter\(|startsWith\(/);
  });
});
