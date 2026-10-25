// The gateway console's Triggers page links a trigger row to Flow:
// `?trigger=<connection id>` (feed / webhook) or `?trigger=mail:<mailbox id>`
// opens New flow with What starts it? on that trigger (docs/web-editor.md).
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  TRIGGER_LINK_MISSING_ID,
  parseTriggerLink,
  resolveTriggerLink,
  triggerNotFoundLine,
  withoutTriggerParam,
  type TriggerLink,
} from './triggerDeepLink';
import { parseMailboxes } from './automationGateway';
import { parseTriggerSourcesResponse } from './triggerSources';
import { parseTriggerConnectionsResponse } from './triggerConnections';
import { CONNECTIONS_RESPONSE, LIVE_SOURCES_RESPONSE, ME_EMAIL_RESPONSE } from './triggerSources.fixtures';
import { TriggerPicker, pickerSupport } from '../components/automation/TriggerPicker';
import type { AutomationFacts } from '../components/automation/useAutomationFacts';

const FACTS: Pick<AutomationFacts, 'sources' | 'mailboxes' | 'connections'> = {
  sources: { state: 'ok', value: { status: 'ok', endpoint: 'api/gateway/triggers/sources', items: parseTriggerSourcesResponse(LIVE_SOURCES_RESPONSE) } },
  mailboxes: { state: 'ok', value: { status: 'ok', mailboxes: parseMailboxes(ME_EMAIL_RESPONSE) } },
  connections: { state: 'ok', value: { status: 'ok', connections: parseTriggerConnectionsResponse(CONNECTIONS_RESPONSE) } },
};
const LOADING = { state: 'loading' } as const;

function link(search: string): TriggerLink {
  const out = parseTriggerLink(search);
  if (!out || 'error' in out) throw new Error(`not a trigger link: ${search}`);
  return out;
}

describe('?trigger= parsing', () => {
  it('a connection id, or mail:<mailbox id>', () => {
    expect(parseTriggerLink('?trigger=conn_feed1')).toEqual({ kind: 'connection', connectionId: 'conn_feed1', raw: 'conn_feed1' });
    expect(parseTriggerLink('?trigger=mail%3Awork')).toEqual({ kind: 'mail', account: 'work', raw: 'mail:work' });
    expect(parseTriggerLink('?trigger=mail:work&other=1')).toEqual({ kind: 'mail', account: 'work', raw: 'mail:work' });
  });

  it('no parameter is the normal start; an empty one says what it needs', () => {
    expect(parseTriggerLink('')).toBeNull();
    expect(parseTriggerLink('?bundle=b1')).toBeNull();
    expect(parseTriggerLink('?trigger=')).toEqual({ error: TRIGGER_LINK_MISSING_ID });
    expect(parseTriggerLink('?trigger=mail:')).toEqual({ error: TRIGGER_LINK_MISSING_ID });
  });

  it('is removed from the address once consumed (other parameters and the hash kept)', () => {
    expect(withoutTriggerParam('http://127.0.0.1:3005/?trigger=conn_feed1')).toBe('/');
    expect(withoutTriggerParam('http://gw.local/apps/flow/?monitor-gpu=1&trigger=mail%3Awork#x')).toBe('/apps/flow/?monitor-gpu=1#x');
  });

  it('the toolbar consumes it once, after the gateway probe, and opens New flow with it', () => {
    const toolbar = readFileSync(new URL('../components/Toolbar.tsx', import.meta.url), 'utf8');
    const at = toolbar.indexOf('const triggerLinkHandledRef = useRef(false);');
    expect(at).toBeGreaterThan(0);
    const effect = toolbar.slice(at, toolbar.indexOf('}, [gatewayCapabilitiesQuery.isLoading]);', at));
    expect(effect).toContain('gatewayCapabilitiesQuery.isLoading');
    expect(effect).toContain('parseTriggerLink(window.location.search)');
    expect(effect).toContain("window.history.replaceState(window.history.state, '', withoutTriggerParam(window.location.href));");
    expect(effect).toContain('setNewFlowTrigger(link);');
    expect(effect).toContain('setShowNewFlowModal(true);');
    expect(toolbar).toContain('trigger={newFlowTrigger}');
  });
});

