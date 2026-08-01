import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  isToolsAllowlistExplicitlyEmpty,
  resolveConfiguredTools,
  resolveToolsPinSource,
  toolsPinPlaceholder,
  toolsWriteTarget,
} from './agentToolsPin';

const DOC_TOOLS = ['read_file', 'write_file', 'edit_file', 'list_files', 'search_files'];

describe('agent tools pin resolution', () => {
  it('reads a pin-default allowlist (the regression: it rendered as unset)', () => {
    // The DOCUMENTER node the operator screenshotted: JSON carries five tools
    // on `pinDefaults.tools`, and the pin rendered the bare "Select…".
    const data = { pinDefaults: { tools: DOC_TOOLS } };
    expect(resolveConfiguredTools('agent', data)).toEqual(DOC_TOOLS);
    expect(toolsPinPlaceholder('agent', data)).toBe('Select…'); // unused: values are shown
    expect(isToolsAllowlistExplicitlyEmpty('agent', data)).toBe(false);
  });

  it('still reads the legacy agentConfig store when no pin default exists', () => {
    const data = { agentConfig: { tools: ['read_file'] } };
    expect(resolveConfiguredTools('agent', data)).toEqual(['read_file']);
    expect(toolsWriteTarget('agent', data)).toBe('nodeConfig');
  });

  it('lets the pin default WIN over agentConfig, matching runtime precedence', () => {
    // Proven against the runtime: with pinDefaults.tools=["read_file"] and
    // agentConfig.tools=["write_file","execute_command"], the compiled agent
    // subrun receives allowed_tools == ["read_file"].
    const data = {
      pinDefaults: { tools: ['read_file'] },
      agentConfig: { tools: ['write_file', 'execute_command'] },
    };
    expect(resolveConfiguredTools('agent', data)).toEqual(['read_file']);
    // ...and an edit must be written where the runtime reads, or it is a no-op
    expect(toolsWriteTarget('agent', data)).toBe('pinDefaults');
  });

  it('distinguishes an EMPTY allowlist from an unset one', () => {
    const empty = { pinDefaults: { tools: [] } }; // the planner: no tools by design
    const unset = { pinDefaults: {} };

    expect(resolveConfiguredTools('agent', empty)).toEqual([]);
    expect(resolveConfiguredTools('agent', unset)).toEqual([]);
    // same values array — only the placeholder can tell the author them apart
    expect(isToolsAllowlistExplicitlyEmpty('agent', empty)).toBe(true);
    expect(isToolsAllowlistExplicitlyEmpty('agent', unset)).toBe(false);
    expect(toolsPinPlaceholder('agent', empty)).toBe('No tools');
    expect(toolsPinPlaceholder('agent', unset)).toBe('Select…');
    expect(toolsPinPlaceholder('agent', empty, { loading: true })).toBe('Loading…');
  });

  it('does not confuse an empty allowlist with a missing one when writing', () => {
    // `tools: []` is a value: writing must keep it an array, not delete it.
    expect(toolsWriteTarget('agent', { pinDefaults: { tools: [] } })).toBe('pinDefaults');
  });

  it('ignores blank entries and de-duplicates', () => {
    const data = { pinDefaults: { tools: ['read_file', ' read_file ', '', '  ', 7] } };
    expect(resolveConfiguredTools('agent', data)).toEqual(['read_file']);
  });

  it('handles llm, tools_allowlist and subflow nodes from their own stores', () => {
    expect(resolveConfiguredTools('llm', { effectConfig: { tools: ['web_search'] } })).toEqual([
      'web_search',
    ]);
    expect(resolveConfiguredTools('tools_allowlist', { literalValue: ['fetch_url'] })).toEqual([
      'fetch_url',
    ]);
    expect(resolveConfiguredTools('subflow', { pinDefaults: { tools: ['skim_url'] } })).toEqual([
      'skim_url',
    ]);
    // a non-array store is "unset", never an empty allowlist
    expect(resolveToolsPinSource('agent', { pinDefaults: { tools: 'read_file' } })).toBeUndefined();
  });
});

describe('the shipped multiagent flow renders its real allowlists', () => {
  const flow = JSON.parse(
    readFileSync(resolve(__dirname, '../../examples/flows/multiagent-coding.json'), 'utf8')
  ) as { nodes: Array<{ id: string; type?: string; data: Record<string, unknown> }> };
  const agents = flow.nodes.filter((n) => n.type === 'agent' || n.data?.nodeType === 'agent');

  it('has agent nodes to check', () => {
    expect(agents.length).toBeGreaterThanOrEqual(5);
  });

  it('shows a non-empty allowlist for every tool-using agent', () => {
    const rendered = Object.fromEntries(
      agents.map((n) => [n.id, resolveConfiguredTools('agent', n.data as never)])
    );
    // the planner is planning-only by design; every other agent must show tools
    for (const [id, tools] of Object.entries(rendered)) {
      if (id === 'planner') continue;
      expect(tools.length, `${id} rendered an empty tools pin`).toBeGreaterThan(0);
    }
    expect(rendered.doc).toEqual(DOC_TOOLS);
  });

  it("renders the planner's deliberate empty allowlist as empty, not unset", () => {
    const planner = agents.find((n) => n.id === 'planner');
    expect(planner).toBeDefined();
    expect(isToolsAllowlistExplicitlyEmpty('agent', planner!.data as never)).toBe(true);
    expect(toolsPinPlaceholder('agent', planner!.data as never)).toBe('No tools');
  });
});
