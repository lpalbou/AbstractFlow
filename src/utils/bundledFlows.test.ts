import { describe, expect, it } from 'vitest';
import { getBundledRunTarget, listBundledFlows, mergeFlowCatalogs } from './bundledFlows';

describe('bundled deep research flows', () => {
  it('loads the shipped dp workflow family', () => {
    const flows = listBundledFlows();
    const ids = flows.map((flow) => flow.id);

    expect(ids).toEqual(
      expect.arrayContaining(['dp-plan', 'dp-investigate', 'dp-review', 'dp-render', 'dp-research'])
    );
    expect(flows.find((flow) => flow.id === 'dp-research')?.nodes.length).toBeGreaterThan(0);
    expect(getBundledRunTarget('dp-research')).toEqual({
      flowId: 'dp-research',
      bundleId: 'dp-research',
      // 0.1.4 = branded exports + derived report titles.
      bundleVersion: '0.1.4',
      bundleRef: 'dp-research@0.1.5',
    });
    // The rename wave: ids stay dp-* (wiring), display names read deep-research*.
    expect(flows.find((flow) => flow.id === 'dp-research')?.name).toBe('deep-research');
    expect(flows.find((flow) => flow.id === 'dp-plan')?.name).toBe('deep-research-plan');
  });

  it('lets saved gateway flows override bundled entries', () => {
    const bundled = listBundledFlows();
    const root = bundled.find((flow) => flow.id === 'dp-research');

    expect(root).toBeTruthy();

    const catalog = mergeFlowCatalogs(
      root
        ? [
            {
              ...root,
              name: 'Saved dp-research',
            },
          ]
        : [],
      bundled
    );

    expect(catalog.flows.find((flow) => flow.id === 'dp-research')?.name).toBe('Saved dp-research');
    expect(catalog.bundledFlowIds).not.toContain('dp-research');
    expect(catalog.bundledRunTargetIds).not.toContain('dp-research');
  });

  it('marks unsaved dp-research as a runnable bundled workflow family', () => {
    const catalog = mergeFlowCatalogs([], listBundledFlows());

    expect(catalog.bundledFlowIds).toContain('dp-research');
    expect(catalog.bundledRunTargetIds).toContain('dp-research');
  });
});
