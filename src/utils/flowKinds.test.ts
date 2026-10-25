// The Flow Library's kinds (operator 2026-10-25: "a person sees at a glance
// which flows are which"): Chat / Scheduled / Triggered / Other, by what
// starts a flow, the filter counts, and the All view's kind headings.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { AutomationDefaults, VisualFlow } from '../types/flow';
import { buildFlowFamilyIndex } from './flowFamilies';
import { buildLibraryRows, type LibraryViewMode } from './flowLibraryRows';
import {
  FLOW_KINDS,
  FLOW_KIND_WORDS,
  flowKind,
  flowKindCounts,
  flowStartHelp,
  flowStartSentence,
  libraryCountsSentence,
  nameList,
} from './flowKinds';
import { FlowLibraryModal } from '../components/FlowLibraryModal';
import { formatRowDate } from '../components/FlowLibraryList';

function automation(source_id: string, source_version: number, config: Record<string, unknown>, connection_id?: string): AutomationDefaults {
  return {
    schema_version: 1,
    trigger: { source_id, source_version, config, ...(connection_id ? { connection_id } : {}) },
    context: { mode: 'independent' },
    input_data: {},
  } as AutomationDefaults;
}

function flow(
  id: string,
  options: { interfaces?: string[]; refs?: string[]; automation?: AutomationDefaults; description?: string; updated?: string } = {}
): VisualFlow {
  return {
    id,
    name: id,
    description: options.description,
    interfaces: options.interfaces,
    ...(options.automation ? { automation_defaults: options.automation } : {}),
    updated_at: options.updated,
    nodes: (options.refs || []).map((target, index) => ({
      id: `${id}-sub-${index}`,
      type: 'subflow',
      position: { x: 0, y: 0 },
      data: { nodeType: 'subflow', label: 'Subflow', subflowId: target, inputs: [], outputs: [] },
    })) as unknown as VisualFlow['nodes'],
    edges: [],
  } as VisualFlow;
}

const AGENT = 'abstractcode.agent.v1';
const daily = automation('schedule', 2, { kind: 'daily', at: '08:00', time_zone: 'Europe/Paris' });

// Every kind, a legacy schedule, each trigger, a subflow and a draft.
const catalog: VisualFlow[] = [
  flow('assistant', { interfaces: [AGENT], refs: ['helper'], updated: '2026-10-20T10:00:00Z' }),
  flow('morning-brief', { automation: daily, updated: '2026-10-25T07:00:00Z' }),
  flow('old-hourly', { automation: automation('schedule', 1, { every: '1h' }), updated: '2026-01-01T00:00:00Z' }),
  flow('mail-triage', { automation: automation('email.received', 1, { account: 'default' }), updated: '2026-10-24T00:00:00Z' }),
  flow('release-notes', { automation: automation('feed.item', 1, {}, 'conn-1'), updated: '2026-10-23T00:00:00Z' }),
  flow('cleanup', { automation: automation('manual', 1, {}), updated: '2026-10-22T00:00:00Z' }),
  // Interface AND automation defaults: the automation wins (as the editor's header badge says).
  flow('chat-turned-automation', { interfaces: [AGENT], automation: daily, updated: '2026-10-21T00:00:00Z' }),
  flow('helper', { description: 'Formats the answer.' }),
  flow('draft', { updated: '2026-10-19T00:00:00Z' }),
];
const index = buildFlowFamilyIndex(catalog);
const rowsFor = (viewMode: LibraryViewMode, extra: { query?: string; collapsed?: string[] } = {}) =>
  buildLibraryRows(catalog, index, {
    query: extra.query || '',
    viewMode,
    sortMode: 'name_asc',
    expandedIds: new Set(),
    collapsedGroups: new Set(extra.collapsed as never[]),
  });

