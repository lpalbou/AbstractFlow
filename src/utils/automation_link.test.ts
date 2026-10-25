// UX re-review #3: Turn it on created a new automation on every click. A flow
// has ONE automation: found again, updated (PATCH) or turned off/on (commands).
import { describe, expect, it, vi } from 'vitest';
import { findFlowAutomation, linkedStatusWords, setFlowAutomationOn, updateFlowAutomation, type AutomationLinkDeps } from './automationLink';
import { GatewayHttpError } from './gatewayClient';

function deps(automations: Record<string, { flow_id: string; status: string; title: string; revision?: number }>, remembered: string | null = null) {
  const memory = new Map<string, string>(remembered ? [['flow-1', remembered]] : []);
  const sent: Array<[string, string, unknown]> = [];
  const d: AutomationLinkDeps = {
    getJson: vi.fn(async (path: string) => {
      if (path.endsWith('?limit=200')) return { items: Object.entries(automations).map(([id, a]) => ({ automation_id: id, title: a.title, status: a.status })) };
      const id = decodeURIComponent(path.split('/').pop() || '');
      const a = automations[id];
      if (!a) throw new GatewayHttpError('nf', 404, null);
      return { definition: { target: { flow_id: a.flow_id }, revision: a.revision ?? 2, title: a.title }, summary: { status: a.status, revision: a.revision ?? 2, title: a.title } };
    }),
    send: vi.fn(async (path: string, method: string, body: unknown) => {
      sent.push([method, path, body]);
      return { ok: true };
    }),
    remember: { get: (f) => memory.get(f) ?? null, set: (f, id) => (id ? memory.set(f, id) : memory.delete(f)) },
  };
  return { d, sent, memory };
}

describe('one automation per flow', () => {
  it('finds the remembered automation; a stale memory falls back to the title scan, which remembers the match', async () => {
    const a = deps({ auto1: { flow_id: 'flow-1', status: 'active', title: 'Release digest' } }, 'auto1');
    expect(await findFlowAutomation('flow-1', ['Release digest'], a.d)).toMatchObject({ automation_id: 'auto1', status: 'active', revision: 2 });
    const b = deps({ auto2: { flow_id: 'flow-1', status: 'paused', title: 'Release digest' }, other: { flow_id: 'flow-9', status: 'active', title: 'Release digest' } }, 'gone');
    expect(await findFlowAutomation('flow-1', ['Release digest'], b.d)).toMatchObject({ automation_id: 'auto2', status: 'paused' });
    expect(b.memory.get('flow-1')).toBe('auto2');
    const c = deps({ x: { flow_id: 'flow-9', status: 'active', title: 'Release digest' } });
    expect(await findFlowAutomation('flow-1', ['Release digest'], c.d)).toBeNull();
    // An archived one is not this flow's live automation.
    const d = deps({ old: { flow_id: 'flow-1', status: 'archived', title: 'Release digest' } }, 'old');
    expect(await findFlowAutomation('flow-1', ['Release digest'], d.d)).toBeNull();
  });

  it('updates through PATCH with the expected revision and the flow\'s defaults; off/on through commands', async () => {
    const a = deps({});
    const linked = { automation_id: 'auto1', status: 'active', revision: 3, title: 'Release digest' };
    const defaults = { schema_version: 1 as const, trigger: { source_id: 'manual', source_version: 1, config: {} }, context: { mode: 'independent' as const }, input_data: { threshold: 3 } };
    await updateFlowAutomation(linked, { defaults, flowId: 'flow-1', flowName: 'Release digest', bundleRef: 'Release-digest@0.0.2' }, a.d);
    await setFlowAutomationOn(linked, false, a.d);
    await setFlowAutomationOn(linked, true, a.d);
    expect(a.sent[0][0]).toBe('PATCH');
    expect(a.sent[0][1]).toBe('api/gateway/automations/auto1');
    expect(a.sent[0][2]).toMatchObject({
      expected_revision: 3,
      changes: { title: 'Release digest', trigger: defaults.trigger, context: defaults.context, target: { bundle_ref: 'Release-digest@0.0.2', flow_id: 'flow-1', input_data: { threshold: 3 } } },
    });
    expect(a.sent[1]).toEqual(['POST', 'api/gateway/automations/auto1/commands', expect.objectContaining({ type: 'automation.pause', payload: {} })]);
    expect(a.sent[2][2]).toMatchObject({ type: 'automation.resume' });
    expect(linkedStatusWords(linked)).toBe('On');
    expect(linkedStatusWords({ ...linked, status: 'paused' })).toBe('Off (paused)');
  });

  it('Turn it on never creates a second automation for a flow that has one (the toolbar checks first)', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../components/Toolbar.tsx', import.meta.url), 'utf8');
    const body = src.slice(src.indexOf('const turnOn = useCallback('), src.indexOf('const setLinkedOn = useCallback('));
    expect(body.indexOf('findFlowAutomation(id')).toBeGreaterThan(-1);
    expect(body.indexOf('findFlowAutomation(id')).toBeLessThan(body.indexOf('turnOnAutomation({'));
    expect(body).toContain('updateFlowAutomation(linked');
    expect(body).toContain('browserMemory.set(id, on.automationId)');
  });
});