describe('preselection from the loaded connections', () => {
  it('a feed connection: picked, titled "<name> digest"', () => {
    const out = resolveTriggerLink(link('?trigger=conn_feed1'), FACTS);
    expect(out).toEqual({ state: 'found', picker: { start: 'arrives', arrival: 'conn:conn_feed1' }, name: 'Release notes feed digest' });
    // The picker shows it checked.
    const html = renderToStaticMarkup(
      createElement(TriggerPicker, { value: out.picker, onChange: () => {}, data: pickerSupport(FACTS).data, includeChat: true, gatewayUrl: '' })
    );
    const checked = Array.from(html.matchAll(/<input type="radio"[^>]*checked=""[^>]*value="([^"]+)"/g)).map((m) => m[1]);
    expect(checked).toEqual(['conn:conn_feed1']);
  });

  it('a mailbox: picked, titled "<address> handling"', () => {
    expect(resolveTriggerLink(link('?trigger=mail:work'), FACTS)).toEqual({
      state: 'found',
      picker: { start: 'arrives', arrival: 'mail:work' },
      name: 'work@example.org handling',
    });
  });

  it('waits for the list it needs, on "When something arrives" with nothing picked', () => {
    expect(resolveTriggerLink(link('?trigger=conn_feed1'), { ...FACTS, connections: LOADING })).toEqual({
      state: 'waiting',
      picker: { start: 'arrives', arrival: '' },
    });
    expect(resolveTriggerLink(link('?trigger=mail:work'), { ...FACTS, mailboxes: LOADING }).state).toBe('waiting');
    expect(resolveTriggerLink(link('?trigger=conn_feed1'), { ...FACTS, sources: LOADING }).state).toBe('waiting');
    // A mailbox link does not wait on the connections list.
    expect(resolveTriggerLink(link('?trigger=mail:work'), { ...FACTS, connections: LOADING }).state).toBe('found');
  });

  it('a list that could not be read is not "not found" (the picker says why)', () => {
    expect(resolveTriggerLink(link('?trigger=conn_feed1'), { ...FACTS, connections: { state: 'error', message: 'boom' } })).toEqual({
      state: 'unreadable',
      picker: { start: 'arrives', arrival: '' },
    });
  });
});

describe('a trigger that is not among the connections', () => {
  it('leaves the picker on "When something arrives" and says so in one line', () => {
    const missing = link('?trigger=conn_gone');
    expect(resolveTriggerLink(missing, FACTS)).toEqual({
      state: 'missing',
      picker: { start: 'arrives', arrival: '' },
      line: 'The trigger conn_gone is not among your connections.',
    });
    expect(triggerNotFoundLine(link('?trigger=mail:nobox'))).toBe('The trigger mail:nobox is not among your connections.');
    expect(resolveTriggerLink(link('?trigger=mail:nobox'), FACTS).state).toBe('missing');
  });

  it('a mailbox that cannot be watched is not preselected either', () => {
    const out = resolveTriggerLink(link('?trigger=mail:outbox'), FACTS);
    expect(out.state).toBe('missing');
    expect('line' in out && out.line).toBe('The trigger mail:outbox cannot start a flow (cannot be watched: it has no incoming server).');
  });

  it('the New flow dialog shows the line under the picker until the picker is changed', () => {
    const dialog = readFileSync(new URL('../components/NewFlowDialog.tsx', import.meta.url), 'utf8');
    expect(dialog).toContain("const linkLine = pickerEdit === null && linked?.state === 'missing' ? linked.line : '';");
    expect(dialog).toContain('{linkLine ? <p className="automation-problem new-flow-link-line">{linkLine}</p> : null}');
    expect(dialog).toContain("const name = nameEdit ?? (linked?.state === 'found' ? linked.name : '');");
  });
});
