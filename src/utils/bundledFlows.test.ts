import { describe, expect, it } from 'vitest';
import type { VisualFlow } from '../types/flow';
import { computeRunPreflightIssues } from './preflight';
import { applyInterfacePins, buildFlowFamilyIndex, interfaceBoundaryPins, missingInterfacePins } from './flowFamilies';
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
      // 0.1.8 = the version the gateway ships (a fresh install has no 0.1.7).
      bundleVersion: '0.1.8',
      bundleRef: 'deep-research@0.1.8',
    });
    // 2026-07-16: ids, files, and the bundle id are all deep-* (dp- retired).
    // The root's name is its display name from scripts/workflow_labels.py.
    expect(flows.find((flow) => flow.id === 'deep-research')?.name).toBe('Deep research');
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
    expect(main?.nodes.filter((n) => n.type === 'set_vars').length).toBe(10);
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

describe('bundled flows honour the interfaces they declare', () => {
  it('every On Flow Start / On Flow End of a flow declaring an interface carries its required pins', () => {
    const flows = listBundledFlows();
    const declaring = flows.filter((flow) => {
      const pins = interfaceBoundaryPins(flow.interfaces);
      return pins.start.length + pins.end.length > 0;
    });
    // Guard against a vacuous pass: the shipped catalog declares contracts.
    expect(declaring.length).toBeGreaterThan(10);
    const gaps = declaring.flatMap((flow) => {
      const pins = interfaceBoundaryPins(flow.interfaces);
      const boundary = flow.nodes.filter((n) => n.data?.nodeType === 'on_flow_start' || n.data?.nodeType === 'on_flow_end');
      if (!boundary.some((n) => n.data?.nodeType === 'on_flow_start')) return [`${flow.id}: no On Flow Start`];
      return boundary.flatMap((n) =>
        missingInterfacePins(n.data, pins).map((pin) => `${flow.id}:${n.id} missing ${pin.id} (${pin.interfaceId})`)
      );
    });
    expect(gaps).toEqual([]);
    // Consequently opening a bundled flow never changes its pins.
    for (const flow of declaring) {
      expect(applyInterfacePins(flow.nodes, flow.interfaces)).toBe(flow.nodes);
    }
  });
});