describe('flow kinds', () => {
  it('classifies a flow by what starts it', () => {
    const kinds = Object.fromEntries(catalog.map((f) => [f.id, flowKind(f)]));
    expect(kinds).toEqual({
      assistant: 'chat',
      'morning-brief': 'scheduled',
      'old-hourly': 'scheduled',
      'mail-triage': 'triggered',
      'release-notes': 'triggered',
      cleanup: 'triggered',
      'chat-turned-automation': 'scheduled',
      helper: 'other',
      draft: 'other',
    });
  });

  it('counts every flow once, subflows included, and says the counts in words', () => {
    const counts = flowKindCounts(catalog);
    expect(counts).toEqual({ chat: 1, scheduled: 3, triggered: 3, other: 2 });
    expect(FLOW_KINDS.reduce((sum, kind) => sum + counts[kind], 0)).toBe(catalog.length);
    expect(libraryCountsSentence(catalog.length, counts)).toBe('9 flows: 1 chat, 3 scheduled, 3 triggered and 2 other');
    expect(libraryCountsSentence(2, { chat: 2, scheduled: 0, triggered: 0, other: 0 })).toBe('2 flows: 2 chat');
    expect(libraryCountsSentence(0, { chat: 0, scheduled: 0, triggered: 0, other: 0 })).toBe('0 flows');
  });

  it('says what starts each flow in words', () => {
    const byId = new Map(catalog.map((f) => [f.id, f]));
    const say = (id: string, usedBy: string[] = []) => flowStartSentence(byId.get(id)!, {}, usedBy);
    expect(say('assistant')).toBe('Runs when you ask');
    expect(say('morning-brief')).toBe('Every day at 08:00 (Paris)');
    expect(say('old-hourly')).toBe('Every hour');
    expect(say('mail-triage')).toBe('When mail arrives in your main mailbox');
    expect(say('release-notes')).toBe('When a feed has a new item');
    expect(say('cleanup')).toBe('By hand (Run now)');
    expect(say('helper', ['assistant'])).toBe('Runs inside assistant');
    expect(say('helper', ['a', 'b', 'c'])).toBe('Runs inside a and 2 others');
    expect(say('draft')).toBe('Nothing starts it yet');
    expect(nameList(['a', 'b'])).toBe('a and b');
    expect(flowStartHelp(byId.get('cleanup')!)).toBe('Runs only when someone presses Run now in Observer or the Assistant.');
    expect(flowStartHelp(byId.get('mail-triage')!)).toMatch(/new message lands in that mailbox/);
    expect(flowStartHelp(byId.get('helper')!, ['assistant'])).toMatch(/step of the flows that use it/);
  });

  it('All: one heading per kind in order, first-level rows below, subflows counted as nested', () => {
    const result = rowsFor('all');
    const outline = result.rows.map((row) => (row.kind === 'group' ? `#${row.group}:${row.groupCount}` : row.flow?.id));
    expect(outline).toEqual([
      '#chat:1',
      'assistant',
      '#scheduled:3',
      'chat-turned-automation',
      'morning-brief',
      'old-hourly',
      '#triggered:3',
      'cleanup',
      'mail-triage',
      'release-notes',
      '#other:1',
      'draft',
    ]);
    // The helper lives only inside "assistant": the Other heading says so.
    expect(result.rows.find((row) => row.group === 'other')?.groupNested).toBe(1);
    expect(result.rows.find((row) => row.group === 'chat')?.groupNested).toBeUndefined();
  });

  it('All: a folded heading hides its rows and keeps the others', () => {
    const result = rowsFor('all', { collapsed: ['scheduled', 'triggered'] });
    expect(result.rows.map((row) => (row.kind === 'group' ? `#${row.group}${row.groupCollapsed ? '-' : '+'}` : row.flow?.id))).toEqual([
      '#chat+',
      'assistant',
      '#scheduled-',
      '#triggered-',
      '#other+',
      'draft',
    ]);
  });

  it('a kind filter lists exactly as many flows as its pill counts, with no headings', () => {
    const counts = flowKindCounts(catalog);
    for (const kind of FLOW_KINDS) {
      const result = rowsFor(kind);
      expect(result.rows.some((row) => row.kind === 'group'), kind).toBe(false);
      const flowsListed = result.rows.filter((row) => row.depth === 0 && row.flow).map((row) => row.flow!.id);
      expect(flowsListed.length, kind).toBe(counts[kind]);
      expect(flowsListed.every((id) => flowKind(catalog.find((f) => f.id === id)!) === kind), kind).toBe(true);
    }
    // The subflow is listed under Other with where it lives.
    const helper = rowsFor('other').rows.find((row) => row.flow?.id === 'helper');
    expect(helper?.contextParents).toEqual(['assistant']);
    // The chat flow keeps its family expander in its own filter.
    expect(rowsFor('chat').rows[0]).toMatchObject({ key: 'assistant', expandable: true, familySize: 1 });
  });

  it('search: grouped by kind in All, flat in a kind filter', () => {
    const all = rowsFor('all', { query: 'mail' });
    expect(all.rows.map((row) => (row.kind === 'group' ? `#${row.group}` : row.flow?.id))).toEqual(['#triggered', 'mail-triage']);
    const filtered = rowsFor('scheduled', { query: 'mail' });
    expect(filtered.rows).toEqual([]);
    const helper = rowsFor('all', { query: 'formats' });
    expect(helper.rows.map((row) => (row.kind === 'group' ? `#${row.group}` : row.flow?.id))).toEqual(['#other', 'helper']);
  });

  it('rows date quietly: today with its time, else the day, the year only when it differs', () => {
    const now = new Date('2026-10-25T18:00:00');
    expect(formatRowDate('2026-10-25T08:10:00', now)).toMatch(/^Today /);
    expect(formatRowDate('2026-10-20T08:10:00', now)).not.toMatch(/2026|Today/);
    expect(formatRowDate('2025-10-20T08:10:00', now)).toMatch(/2025/);
    expect(formatRowDate('', now)).toBe('');
    expect(formatRowDate('not a date', now)).toBe('');
  });

  it('the library shows the kind pills with their counts and the kind headings', () => {
    const html = renderToStaticMarkup(
      createElement(FlowLibraryModal, {
        isOpen: true,
        currentFlowId: null,
        flows: catalog,
        onClose: () => undefined,
        onLoadFlow: () => undefined,
        onRenameFlow: () => undefined,
        onUpdateDescription: () => undefined,
        onUpdateInterfaces: () => undefined,
        onUpdateAutomationDefaults: () => undefined,
        gatewayContracts: null,
        onDuplicateFlow: () => undefined,
        onDeleteFlow: () => undefined,
      })
    );
    expect(html).toContain('9 flows: 1 chat, 3 scheduled, 3 triggered and 2 other');
    const pills = Array.from(html.matchAll(/class="flow-library-kind-pill[^"]*"[^>]*data-kind="(all|chat|scheduled|triggered|other)"[^>]*>(.*?)<\/button>/g)).map(
      (m) => `${m[1]}=${m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()}`
    );
    expect(pills).toEqual(['all=All 9', 'chat=Chat 1', 'scheduled=Scheduled 3', 'triggered=Triggered 3', 'other=Other 2']);
    for (const kind of FLOW_KINDS) expect(html).toContain(`data-group="${kind}"`);
    expect(html).toContain(FLOW_KIND_WORDS.other.about);
    expect(html).toContain('Every day at 08:00 (Paris)');
    expect(html).toContain('By hand (Run now)');
    // The old All | Runnable toggle and its badge are gone.
    expect(html).not.toMatch(/flow-library-view-toggle|>runnable</);
  });
});
