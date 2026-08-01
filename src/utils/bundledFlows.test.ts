import { describe, expect, it } from 'vitest';
import { buildFlowFamilyIndex } from './flowFamilies';
import {
  BUNDLED_COMPOSED_ONLY_IDS,
  getBundledRunTarget,
  isLibraryDuplicateCopy,
  listBundledFlows,
  mergeFlowCatalogs,
} from './bundledFlows';

describe('bundled deep research flows', () => {
  it('loads the shipped deep-research workflow family', () => {
    const flows = listBundledFlows();
    const ids = flows.map((flow) => flow.id);

    expect(ids).toEqual(
      expect.arrayContaining(['deep-plan', 'deep-investigate', 'deep-review', 'deep-render', 'deep-research'])
    );
    expect(flows.find((flow) => flow.id === 'deep-research')?.nodes.length).toBeGreaterThan(0);
    expect(getBundledRunTarget('deep-research')).toEqual({
      flowId: 'deep-research',
      bundleId: 'deep-research',
      // 0.1.7 = the 2026-07-20 adversary wave (lineage: 0.1.6 was the deep-* rename release).
      bundleVersion: '0.1.7',
      bundleRef: 'deep-research@0.1.7',
    });
    // 2026-07-16: ids, names, files, and the bundle id are all deep-* (dp- retired).
    expect(flows.find((flow) => flow.id === 'deep-research')?.name).toBe('deep-research');
    expect(flows.find((flow) => flow.id === 'deep-plan')?.name).toBe('deep-research-plan');
  });

  it('lets saved gateway flows override bundled entries', () => {
    const bundled = listBundledFlows();
    const root = bundled.find((flow) => flow.id === 'deep-research');

    expect(root).toBeTruthy();

    const catalog = mergeFlowCatalogs(
      root
        ? [
            {
              ...root,
              name: 'Saved deep-research',
            },
          ]
        : [],
      bundled
    );

    expect(catalog.flows.find((flow) => flow.id === 'deep-research')?.name).toBe('Saved deep-research');
    expect(catalog.bundledFlowIds).not.toContain('deep-research');
    expect(catalog.bundledRunTargetIds).not.toContain('deep-research');
  });

  it('marks unsaved deep-research as a runnable bundled workflow family', () => {
    const catalog = mergeFlowCatalogs([], listBundledFlows());

    expect(catalog.bundledFlowIds).toContain('deep-research');
    expect(catalog.bundledRunTargetIds).toContain('deep-research');
  });
});