describe('bundled agent.v1 flows use what agent hosts send and read', () => {
  // A flow that never calls an LLM has no use for the host's prompt/provider/
  // model: it is exempt from the `prompt` check instead of being fake-wired
  // (backlog 0890). Each entry says why, and the guard below fails the day
  // such a flow gains an LLM call (in itself or any subflow it runs).
  const NO_LLM_FLOWS = new Map<string, string>([
    ['entity-goodbye', 'folds the session history and runs the session close (summary + diary note): no LLM call'],
  ]);
  const LLM_NODE_TYPES = new Set(['llm_call', 'agent']);

  function callsAnLlm(flowId: string, byId: Map<string, VisualFlow>, seen = new Set<string>()): boolean {
    if (seen.has(flowId)) return false;
    seen.add(flowId);
    const flow = byId.get(flowId);
    if (!flow) throw new Error(`subflow ${flowId} is not in the bundled catalog`);
    return flow.nodes.some((node) => {
      const type = String(node.data?.nodeType || '');
      if (LLM_NODE_TYPES.has(type)) return true;
      const sub = (node.data as { subflowId?: string }).subflowId;
      return type === 'subflow' && typeof sub === 'string' && callsAnLlm(sub, byId, seen);
    });
  }

  it('the no-LLM exemption holds: those flows (and their subflows) call no LLM; the others do', () => {
    const byId = new Map(listBundledFlows().map((flow) => [flow.id, flow] as const));
    for (const id of NO_LLM_FLOWS.keys()) expect(callsAnLlm(id, byId), id).toBe(false);
    // The guard can see an LLM call through a subflow.
    expect(callsAnLlm('entity-chat', byId)).toBe(true);
  });

  it('On Flow Start `prompt` feeds the graph and every On Flow End sets `success`', () => {
    const gaps: string[] = [];
    const agentFlows = listBundledFlows().filter((flow) => (flow.interfaces || []).includes('abstractcode.agent.v1'));
    expect(agentFlows.map((flow) => flow.id)).toContain('deep-research');
    for (const flow of agentFlows) {
      for (const node of flow.nodes) {
        const type = node.data?.nodeType;
        if (type === 'on_flow_start' && !NO_LLM_FLOWS.has(flow.id)) {
          const fed = flow.edges.some((e) => e.source === node.id && e.sourceHandle === 'prompt');
          if (!fed) gaps.push(`${flow.id}:prompt`);
        }
        if (type === 'on_flow_end') {
          const data = node.data as { pinDefaults?: Record<string, unknown>; pinExpressions?: Record<string, unknown> };
          const set =
            flow.edges.some((e) => e.target === node.id && e.targetHandle === 'success') ||
            Object.prototype.hasOwnProperty.call(data.pinDefaults || {}, 'success') ||
            Object.prototype.hasOwnProperty.call(data.pinExpressions || {}, 'success');
          if (!set) gaps.push(`${flow.id}:success`);
        }
      }
    }
    expect(gaps).toEqual([]);
  });

  it('entity-chat and entity-goodbye compute `success` and `meta` (wired, never a constant)', () => {
    for (const id of ['entity-chat', 'entity-goodbye']) {
      const flow = listBundledFlows().find((f) => f.id === id);
      expect(flow, id).toBeTruthy();
      const end = flow!.nodes.find((n) => n.data?.nodeType === 'on_flow_end');
      for (const pin of ['success', 'meta']) {
        const wire = flow!.edges.find((e) => e.target === end!.id && e.targetHandle === pin);
        expect(wire, `${id}:${pin}`).toBeTruthy();
        const source = flow!.nodes.find((n) => n.id === wire!.source);
        expect(source?.data?.nodeType, `${id}:${pin} source`).toBe('code');
      }
    }
  });

  it('run preflight on the wired flows reports no "hosts will read null" end pin', () => {
    const problems: string[] = [];
    for (const id of ['entity-chat', 'entity-goodbye', 'multiagent-coding', 'deep-research']) {
      const flow = listBundledFlows().find((f) => f.id === id);
      expect(flow, id).toBeTruthy();
      const issues = computeRunPreflightIssues(flow!.nodes, flow!.edges, { flowInterfaces: flow!.interfaces });
      for (const issue of issues) if (issue.message.includes('hosts will read null')) problems.push(`${id}: ${issue.nodeId} ${issue.message}`);
    }
    expect(problems).toEqual([]);
  });

  it('every On Flow End of a coding.v1 flow sets `passed` (the verdict; False where no gate ran)', () => {
    const coding = listBundledFlows().filter((flow) => (flow.interfaces || []).includes('abstractcode.coding.v1'));
    expect(coding.map((flow) => flow.id)).toContain('multiagent-coding');
    const gaps: string[] = [];
    for (const flow of coding) {
      for (const node of flow.nodes.filter((n) => n.data?.nodeType === 'on_flow_end')) {
        const data = node.data as { pinDefaults?: Record<string, unknown> };
        const wired = flow.edges.some((e) => e.target === node.id && e.targetHandle === 'passed');
        if (!wired && data.pinDefaults?.passed !== false) gaps.push(`${flow.id}:${node.id}`);
      }
    }
    expect(gaps).toEqual([]);
    const multi = coding.find((flow) => flow.id === 'multiagent-coding')!;
    const passed = multi.edges.find((e) => e.target === 'end' && e.targetHandle === 'passed');
    const chip = multi.nodes.find((n) => n.id === passed?.source);
    expect((chip?.data as { pinDefaults?: Record<string, unknown> })?.pinDefaults?.name).toBe('all_passed');
  });

  it('deep-research researches the host `prompt` when no `request` is given (request still wins)', () => {
    const flow = listBundledFlows().find((f) => f.id === 'deep-research');
    expect(flow).toBeTruthy();
    const edges = flow!.edges;
    const resolve = flow!.nodes.find((n) => n.id === 'resolve_request');
    expect(resolve?.data?.nodeType).toBe('code');
    // Both host fields enter the resolver ...
    expect(edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: 'start', sourceHandle: 'request', target: 'resolve_request', targetHandle: 'request' }),
        expect.objectContaining({ source: 'start', sourceHandle: 'prompt', target: 'resolve_request', targetHandle: 'prompt' }),
      ])
    );
    // ... and every request consumer reads the resolved value, never the raw start pin.
    const consumers = edges.filter((e) => e.targetHandle === 'request' && e.target !== 'resolve_request');
    expect(consumers.map((e) => e.target).sort()).toEqual(['investigate_input', 'plan_input', 'render_input', 'review_input']);
    expect(consumers.every((e) => e.source === 'resolve_request' && e.sourceHandle === 'output')).toBe(true);
    const body = String((resolve?.data as { codeBody?: string }).codeBody);
    expect(body).toContain('request');
    expect(body).toContain('prompt');
    expect(edges).toEqual(
      expect.arrayContaining([expect.objectContaining({ source: 'report_success', sourceHandle: 'output', target: 'end', targetHandle: 'success' })])
    );
  });
});
