// UX review #20: "the new flow does nothing and says nothing". A new
// automation flow is wired to run as is: On Flow Start → Agent (the task and
// what arrived) → On Flow End, with a note saying what to do next.
import { describe, expect, it } from 'vitest';
import { useFlowStore } from '../hooks/useFlow';
import { NEW_ITEMS_TEMPLATE, automationNextNote } from './automationScaffold';
import { validateConnection } from './validation';
import type { AutomationDefaults } from '../types/flow';

function automation(trigger: AutomationDefaults['trigger']): AutomationDefaults {
  return { schema_version: 1, trigger, context: { mode: 'independent' }, input_data: {} };
}

function create(trigger: AutomationDefaults['trigger']) {
  useFlowStore.getState().createFlow({ name: 'Release digest', description: '', interfaces: ['abstractcode.agent.v1'], automation: automation(trigger) });
  const st = useFlowStore.getState();
  const byType = (t: string) => st.nodes.filter((n) => n.data.nodeType === t);
  const wire = (from: string, handle: string, to: string, target: string) =>
    st.edges.some((e) => e.source === from && e.sourceHandle === handle && e.target === to && e.targetHandle === target);
  return { st, byType, wire };
}

describe('a new automation flow runs as is', () => {
  it('feed: start → Agent → end; the Agent gets the task and the new items through "New items"', () => {
    const { st, byType, wire } = create({ source_id: 'feed.item', source_version: 1, config: {}, connection_id: 'conn_feed1' });
    const [start] = byType('on_flow_start');
    const [agent] = byType('agent');
    const [end] = byType('on_flow_end');
    const [template] = byType('string_template');
    const trigger = st.nodes.find((n) => n.data.label === 'Trigger event')!;
    expect(wire(start.id, 'exec-out', agent.id, 'exec-in')).toBe(true);
    expect(wire(agent.id, 'exec-out', end.id, 'exec-in')).toBe(true);
    expect(wire(start.id, 'prompt', template.id, 'task')).toBe(true);
    expect(wire(trigger.id, 'data.events', template.id, 'items')).toBe(true);
    expect(wire(template.id, 'result', agent.id, 'prompt')).toBe(true);
    for (const pin of ['provider', 'model']) expect(wire(start.id, pin, agent.id, pin)).toBe(true);
    for (const pin of ['response', 'success', 'meta']) expect(wire(agent.id, pin, end.id, pin)).toBe(true);
    expect(template.data.label).toBe('New items');
    expect(template.data.pinDefaults?.template).toBe(NEW_ITEMS_TEMPLATE);
    // Every wire is one the editor itself would accept.
    for (const e of st.edges) {
      expect(validateConnection(st.nodes, st.edges.filter((x) => x !== e), { source: e.source, sourceHandle: e.sourceHandle ?? null, target: e.target, targetHandle: e.targetHandle ?? null }), JSON.stringify(e)).toBe(true);
    }
    expect(st.canvasNote).toBe('Next: tell the Agent what to do with the new items under Automation → What each run is asked to do.');
  });

  it('mail: the messages (data) reach the Agent; schedule: the task goes straight to the Agent', () => {
    const mail = create({ source_id: 'email.received', source_version: 1, config: { account: 'default' } });
    const trigger = mail.st.nodes.find((n) => n.data.label === 'Trigger event')!;
    const [template] = mail.byType('string_template');
    expect(mail.wire(trigger.id, 'data', template.id, 'items')).toBe(true);
    const schedule = create({ source_id: 'schedule', source_version: 2, config: { kind: 'daily', at: '08:00', time_zone: 'UTC' } });
    const [start] = schedule.byType('on_flow_start');
    const [agent] = schedule.byType('agent');
    expect(schedule.byType('string_template')).toHaveLength(0);
    expect(schedule.wire(start.id, 'prompt', agent.id, 'prompt')).toBe(true);
    expect(schedule.st.canvasNote).toBe(automationNextNote('none'));
  });

  it('the note is dismissible and never on a chat flow or a loaded flow', () => {
    create({ source_id: 'manual', source_version: 1, config: {} });
    useFlowStore.getState().setCanvasNote(null);
    expect(useFlowStore.getState().canvasNote).toBeNull();
    useFlowStore.getState().createFlow({ name: 'Chat', description: '', interfaces: ['abstractcode.agent.v1'] });
    expect(useFlowStore.getState().canvasNote).toBeNull();
    expect(useFlowStore.getState().nodes.some((n) => n.data.nodeType === 'agent')).toBe(false);
  });
});
