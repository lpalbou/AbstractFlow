import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { applyTheme } from '@abstractframework/ui-kit';
import { FlowLibraryModal } from '../components/FlowLibraryModal';
import { listBundledFlows } from '../utils/bundledFlows';
import type { VisualFlow } from '../types/flow';
import '@abstractframework/ui-kit/theme.css';
import '../styles/index.css';

/**
 * Dev-only harness: renders the Flow Library modal with the bundled dp-
 * family plus synthetic pathological fixtures (shared helper, recursion,
 * dangling ref), driven by URL params so chrome-headless screenshots can
 * iterate on every state without click automation.
 *
 * Params: ?view=all|executable  &q=<query>  &expand=id1,id2  &select=<id>
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
  } = {}
): VisualFlow {
  return {
    id,
    name: options.name ?? id,
    description: options.description,
    interfaces: options.interfaces,
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

const fixtures: VisualFlow[] = [
  ...listBundledFlows(),
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
  // The operator's live-library confusion case: SAVED iteration copies that
  // share the canonical bundled flow's name (three dp-research rows). Rows
  // must self-disambiguate with the short id.
  syntheticFlow('e31bd652', {
    name: 'dp-research',
    refs: ['dp-investigate', 'dp-plan', 'dp-render', 'dp-review'],
    updated: '2026-06-28T15:47:07Z',
  }),
  syntheticFlow('ec83cf80', {
    name: 'dp-research',
    refs: ['dp-investigate', 'dp-plan', 'dp-render', 'dp-review'],
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
const view = params.get('view') === 'executable' ? 'executable' : 'all';
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
      bundledRunTargetIds={['dp-research', '81795ea9']}
      onClose={() => undefined}
      onLoadFlow={() => undefined}
      onRenameFlow={() => undefined}
      onUpdateDescription={() => undefined}
      onUpdateInterfaces={() => undefined}
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
  if (view === 'executable') {
    const buttons = Array.from(document.querySelectorAll('.flow-library-view-option'));
    (buttons[1] as HTMLButtonElement | undefined)?.click();
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
    const row = document.querySelector(`[data-flow-id="${CSS.escape(id)}"] .flow-library-disclosure`);
    (row as HTMLButtonElement | null)?.click();
  }
  if (select) {
    const row = document.querySelector(`[data-flow-id="${CSS.escape(select)}"]`);
    (row as HTMLElement | null)?.click();
  }
  document.body.dataset.previewReady = 'true';
}, 250);
