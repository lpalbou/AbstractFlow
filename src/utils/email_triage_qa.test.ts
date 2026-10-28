// QA 2026-10-28 (c), the operator's library flow "email-triage" (fixture: the
// saved flow, its mailbox renamed). Reproduced through AbstractRuntime with 5
// emails, 2 important: Add to List / Get Variable / Array Length were right
// (triage held 2), but Compare had no operator set, so it ran `==`:
// `len(triage) == 0` is false when emails are important, and the run ended
// through "No important emails detected". The folded Compare showed "=?", so
// the `==` was invisible. And the run's outcome carried `notify: null` from an
// unwired older-flow notify pin, which After the run read as "the title was
// empty" although Notify me was never reached.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { VisualFlow } from '../types/flow';
import { fromVisualFlow, toVisualFlow } from './serialization';
import { operatorSymbol } from './operatorNodes';
import { quietSentence } from './afterTheRun';
import { nodeHelp } from './nodeHelp';

const flow = JSON.parse(readFileSync(new URL('./__fixtures__/email_triage_qa.json', import.meta.url), 'utf8')) as VisualFlow;

describe('email-triage (QA 2026-10-28)', () => {
  const { nodes, edges } = fromVisualFlow(flow);
  const byId = (id: string) => nodes.find((n) => n.id === id)!;

  it('the folded Compare shows the operator it runs (==), not "=?"', () => {
    const compare = byId('node-23');
    expect(compare.data.nodeType).toBe('compare');
    expect(compare.data.collapsed).toBe(true);
    expect(compare.data.pinDefaults?.op).toBeUndefined();
    expect(operatorSymbol(compare.data)).toBe('==');
    expect(nodeHelp(compare.data).details.join(' ')).toContain('With no operator chosen it compares with ==');
  });

  it('both On Flow End lose their inert notify pin, so the outcome no longer carries notify: null', () => {
    for (const id of ['node-2', 'node-25']) {
      expect(flow.nodes.find((n) => n.id === id)!.data.inputs.some((p) => p.id === 'notify')).toBe(true);
      expect(byId(id).data.inputs.map((p) => p.id)).not.toContain('notify');
    }
    const saved = toVisualFlow('email-triage', 'email-triage', nodes, edges);
    for (const id of ['node-2', 'node-25']) {
      expect(saved.nodes.find((n) => n.id === id)!.data.inputs.map((p) => p.id)).toEqual(['exec-in', 'response', 'success']);
    }
    // Notify me's title is the saved one, untouched.
    expect(byId('node-19').data.pinDefaults?.title).toBe('Emails requiring your attension');
  });

  it('After the run says Notify me was not reached, never only "the title was empty"', () => {
    expect(quietSentence('empty title')).toContain('the run did not reach a Notify me step');
    expect(quietSentence('no notify')).toBe('Nothing to notify: the run did not reach a Notify me step.');
  });
});
