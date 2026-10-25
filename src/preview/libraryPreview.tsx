import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { applyTheme } from '@abstractframework/ui-kit';
import { FlowLibraryModal } from '../components/FlowLibraryModal';
import { listBundledFlows } from '../utils/bundledFlows';
import type { VisualFlow } from '../types/flow';
import '@abstractframework/ui-kit/theme.css';
import '../styles/index.css';
// The app's stylesheet stack (main.tsx order): category hues, then the
// narrow / touch adaptations, so the harness renders as the editor does.
import '../styles/categories.css';
import '../styles/responsive.css';
import '../styles/space.css';

/**
 * Dev-only harness: renders the Flow Library modal with the bundled deep-research
 * family plus synthetic pathological fixtures (shared helper, recursion,
 * dangling ref), driven by URL params so chrome-headless screenshots can
 * iterate on every state without click automation.
 *
 * Params: ?view=all|chat|scheduled|triggered|other  &q=<query>  &expand=id1,id2
 *         &select=<id>  &collapse=kind1,kind2  &theme=<id>
 * Served by `vite dev` only (root html entries are not part of the build).
 */

function syntheticFlow(
  id: string,
  options: {
    name?: string;
    interfaces?: string[];
    refs?: string[];
    description?: string;
    updated?: string;
    automation?: VisualFlow['automation_defaults'];
  } = {}
): VisualFlow {
  return {
    id,
    name: options.name ?? id,
    description: options.description,
    interfaces: options.interfaces,
    ...(options.automation ? { automation_defaults: options.automation } : {}),
    updated_at: options.updated ?? '2026-07-11T10:00:00Z',
    nodes: (options.refs || []).map((target, index) => ({
      id: `${id}-sub-${index}`,
      type: 'subflow',
      position: { x: 0, y: 0 },
      data: { nodeType: 'subflow', label: 'Subflow', subflowId: target, inputs: [], outputs: [] },
    })) as unknown as VisualFlow['nodes'],
    edges: [],
  } as VisualFlow;
}

/** Automation defaults for the Scheduled / Triggered fixtures. */
function automation(source_id: string, source_version: number, config: Record<string, unknown>, connection_id?: string): VisualFlow['automation_defaults'] {
  return {
    schema_version: 1,
    trigger: { source_id, source_version, config, ...(connection_id ? { connection_id } : {}) },
    context: { mode: 'independent' },
    input_data: {},
  } as VisualFlow['automation_defaults'];
}

const fixtures: VisualFlow[] = [
  ...listBundledFlows(),
  // One flow of each start (the library's kinds): a schedule, mail, a feed, Run now.
  syntheticFlow('morning-brief', {
    name: 'Morning brief',
    description: 'Reads the overnight news and writes a five-line brief.',
    automation: automation('schedule', 2, { kind: 'daily', at: '08:00', time_zone: 'Europe/Paris' }),
    updated: '2026-10-25T07:10:00Z',
  }),
  syntheticFlow('weekly-review', {
    name: 'Weekly review',
    description: 'Summarises the week’s runs every Friday.',
    automation: automation('schedule', 2, { kind: 'weekly', days: ['fri'], at: '17:30', time_zone: 'Europe/Paris' }),
    updated: '2026-10-20T16:00:00Z',
  }),
  syntheticFlow('mail-triage', {
    name: 'Mail triage',
    description: 'Sorts each new message and drafts a reply when one is needed.',
    automation: automation('email.received', 1, { account: 'default' }),
    updated: '2026-10-24T12:00:00Z',
  }),
  syntheticFlow('release-notes', {
    name: 'Release notes reviewer',
    description: 'Reviews every new release note of the feed.',
    automation: automation('feed.item', 1, {}, 'conn-release'),
    updated: '2026-10-22T09:30:00Z',
  }),
  syntheticFlow('cleanup-by-hand', {
    name: 'Workspace cleanup',
    description: 'Archives old runs. Only when someone presses Run now.',
    automation: automation('manual', 1, {}),
    updated: '2026-10-18T11:00:00Z',
  }),
  syntheticFlow('report-pipeline', {
    name: 'report-pipeline',
    interfaces: ['abstractcode.agent.v1'],
    refs: ['shared-formatter', 'ghost-flow'],
    description: 'Generates a weekly report; shares the formatter helper with sentiment-batch.',
    updated: '2026-07-12T08:30:00Z',
  }),
  syntheticFlow('sentiment-batch', {
    name: 'sentiment-batch',
    refs: ['shared-formatter'],
    description: 'Scores a batch of texts and renders a summary table.',
    updated: '2026-07-10T18:12:00Z',
  }),
  syntheticFlow('shared-formatter', {
    name: 'shared-formatter',
    description: 'Markdown table formatter used by several parents.',
  }),
  syntheticFlow('ralph-recursive', {
    name: 'ralph-recursive',
    interfaces: ['abstractcode.agent.v1'],
    refs: ['ralph-recursive'],
    description: 'Self-referencing agent (recursion with a base case).',
  }),
  syntheticFlow('scratch-note', { name: 'scratch-note' }),
  // Pathological renderers must be screenshotable (adversary J13):
  // an interface-less mutual cycle and a double-reference parent.
  syntheticFlow('cycle-a', { name: 'cycle-a', refs: ['cycle-b'], description: 'Half of a mutual reference cycle.' }),
  syntheticFlow('cycle-b', { name: 'cycle-b', refs: ['cycle-a'], description: 'Other half of a mutual reference cycle.' }),
  syntheticFlow('double-ref-parent', {
    name: 'double-ref-parent',
    refs: ['shared-formatter', 'shared-formatter'],
    description: 'References the formatter twice (multiplicity badge case).',
  }),
  // The operator's live-library confusion case (historical): SAVED iteration
  // copies sharing one name — the live store carried two June-28 deep-research
  // snapshots beside the bundled root before the 2026-07-13 cleanup (the
  // bundled root is now NAMED deep-research, so these two synthetic rows are
  // the remaining same-name pair). Rows must self-disambiguate with the
  // short id; that behavior is what this fixture pins.
  syntheticFlow('e31bd652', {
    name: 'deep-research',
    refs: ['deep-investigate', 'deep-plan', 'deep-render', 'deep-review'],
    updated: '2026-06-28T15:47:07Z',
  }),
  syntheticFlow('ec83cf80', {
    name: 'deep-research',
    refs: ['deep-investigate', 'deep-plan', 'deep-render', 'deep-review'],
    updated: '2026-06-28T14:59:45Z',
  }),
];
// A duplicated ref in the fixtures collapses in flowRefs (a Set); force the
// multiplicity case with two distinct subflow NODES targeting one id.
{
  const parent = fixtures[fixtures.length - 1];
  parent.nodes = [0, 1].map((index) => ({
    id: `double-ref-parent-sub-${index}`,
    type: 'subflow',
    position: { x: 0, y: 0 },
    data: { nodeType: 'subflow', label: 'Subflow', subflowId: 'shared-formatter', inputs: [], outputs: [] },
  })) as unknown as VisualFlow['nodes'];
}