describe('bundled multiagent coding flows', () => {
  it('loads the three-flow family with 0.0.16 run targets', () => {
    const flows = listBundledFlows();
    const ids = flows.map((flow) => flow.id);

    expect(ids).toEqual(
      expect.arrayContaining(['multiagent-coding', 'multiagent-coder', 'multiagent-verify-gates'])
    );

    const pin = {
      bundleId: 'multiagent-coding',
      bundleVersion: '0.0.16',
      bundleRef: 'multiagent-coding@0.0.16',
    };
    expect(getBundledRunTarget('multiagent-coding')).toBeNull();
    expect(getBundledRunTarget('multiagent-coder')).toEqual({
      flowId: 'multiagent-coder',
      ...pin,
    });

    const main = flows.find((flow) => flow.id === 'multiagent-coding');
    // THE STATE BLOB IS GONE (0.0.15). Every run var is a flat top-level name:
    // writes are `set_vars` (one node per fold, `updates` = {name: value}) and
    // reads are one `get_var` chip PER VARIABLE, wired to a pin named after it.
    // The graph grew because the dependencies became visible: where sixteen
    // chips all read one opaque `state`, ~80 chips now name the exact variable
    // their consumer uses — which is the whole point ("we never see on the
    // visual authoring which variable is actually used").
    //
    // Counts are LOWER BOUNDS plus exact structural invariants: the family is
    // under concurrent authoring waves, and a magic number that must be edited
    // by every wave is a gate nobody trusts.
    expect(main?.edges.length).toBeGreaterThanOrEqual(200);
    expect(main?.nodes.filter((n) => n.type === 'get_var').length).toBeGreaterThanOrEqual(70);
    // THE ANTI-BLOB INVARIANT, exact: nothing in the family names `state`, and
    // the coding root writes run vars ONLY through `set_vars`.
    const blobNames = flows
      .filter((flow) => flow.id.startsWith('multiagent-'))
      .flatMap((flow) =>
        flow.nodes
          .filter((n) => n.type === 'get_var' || n.type === 'set_var')
          .map((n) => ({
            id: `${flow.id}:${n.id}`,
            name: String(
              (n.data as { pinDefaults?: Record<string, unknown> })?.pinDefaults?.name ?? ''
            ),
          }))
          .filter((entry) => entry.name === 'state' || entry.name.startsWith('state.'))
          .map((entry) => `${entry.id} = ${entry.name}`)
      );
    expect(blobNames).toEqual([]);
    const blobExpressions = flows
      .filter((flow) => flow.id.startsWith('multiagent-'))
      .flatMap((flow) =>
        flow.nodes.flatMap((n) =>
          Object.entries(
            ((n.data as { pinExpressions?: Record<string, string> })?.pinExpressions ||
              {}) as Record<string, string>
          )
            .filter(([, expr]) => /vars\s*[.[]\s*["']?state\b/.test(expr))
            .map(([pinId]) => `${flow.id}:${n.id}.${pinId}`)
        )
      );
    expect(blobExpressions).toEqual([]);
    expect(main?.nodes.filter((n) => n.type === 'set_var')).toEqual([]);
    expect(main?.nodes.filter((n) => n.type === 'set_vars').length).toBe(9);
    // No node takes a `loop_state` container pin any more.
    expect(
      main?.nodes.filter((n) =>
        ((n.data as { inputs?: { id: string }[] })?.inputs || []).some((p) => p.id === 'loop_state')
      )
    ).toEqual([]);
    // Doctrine gate: no `code` node without execution pins.
    expect(
      main?.nodes
        .filter((n) => n.type === 'code')
        .filter((n) => !(n.data?.inputs || []).some((p) => p.type === 'execution'))
    ).toEqual([]);
    // Doctrine gate: no ACCESS expression anywhere in the family — a plain
    // variable read is a Get Variable node, and a field read off a wire is a
    // declared pin upstream (operator ruling 2026-07-30).
    const ACCESS_EXPRESSION =
      /^\s*(vars(\.[A-Za-z_]\w*|\[\s*["'][^"']+["']\s*\])+(\s*\.\s*get\([^()]*\))?|\(\s*value\s+or\s+(\{\}|\[\]|"")\s*\)\s*\.\s*get\([^()]*\))\s*$/;
    const accessExpressions = flows
      .filter((flow) => flow.id.startsWith('multiagent-'))
      .flatMap((flow) =>
        flow.nodes.flatMap((n) =>
          Object.entries(
            ((n.data as { pinExpressions?: Record<string, string> })?.pinExpressions || {}) as Record<
              string,
              string
            >
          )
            .filter(([, expr]) => ACCESS_EXPRESSION.test(expr))
            .map(([pinId, expr]) => `${flow.id}:${n.id}.${pinId} = ${expr}`)
        )
      );
    expect(accessExpressions).toEqual([]);
    // The wrapper is expression-free end to end: the child's four on_flow_end
    // fields are declared output pins on the subflow node and cross on wires.
    const wrapper = flows.find((flow) => flow.id === 'multiagent-coder');
    expect(
      wrapper?.nodes.filter(
        (n) => Object.keys((n.data as { pinExpressions?: object })?.pinExpressions || {}).length > 0
      )
    ).toEqual([]);
    const buildNode = wrapper?.nodes.find((n) => n.id === 'build');
    expect(
      (buildNode?.data?.outputs || []).filter((p) => p.type !== 'execution').map((p) => p.id)
    ).toEqual(['output', 'child_output', 'report', 'success', 'branch', 'stopped_reason']);
    // PINS, NOT BLOBS (operator ruling 2026-07-30: "whenever you are NOT using
    // the pins, it means you are HIDING something"). No subflow node in the
    // family may take a one-object `input` pin when its child's interface is
    // known: every declared input pin must name a real on_flow_start field of
    // the child AND be wired. This is the permanent gate on the SHIPPED
    // bundled JSON, from the app's own side of the fence.
    const family = flows.filter((flow) => flow.id.startsWith('multiagent-'));
    const childStartPins = new Map(
      family.map((flow) => [
        flow.id,
        (flow.nodes.find((n) => n.type === 'on_flow_start')?.data?.outputs || [])
          .filter((p) => p.type !== 'execution')
          .map((p) => p.id),
      ])
    );
    const hiddenContracts = family.flatMap((flow) => {
      const wired = new Set(flow.edges.map((e) => `${e.target} ${e.targetHandle ?? ''}`));
      return flow.nodes
        .filter((n) => n.type === 'subflow')
        .flatMap((n) => {
          const childId = String((n.data as { subflowId?: unknown })?.subflowId ?? '');
          const known = childStartPins.get(childId);
          if (!known) return [];
          const declared = (n.data?.inputs || [])
            .filter((p) => p.type !== 'execution' && p.id !== 'inherit_context')
            .map((p) => p.id);
          return [
            ...(declared.includes('input') ? [`${flow.id}:${n.id} takes one \`input\` object`] : []),
            ...declared
              .filter((p) => !known.includes(p))
              .map((p) => `${flow.id}:${n.id}.${p} is not a field of ${childId}`),
            ...declared
              .filter((p) => !wired.has(`${n.id} ${p}`))
              .map((p) => `${flow.id}:${n.id}.${p} is declared but unwired`),
          ];
        });
    });
    expect(hiddenContracts).toEqual([]);
    // ...and the meta nodes that used to assemble those objects are gone.
    expect(family.flatMap((flow) => flow.nodes.filter((n) => n.type === 'make_object'))).toEqual([]);
    // The wrapper is PURE WIRING: one code node (the dead-child answer floor).
    expect(wrapper?.nodes.filter((n) => n.type === 'code').map((n) => n.id)).toEqual(['answer']);
    expect(main?.name).toContain('main pipeline');
    expect(flows.find((flow) => flow.id === 'multiagent-coder')?.name).toContain('chat entry');
    expect(flows.find((flow) => flow.id === 'multiagent-verify-gates')?.name).toContain('embedded subflow');
  });

  it('surfaces multiagent-coder alone at library top level (composed members fold under it)', () => {
    const flows = listBundledFlows().filter((flow) => flow.id.startsWith('multiagent-'));
    const index = buildFlowFamilyIndex(flows, { composedOnlyIds: BUNDLED_COMPOSED_ONLY_IDS });
    expect(index.firstLevelIds.has('multiagent-coder')).toBe(true);
    expect(index.firstLevelIds.has('multiagent-coding')).toBe(false);
    expect(index.firstLevelIds.has('multiagent-verify-gates')).toBe(false);
    expect(index.familyRootIds.has('multiagent-coder')).toBe(true);
  });

  it('keeps gateway "(copy)" rows visible in merged library catalogs', () => {
    const bundled = listBundledFlows();
    const root = bundled.find((flow) => flow.id === 'deep-research');
    expect(root).toBeTruthy();
    expect(isLibraryDuplicateCopy({ name: 'Multi-agent coding workflow (copy)' })).toBe(true);
    expect(isLibraryDuplicateCopy({ name: 'deep-research' })).toBe(false);

    const catalog = mergeFlowCatalogs(
      [
        { ...(root as NonNullable<typeof root>), name: 'Saved deep-research' },
        {
          id: 'spam-copy',
          name: 'Multi-agent coding workflow (copy)',
          nodes: [],
          edges: [],
        },
      ],
      bundled
    );
    expect(catalog.flows.some((flow) => flow.id === 'spam-copy')).toBe(true);
    expect(catalog.flows.some((flow) => flow.name === 'Saved deep-research')).toBe(true);
  });

  it('marks only multiagent-coder as the bundled run target', () => {
    const catalog = mergeFlowCatalogs([], listBundledFlows());
    expect(catalog.bundledRunTargetIds).toContain('multiagent-coder');
    expect(catalog.bundledRunTargetIds).not.toContain('multiagent-coding');
  });
});
