import { describe, expect, it } from 'vitest';
import { getBundledRunTarget, listBundledFlows, mergeFlowCatalogs } from './bundledFlows';

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
