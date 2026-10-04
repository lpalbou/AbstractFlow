// Round 11 (DESIGN R11.1 FINAL / R11.6): Run → File System Access is the kit
// WorkspaceChooser at the RUN level (same rows and words as the console, Code,
// Observer and the Assistant). The run's own workspaces ride the run-start
// body as `workspace: {posture, default_mode, folders}` (absent = "Use my
// default"), never input_data; what they mean is the gateway's dry run; no
// policy logic in Flow.
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WORKSPACE_CHOOSER_TEXT as T, WorkspaceChooser, workspaceDryRun, workspaceRefusal } from '@abstractframework/ui-kit';
import { gatewayStartRun } from '../utils/gatewayClient';
import { flowWorkspaceRequest } from './RunWorkspaceFolders';

const PICS = '/Users/alice/Pictures';
const DOCS = '/Users/alice/Documents';
const GW_LINE = 'Allow everything, refuse listed workspaces (rw) · /Users/alice/Documents (ro)';
const LINE = 'Deny everything, allow listed workspaces · /Users/alice/Pictures (rw) · /Users/alice/Documents (ro)';
const VALUE = { posture: 'allowed_only' as const, default_mode: 'rw' as const, folders: [{ path: PICS, mode: 'rw' as const }, { path: DOCS, mode: 'ro' as const }] };
const effective = {
  posture: 'allowed_only' as const,
  default_mode: 'rw' as const,
  folders: [{ path: PICS, mode: 'rw' as const, cap: 'rw' as const, source: 'run' }, { path: DOCS, mode: 'ro' as const, cap: 'ro' as const, source: 'run' }],
  summary: LINE,
  gateway_summary: GW_LINE,
};
const modal = readFileSync(new URL('./RunFlowModal.tsx', import.meta.url), 'utf8');
const hook = readFileSync(new URL('../hooks/useWebSocket.ts', import.meta.url), 'utf8');
const toolbar = readFileSync(new URL('./Toolbar.tsx', import.meta.url), 'utf8');
const pathField = readFileSync(new URL('./WorkspacePathInputField.tsx', import.meta.url), 'utf8');
const artifactField = readFileSync(new URL('./ArtifactInputField.tsx', import.meta.url), 'utf8');
const chooser = readFileSync(new URL('./RunWorkspaceFolders.tsx', import.meta.url), 'utf8');

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

// The editor's transport reads the CSRF cookie and arms a timeout.
function stubBrowser() {
  vi.stubGlobal('document', { cookie: '' });
  vi.stubGlobal('window', { setTimeout, clearTimeout });
}

afterEach(() => vi.unstubAllGlobals());

describe('Run → File System Access (round 11, run level)', () => {
  it('the run window mounts the run-level chooser and hands its value to the start, never to input_data', () => {
    expect(modal).toContain('<RunWorkspaceFolders');
    expect(modal).toContain('onRun(withRunSpeculation(inputData, runSpeculation), runWorkspace ? { workspace: runWorkspace } : {})');
    expect(modal).not.toContain('workspace_allowed_paths');
    expect(toolbar).toContain('runFlow(inputData, opts)');
    expect(toolbar).toContain('runPublishedFlow(target, inputData, opts)');
    expect(hook).toContain('...(args.workspace ? { workspace: args.workspace } : {})');
    expect(hook.match(/workspace: opts\.workspace/g)).toHaveLength(2);
    for (const src of [modal, pathField, artifactField]) {
      expect(src).not.toMatch(/workspace_access_mode|workspace_ignored_paths|workspace_or_allowed|all_except_ignored|client_workspace_scope_overrides/);
    }
  });

  it('the start body carries `workspace` when the run has its own, and nothing when it uses my default', async () => {
    const bodies: any[] = [];
    stubBrowser();
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return jsonResponse(200, { run_id: 'r1' });
    }));
    await gatewayStartRun({ flow_id: 'f', input_data: { prompt: 'x' }, session_id: 's1', workspace: VALUE });
    await gatewayStartRun({ flow_id: 'f', input_data: { prompt: 'x' }, session_id: 's1', workspace: null });
    expect(bodies[0].workspace).toEqual(VALUE);
    expect(bodies[0].input_data).toEqual({ prompt: 'x' });
    expect('workspace' in bodies[1]).toBe(false);
  });

  it('a refused start shows the gateway sentence (FastAPI-wrapped refusal)', async () => {
    const sentence = '/etc is outside the workspaces the gateway allows.';
    stubBrowser();
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(400, { detail: { reason: 'workspace_refused', message: sentence, path: '/etc' } })));
    await expect(gatewayStartRun({ flow_id: 'f', input_data: {}, workspace: { ...VALUE, folders: [{ path: '/etc', mode: 'rw' }] } })).rejects.toThrow(new RegExp(`^${sentence.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}$`));
  });

  it('Gateway line, posture, rows with caps, Use my default and the effective line come from the dry run', () => {
    const mine = renderToStaticMarkup(<WorkspaceChooser level="run" idPrefix="flow-run-workspace" value={null} effective={effective} onChange={() => {}} />);
    expect(mine).toContain(`${T.gatewayPrefix} ${GW_LINE}`);
    expect(mine).toContain(`>${T.useDefault}<`);
    expect(mine).toContain('data-following="true"');
    const own = renderToStaticMarkup(<WorkspaceChooser level="run" idPrefix="flow-run-workspace" value={VALUE} effective={effective} onChange={() => {}} />);
    expect(own).toContain('data-following="false"');
    expect(own).toContain(T.capReadOnly);
    expect(own).toContain(`data-workspace="effective">${LINE}<`);
    expect(own).not.toMatch(/>[^<]*\b(folders?|shared workspace)\b[^<]*</i);
  });

  it('the dry run is POST workspace/effective/me {workspace}; a refusal reads as the sentence + Not saved.', async () => {
    const seen: Array<[string, any]> = [];
    stubBrowser();
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      seen.push([url, JSON.parse(String(init.body))]);
      return jsonResponse(200, effective);
    }));
    await workspaceDryRun(flowWorkspaceRequest)(VALUE);
    expect(seen).toEqual([['api/gateway/workspace/effective/me', { workspace: VALUE }]]);
    const sentence = '/etc is outside the workspaces the gateway allows.';
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(400, { detail: { reason: 'workspace_refused', message: sentence, path: '/etc' } })));
    let message = '';
    try {
      await workspaceDryRun(flowWorkspaceRequest)({ ...VALUE, folders: [{ path: '/etc', mode: 'rw' }] });
    } catch (e) {
      message = workspaceRefusal(e);
    }
    expect(message).toBe(`${sentence} Not saved.`);
  });

  it('no local policy logic in the run window chooser', () => {
    expect(chooser).toContain('level="run"');
    expect(chooser).not.toMatch(/\.cap\b|\.filter\(|startsWith\(|builtin_refused|['"`]api\/gateway\//);
  });
});
