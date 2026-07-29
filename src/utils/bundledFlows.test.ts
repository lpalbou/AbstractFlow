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
  it('loads the three-flow family with 0.0.12 run targets', () => {
    const flows = listBundledFlows();
    const ids = flows.map((flow) => flow.id);

    expect(ids).toEqual(
      expect.arrayContaining(['multiagent-coding', 'multiagent-coder', 'multiagent-verify-gates'])
    );

    const pin = {
      bundleId: 'multiagent-coding',
      bundleVersion: '0.0.12',
      bundleRef: 'multiagent-coding@0.0.12',
    };
    expect(getBundledRunTarget('multiagent-coding')).toBeNull();
    expect(getBundledRunTarget('multiagent-coder')).toEqual({
      flowId: 'multiagent-coder',
      ...pin,
    });

    const main = flows.find((flow) => flow.id === 'multiagent-coding');
    expect(main?.edges.length).toBe(68);
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