const params = new URLSearchParams(window.location.search);
const view = params.get('view') || 'all';
const collapse = (params.get('collapse') || '').split(',').filter(Boolean);
const query = params.get('q') || '';
const expand = (params.get('expand') || '').split(',').filter(Boolean);
const select = params.get('select') || null;
applyTheme(params.get('theme') || 'dark');

function Harness() {
  return (
    <FlowLibraryModal
      isOpen
      currentFlowId={select}
      flows={fixtures}
      readonlyFlowIds={listBundledFlows().map((flow) => flow.id)}
      bundledRunTargetIds={['deep-research', '81795ea9']}
      onClose={() => undefined}
      onLoadFlow={() => undefined}
      onRenameFlow={() => undefined}
      onUpdateDescription={() => undefined}
      onUpdateInterfaces={() => undefined}
      onUpdateAutomationDefaults={() => undefined}
      gatewayContracts={null}
      onDuplicateFlow={() => undefined}
      onDeleteFlow={() => undefined}
    />
  );
}

const root = createRoot(document.getElementById('root') as HTMLElement);
root.render(
  <StrictMode>
    <Harness />
  </StrictMode>
);

// Apply URL-driven state AFTER first paint: the modal owns view/query/expand
// state internally, so the harness drives it through the real DOM controls
// (the same paths a user exercises).
window.setTimeout(() => {
  if (view !== 'all') {
    (document.querySelector(`.flow-library-kind-pill[data-kind="${CSS.escape(view)}"]`) as HTMLButtonElement | null)?.click();
  }
  for (const kind of collapse) {
    (document.querySelector(`.flow-library-group[data-group="${CSS.escape(kind)}"]`) as HTMLButtonElement | null)?.click();
  }
  if (query) {
    const input = document.querySelector('.flow-library-search') as HTMLInputElement | null;
    if (input) {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
      setter?.call(input, query);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }
  for (const id of expand) {
    // The list is the uic kit DisclosureList: the chevron is the kit's
    // .af-disclosure__chevron sitting BESIDE the renderRow content, so walk
    // up from the data-flow-id row body to the kit row first.
    const body = document.querySelector(`[data-flow-id="${CSS.escape(id)}"]`);
    const kitRow = body?.closest('.af-disclosure__row');
    (kitRow?.querySelector('.af-disclosure__chevron') as HTMLButtonElement | null)?.click();
  }
  if (select) {
    const row = document.querySelector(`[data-flow-id="${CSS.escape(select)}"]`);
    (row as HTMLElement | null)?.click();
  }
  document.body.dataset.previewReady = 'true';
}, 250);
