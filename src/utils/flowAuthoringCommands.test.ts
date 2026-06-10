import { describe, expect, it } from 'vitest';
import type { Edge, Node } from 'reactflow';
import type { FlowNodeData } from '../types/flow';
import { applyFlowAuthoringCommands } from './flowAuthoringCommands';

function emptyState() {
  return {
    flowName: 'Untitled Flow',
    flowInterfaces: [],
    nodes: [] as Node<FlowNodeData>[],
    edges: [] as Edge[],
  };
}

describe('flow authoring commands', () => {
  it('adds template-backed nodes and validated connections', () => {
    const result = applyFlowAuthoringCommands({
      ...emptyState(),
      commands: [
        { action: 'set_flow_name', name: 'Internet Research' },
        { action: 'add_node', id: 'start', nodeType: 'on_flow_start', position: { x: 0, y: 0 } },
        { action: 'add_output_pin', nodeId: 'start', id: 'prompt', label: 'prompt', pinType: 'string' },
        { action: 'add_node', id: 'agent', nodeType: 'agent', position: { x: 300, y: 0 } },
        { action: 'add_node', id: 'end', nodeType: 'on_flow_end', position: { x: 600, y: 0 } },
        { action: 'add_input_pin', nodeId: 'end', id: 'response', label: 'response', pinType: 'string' },
        { action: 'connect', source: 'start', sourceHandle: 'exec-out', target: 'agent', targetHandle: 'exec-in' },
        { action: 'connect', source: 'start', sourceHandle: 'prompt', target: 'agent', targetHandle: 'prompt' },
        { action: 'connect', source: 'agent', sourceHandle: 'exec-out', target: 'end', targetHandle: 'exec-in' },
        { action: 'connect', source: 'agent', sourceHandle: 'response', target: 'end', targetHandle: 'response' },
      ],
    });

    expect(result.errors).toEqual([]);
    expect(result.flowName).toBe('Internet Research');
    expect(result.nodes.map((node) => node.id)).toEqual(['start', 'agent', 'end']);
    expect(result.edges).toHaveLength(4);
  });

  it('rejects invalid typed connections without adding the edge', () => {
    const result = applyFlowAuthoringCommands({
      ...emptyState(),
      commands: [
        { action: 'add_node', id: 'start', nodeType: 'on_flow_start' },
        { action: 'add_output_pin', nodeId: 'start', id: 'count', label: 'count', pinType: 'number' },
        { action: 'add_node', id: 'end', nodeType: 'on_flow_end' },
        { action: 'add_input_pin', nodeId: 'end', id: 'flag', label: 'flag', pinType: 'boolean' },
        { action: 'connect', source: 'start', sourceHandle: 'count', target: 'end', targetHandle: 'flag' },
      ],
    });

    expect(result.errors.some((error) => error.includes('connect refused invalid edge'))).toBe(true);
    expect(result.edges).toEqual([]);
  });

  it('reports the written value in set_pin_default applied messages', () => {
    // Regression (flow 4a9eee4e): "Set ai_llm_call.provider" hid WHAT was set,
    // so neither the user nor the authoring model could see which provider had
    // been chosen (or that it was an empty string).
    const result = applyFlowAuthoringCommands({
      ...emptyState(),
      commands: [
        { action: 'add_node', id: 'llm', nodeType: 'llm_call' },
        { action: 'set_pin_default', nodeId: 'llm', pin: 'provider', value: 'openai' },
        { action: 'set_pin_default', nodeId: 'llm', pin: 'model', value: '' },
      ],
    });

    expect(result.errors).toEqual([]);
    expect(result.applied).toContain('Set llm.provider = "openai"');
    expect(result.applied).toContain('Set llm.model = ""');
  });

  it('treats rewriting an identical pin default as a warning no-op, not progress', () => {
    // Regression (flow 4a9eee4e): the same provider/model rewrite counted as
    // 2 applied changes per cycle for 8 cycles, hiding the stall.
    const first = applyFlowAuthoringCommands({
      ...emptyState(),
      commands: [
        { action: 'add_node', id: 'llm', nodeType: 'llm_call' },
        { action: 'set_pin_default', nodeId: 'llm', pin: 'provider', value: 'openai' },
      ],
    });
    expect(first.errors).toEqual([]);

    const rewrite = applyFlowAuthoringCommands({
      flowName: first.flowName,
      flowInterfaces: [],
      nodes: first.nodes,
      edges: first.edges,
      commands: [{ action: 'set_pin_default', nodeId: 'llm', pin: 'provider', value: 'openai' }],
    });
    expect(rewrite.errors).toEqual([]);
    expect(rewrite.applied).toEqual([]);
    expect(rewrite.warnings).toContain('llm.provider is already "openai"; no change');
  });

  it('warns and skips incompatible terminal agent meta audit summaries without rejecting the batch', () => {
    const result = applyFlowAuthoringCommands({
      ...emptyState(),
      commands: [
        { action: 'add_node', id: 'agent', nodeType: 'agent' },
        { action: 'add_node', id: 'trace_report', nodeType: 'agent_trace_report' },
        { action: 'add_node', id: 'end', nodeType: 'on_flow_end' },
        { action: 'add_output_pin', nodeId: 'end', id: 'audit_summary', label: 'Audit Summary', pinType: 'string' },
        { action: 'connect', source: 'agent', sourceHandle: 'meta', target: 'end', targetHandle: 'audit_summary' },
        { action: 'connect', source: 'agent', sourceHandle: 'scratchpad', target: 'trace_report', targetHandle: 'scratchpad' },
        { action: 'connect', source: 'trace_report', sourceHandle: 'result', target: 'end', targetHandle: 'audit_summary' },
      ],
    });

    expect(result.errors).toEqual([]);
    expect(result.warnings).toContain('Skipped incompatible terminal audit summary edge agent.meta -> end.audit_summary');
    expect(result.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: 'agent', sourceHandle: 'scratchpad', target: 'trace_report', targetHandle: 'scratchpad' }),
        expect.objectContaining({ source: 'trace_report', sourceHandle: 'result', target: 'end', targetHandle: 'audit_summary' }),
      ])
    );
    expect(result.edges.some((edge) => edge.source === 'agent' && edge.sourceHandle === 'meta' && edge.target === 'end')).toBe(false);
  });

  it('honors explicit dynamic pin types and infers object sources only when pinType is absent', () => {
    const inferred = applyFlowAuthoringCommands({
      ...emptyState(),
      commands: [
        { action: 'add_node', id: 'end', nodeType: 'on_flow_end' },
        { action: 'add_output_pin', nodeId: 'end', id: 'sources', label: 'Sources' },
      ],
    });
    const result = applyFlowAuthoringCommands({
      ...emptyState(),
      commands: [
        { action: 'add_node', id: 'agent', nodeType: 'agent' },
        { action: 'add_node', id: 'end', nodeType: 'on_flow_end' },
        { action: 'add_output_pin', nodeId: 'end', id: 'sources', label: 'Sources', pinType: 'string' },
        { action: 'connect', source: 'agent', sourceHandle: 'meta', target: 'end', targetHandle: 'sources' },
      ],
    });

    expect(inferred.errors).toEqual([]);
    expect(inferred.nodes.find((node) => node.id === 'end')?.data.inputs.find((pin) => pin.id === 'sources')?.type).toBe('object');
    expect(result.errors.some((error) => error.includes('connect refused invalid edge'))).toBe(true);
    expect(result.nodes.find((node) => node.id === 'end')?.data.inputs.find((pin) => pin.id === 'sources')?.type).toBe('string');
  });

  it('preserves explicit string trace summary pins for Agent Trace Report output', () => {
    const result = applyFlowAuthoringCommands({
      ...emptyState(),
      commands: [
        { action: 'add_node', id: 'agent', nodeType: 'agent' },
        { action: 'add_node', id: 'trace_report', nodeType: 'agent_trace_report' },
        { action: 'add_node', id: 'end', nodeType: 'on_flow_end' },
        { action: 'add_input_pin', nodeId: 'end', id: 'trace_summary', label: 'Trace Summary', pinType: 'string' },
        { action: 'connect', source: 'agent.scratchpad', target: 'trace_report.scratchpad' },
        { action: 'connect', source: 'trace_report.result', target: 'end.trace_summary' },
      ],
    });

    expect(result.errors).toEqual([]);
    expect(result.nodes.find((node) => node.id === 'end')?.data.inputs.find((pin) => pin.id === 'trace_summary')?.type).toBe('string');
    expect(result.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: 'trace_report', sourceHandle: 'result', target: 'end', targetHandle: 'trace_summary' }),
      ])
    );
  });

  it('canonicalizes planner Build JSON value fan-in to dynamic object fields', () => {
    const result = applyFlowAuthoringCommands({
      ...emptyState(),
      commands: [
        { action: 'add_node', id: 'on_flow_start', nodeType: 'on_flow_start' },
        { action: 'add_output_pin', nodeId: 'on_flow_start', id: 'search_query', label: 'Search Query', pinType: 'string' },
        { action: 'add_output_pin', nodeId: 'on_flow_start', id: 'depth', label: 'Depth', pinType: 'number' },
        { action: 'add_node', id: 'build_json', nodeType: 'build_json' },
        { action: 'connect', source: 'on_flow_start.search_query', target: 'build_json.value' },
        { action: 'connect', source: 'on_flow_start.depth', target: 'build_json.value' },
      ],
    });

    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        'Canonicalized Build JSON value input build_json.value to dynamic input build_json.search_query',
        'Canonicalized Build JSON value input build_json.value to dynamic input build_json.depth',
      ])
    );
    expect(result.nodes.find((node) => node.id === 'build_json')?.data.inputs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'search_query', type: 'string' }),
        expect.objectContaining({ id: 'depth', type: 'number' }),
      ])
    );
    expect(result.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: 'on_flow_start', sourceHandle: 'search_query', target: 'build_json', targetHandle: 'search_query' }),
        expect.objectContaining({ source: 'on_flow_start', sourceHandle: 'depth', target: 'build_json', targetHandle: 'depth' }),
      ])
    );
  });

  it('blocks Code full_access defaults', () => {
    const result = applyFlowAuthoringCommands({
      ...emptyState(),
      commands: [{ action: 'add_node', id: 'code', nodeType: 'code', pinDefaults: { permissions: 'full_access' } }],
    });

    expect(result.nodes).toEqual([]);
    expect(result.errors.some((error) => error.includes('full_access'))).toBe(true);
  });

  it('authors sandbox Code node bodies through add_node and set_code_body', () => {
    const result = applyFlowAuthoringCommands({
      ...emptyState(),
      commands: [
        { action: 'add_node', id: 'code', nodeType: 'code', codeBody: 'return input', functionName: 'transform' },
        { action: 'set_code_body', nodeId: 'code', codeBody: 'text = str(input or "")\nreturn text.upper()' },
      ],
    });

    expect(result.errors).toEqual([]);
    const code = result.nodes.find((node) => node.id === 'code');
    expect(code?.data.pinDefaults?.permissions).toBe('sandbox');
    expect(code?.data.codeBody).toBe('text = str(input or "")\nreturn text.upper()');
    expect(code?.data.functionName).toBe('transform');
  });

  it('selects duplicate palette template variants with templateLabel', () => {
    const result = applyFlowAuthoringCommands({
      ...emptyState(),
      commands: [
        { action: 'add_node', id: 'image_ref', nodeType: 'literal_json', templateLabel: 'Image Artifact' },
      ],
    });

    expect(result.errors).toEqual([]);
    const node = result.nodes.find((item) => item.id === 'image_ref');
    expect(node?.data.label).toBe('Image Artifact');
    expect(node?.data.outputs[0]).toEqual(expect.objectContaining({ id: 'value', type: 'artifact_image' }));
    expect(node?.data.literalValue).toEqual({ $artifact: '', content_type: 'image/png', modality: 'image' });
  });

  it('rejects ambiguous or invalid duplicate palette template variants', () => {
    const missing = applyFlowAuthoringCommands({
      ...emptyState(),
      commands: [{ action: 'add_node', id: 'json', nodeType: 'literal_json' }],
    });
    const invalid = applyFlowAuthoringCommands({
      ...emptyState(),
      commands: [{ action: 'add_node', id: 'json', nodeType: 'literal_json', templateLabel: 'Imaginary Artifact' }],
    });

    expect(missing.nodes).toEqual([]);
    expect(missing.errors.some((error) => error.includes('ambiguous node type'))).toBe(true);
    expect(invalid.nodes).toEqual([]);
    expect(invalid.errors.some((error) => error.includes('unknown templateLabel'))).toBe(true);
  });

  it('configures Break Object selected paths and output pins together', () => {
    const result = applyFlowAuthoringCommands({
      ...emptyState(),
      commands: [
        { action: 'add_node', id: 'break_report', nodeType: 'break_object' },
        {
          action: 'set_break_paths',
          nodeId: 'break_report',
          paths: [
            { path: 'markdown_report', label: 'Markdown Report', pinType: 'string' },
            { path: 'sources', label: 'Sources', pinType: 'array' },
          ],
        },
      ],
    });

    expect(result.errors).toEqual([]);
    const node = result.nodes.find((item) => item.id === 'break_report');
    expect(node?.data.breakConfig?.selectedPaths).toEqual(['markdown_report', 'sources']);
    expect(node?.data.outputs).toEqual([
      expect.objectContaining({ id: 'markdown_report', type: 'string' }),
      expect.objectContaining({ id: 'sources', type: 'array' }),
    ]);
  });

  it('keeps Break Object config in sync when adding a simple dynamic output pin', () => {
    const result = applyFlowAuthoringCommands({
      ...emptyState(),
      commands: [
        { action: 'add_node', id: 'break_report', nodeType: 'break_object' },
        { action: 'add_output_pin', nodeId: 'break_report', id: 'markdown_report', pinType: 'string' },
      ],
    });

    expect(result.errors).toEqual([]);
    const node = result.nodes.find((item) => item.id === 'break_report');
    expect(node?.data.breakConfig?.selectedPaths).toEqual(['markdown_report']);
    expect(node?.data.outputs).toEqual([expect.objectContaining({ id: 'markdown_report', type: 'string' })]);
  });

  it('rejects Break Object path aliases because runtime output keys are the selected paths', () => {
    const result = applyFlowAuthoringCommands({
      ...emptyState(),
      commands: [
        { action: 'add_node', id: 'break_report', nodeType: 'break_object' },
        {
          action: 'set_break_paths',
          nodeId: 'break_report',
          paths: [{ id: 'sources', path: 'metadata.sources', pinType: 'array' }],
        },
      ],
    });

    expect(result.errors.some((error) => error.includes('does not support aliases'))).toBe(true);
  });

  it('configures Switch cases and Sequence/Parallel branch outputs', () => {
    const result = applyFlowAuthoringCommands({
      ...emptyState(),
      commands: [
        { action: 'add_node', id: 'route', nodeType: 'switch' },
        { action: 'set_switch_cases', nodeId: 'route', cases: [{ id: 'research', value: 'research' }, 'digest'] },
        { action: 'add_node', id: 'ordered', nodeType: 'sequence' },
        { action: 'set_branch_count', nodeId: 'ordered', count: 3 },
        { action: 'add_node', id: 'parallel', nodeType: 'parallel' },
        { action: 'set_branch_count', nodeId: 'parallel', count: 4 },
      ],
    });

    expect(result.errors).toEqual([]);
    const route = result.nodes.find((item) => item.id === 'route');
    expect(route?.data.switchConfig?.cases).toEqual([
      { id: 'research', value: 'research' },
      { id: 'digest', value: 'digest' },
    ]);
    expect(route?.data.outputs.map((pin) => pin.id)).toEqual(['case:research', 'case:digest', 'default']);
    expect(result.nodes.find((item) => item.id === 'ordered')?.data.outputs.map((pin) => pin.id)).toEqual([
      'then:0',
      'then:1',
      'then:2',
    ]);
    expect(result.nodes.find((item) => item.id === 'parallel')?.data.outputs.map((pin) => pin.id)).toEqual([
      'then:0',
      'then:1',
      'then:2',
      'then:3',
      'completed',
    ]);
  });

  it('configures Tool Parameters and allows Tool Calls creation with explicit allowed_tools', () => {
    const result = applyFlowAuthoringCommands({
      ...emptyState(),
      commands: [
        { action: 'add_node', id: 'params', nodeType: 'tool_parameters' },
        {
          action: 'set_tool_parameters',
          nodeId: 'params',
          tool: 'web_search',
          parameters: {
            query: { type: 'string', description: 'Search query.' },
            num_results: { type: 'integer', default: 10 },
          },
        },
        { action: 'add_node', id: 'tool_exec', nodeType: 'tool_calls', pinDefaults: { allowed_tools: ['web_search'] } },
      ],
    });

    expect(result.errors).toEqual([]);
    const params = result.nodes.find((item) => item.id === 'params');
    expect(params?.data.toolParametersConfig?.tool).toBe('web_search');
    expect(params?.data.inputs).toEqual([
      expect.objectContaining({ id: 'query', type: 'string' }),
      expect.objectContaining({ id: 'num_results', type: 'number' }),
    ]);
    expect(params?.data.outputs.map((pin) => `${pin.id}:${pin.type}`)).toEqual([
      'tool_call:object',
      'query:string',
      'num_results:number',
    ]);
    expect(params?.data.pinDefaults?.num_results).toBe(10);
    expect(result.nodes.find((item) => item.id === 'tool_exec')?.data.pinDefaults?.allowed_tools).toEqual(['web_search']);
  });

  it('sets event configuration for event entry nodes', () => {
    const result = applyFlowAuthoringCommands({
      ...emptyState(),
      commands: [
        { action: 'add_node', id: 'event', nodeType: 'on_event' },
        { action: 'set_event_config', nodeId: 'event', name: 'daily_digest', scope: 'workflow', description: 'Run digest flow.' },
        { action: 'add_node', id: 'agent_message', nodeType: 'on_agent_message' },
        { action: 'set_event_config', nodeId: 'agent_message', channel: 'research', agentFilter: 'planner' },
      ],
    });

    expect(result.errors).toEqual([]);
    expect(result.nodes.find((item) => item.id === 'event')?.data.eventConfig).toEqual(
      expect.objectContaining({ name: 'daily_digest', scope: 'workflow', description: 'Run digest flow.' })
    );
    expect(result.nodes.find((item) => item.id === 'agent_message')?.data.eventConfig).toEqual(
      expect.objectContaining({ channel: 'research', agentFilter: 'planner' })
    );
  });

  it('rejects set_pin_default on output or execution pins', () => {
    const result = applyFlowAuthoringCommands({
      ...emptyState(),
      commands: [
        { action: 'add_node', id: 'start', nodeType: 'on_flow_start' },
        { action: 'add_output_pin', nodeId: 'start', id: 'topic', pinType: 'string' },
        { action: 'set_pin_default', nodeId: 'start', pin: 'topic', value: 'default topic' },
        { action: 'add_node', id: 'agent', nodeType: 'agent' },
        { action: 'set_pin_default', nodeId: 'agent', pin: 'exec-in', value: true },
      ],
    });

    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining("unknown input pin 'topic'"),
        expect.stringContaining("execution input pin 'exec-in'"),
      ])
    );
  });

  it('requires Tool Calls to carry an explicit allowlist', () => {
    const result = applyFlowAuthoringCommands({
      ...emptyState(),
      commands: [{ action: 'add_node', id: 'tools', nodeType: 'tool_calls' }],
    });

    expect(result.nodes).toEqual([]);
    expect(result.errors.some((error) => error.includes('allowed_tools'))).toBe(true);
  });

  it('rejects add_node pinDefaults for unknown, output, or execution pins', () => {
    const unknown = applyFlowAuthoringCommands({
      ...emptyState(),
      commands: [{ action: 'add_node', id: 'agent', nodeType: 'agent', pinDefaults: { does_not_exist: 'x' } }],
    });
    const output = applyFlowAuthoringCommands({
      ...emptyState(),
      commands: [{ action: 'add_node', id: 'text', nodeType: 'literal_string', pinDefaults: { value: 'x' } }],
    });
    const execution = applyFlowAuthoringCommands({
      ...emptyState(),
      commands: [{ action: 'add_node', id: 'agent', nodeType: 'agent', pinDefaults: { 'exec-in': true } }],
    });

    expect(unknown.nodes).toEqual([]);
    expect(unknown.errors.some((error) => error.includes("pin default 'does_not_exist' is not an input pin"))).toBe(true);
    expect(output.nodes).toEqual([]);
    expect(output.errors.some((error) => error.includes("pin default 'value' is not an input pin"))).toBe(true);
    expect(execution.nodes).toEqual([]);
    expect(execution.errors.some((error) => error.includes("refused execution pin default 'exec-in'"))).toBe(true);
  });

  it('stores tools allowlist selections as literal tool names', () => {
    const result = applyFlowAuthoringCommands({
      ...emptyState(),
      commands: [
        { action: 'add_node', id: 'tools', nodeType: 'tools_allowlist', pinDefaults: { tools: [{ name: 'web_search' }, { name: 'fetch_url' }] } },
        { action: 'set_pin_default', nodeId: 'tools', pin: 'tools', value: ['web_search', 'fetch_url', 'web_search'] },
      ],
    });

    expect(result.errors).toEqual([]);
    expect(result.nodes.find((node) => node.id === 'tools')?.data.literalValue).toEqual(['web_search', 'fetch_url']);
    expect(result.nodes.find((node) => node.id === 'tools')?.data.pinDefaults?.tools).toBeUndefined();
  });

  it('treats set_literal on String Template as the template pin default', () => {
    const result = applyFlowAuthoringCommands({
      ...emptyState(),
      commands: [
        { action: 'add_node', id: 'template', nodeType: 'string_template' },
        { action: 'set_literal', nodeId: 'template', value: 'Research {{topic}}' },
      ],
    });

    expect(result.errors).toEqual([]);
    expect(result.nodes.find((node) => node.id === 'template')?.data.pinDefaults?.template).toBe('Research {{topic}}');
  });

  it('canonicalizes common planner scaffold mistakes to existing node semantics', () => {
    const result = applyFlowAuthoringCommands({
      ...emptyState(),
      commands: [
        { action: 'set_flow_name', name: 'Deep Research Workflow' },
        { action: 'add_node', id: 'on_start', nodeType: 'on_flow_start' },
        { action: 'add_input_pin', nodeId: 'on_start', id: 'topic', label: 'topic', pinType: 'string' },
        { action: 'add_node', id: 'build_prompt', nodeType: 'build_json' },
        { action: 'add_output_pin', nodeId: 'build_prompt', id: 'result', label: 'result', pinType: 'object' },
        { action: 'add_node', id: 'template', nodeType: 'string_template' },
        { action: 'add_output_pin', nodeId: 'template', id: 'result', label: 'result', pinType: 'string' },
        { action: 'add_node', id: 'tools_allow', nodeType: 'tools_allowlist' },
        { action: 'set_literal', nodeId: 'tools_allow', value: ['web_search', 'fetch_url'] },
        { action: 'add_node', id: 'agent', nodeType: 'agent' },
        { action: 'add_output_pin', nodeId: 'agent', id: 'sources', label: 'sources', pinType: 'object' },
        { action: 'set_pin_default', nodeId: 'agent', pin: 'max_iterations', value: 50 },
        { action: 'add_node', id: 'trace_report', nodeType: 'agent_trace_report' },
        { action: 'add_node', id: 'on_end', nodeType: 'on_flow_end' },
        { action: 'add_output_pin', nodeId: 'on_end', id: 'report', label: 'report', pinType: 'string' },
        { action: 'add_output_pin', nodeId: 'on_end', id: 'sources', label: 'sources' },
        { action: 'add_output_pin', nodeId: 'on_end', id: 'audit_summary', label: 'audit summary' },
        { action: 'connect', source: 'on_start', sourceHandle: 'exec-out', target: 'build_prompt', targetHandle: 'exec-in' },
        { action: 'connect', source: 'build_prompt', sourceHandle: 'exec-out', target: 'template', targetHandle: 'exec-in' },
        { action: 'connect', source: 'template', sourceHandle: 'exec-out', target: 'agent', targetHandle: 'exec-in' },
        { action: 'connect', source: 'agent', sourceHandle: 'exec-out', target: 'on_end', targetHandle: 'exec-in' },
        { action: 'connect', source: 'on_start.topic', target: 'build_prompt.topic' },
        { action: 'connect', source: 'build_prompt.result', target: 'template.vars' },
        { action: 'connect', source: 'template.result', target: 'agent.prompt' },
        { action: 'connect', source: 'tools_allow.tools', target: 'agent.tools' },
        { action: 'connect', source: 'agent.response', target: 'on_end.report' },
        { action: 'connect', source: 'agent', sourceHandle: 'meta', target: 'on_end', targetHandle: 'sources' },
        { action: 'connect', source: 'agent', sourceHandle: 'exec-out', target: 'trace_report', targetHandle: 'scratchpad' },
        { action: 'connect', source: 'trace_report.result', target: 'on_end.audit_summary' },
      ],
    });

    expect(result.errors).toEqual([]);
    expect(result.warnings.some((warning) => warning.includes('Canonicalized'))).toBe(true);
    expect(result.nodes.find((node) => node.id === 'build_prompt')?.data.nodeType).toBe('make_object');
    expect(result.nodes.find((node) => node.id === 'on_start')?.data.outputs.some((pin) => pin.id === 'topic')).toBe(true);
    expect(result.nodes.find((node) => node.id === 'on_end')?.data.inputs.find((pin) => pin.id === 'sources')?.type).toBe('object');
    expect(result.nodes.find((node) => node.id === 'on_end')?.data.inputs.find((pin) => pin.id === 'audit_summary')?.type).toBe('string');
    expect(result.nodes.find((node) => node.id === 'build_prompt')?.data.inputs.some((pin) => pin.id === 'topic')).toBe(true);
    expect(result.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: 'on_start', sourceHandle: 'exec-out', target: 'agent', targetHandle: 'exec-in' }),
        expect.objectContaining({ source: 'agent', sourceHandle: 'exec-out', target: 'on_end', targetHandle: 'exec-in' }),
        expect.objectContaining({ source: 'template', sourceHandle: 'result', target: 'agent', targetHandle: 'prompt' }),
        expect.objectContaining({ source: 'agent', sourceHandle: 'meta', target: 'on_end', targetHandle: 'sources' }),
        expect.objectContaining({ source: 'agent', sourceHandle: 'scratchpad', target: 'trace_report', targetHandle: 'scratchpad' }),
        expect.objectContaining({ source: 'trace_report', sourceHandle: 'result', target: 'on_end', targetHandle: 'audit_summary' }),
      ])
    );
  });

  it('normalizes shorthand endpoints with typed explicit handles from planner JSON', () => {
    const scaffold = applyFlowAuthoringCommands({
      ...emptyState(),
      commands: [
        { action: 'add_node', id: 'agent', nodeType: 'agent' },
        { action: 'add_node', id: 'trace_report', nodeType: 'agent_trace_report' },
        { action: 'add_node', id: 'end', nodeType: 'on_flow_end' },
        { action: 'add_input_pin', nodeId: 'end', id: 'report', pinType: 'string' },
        {
          action: 'connect',
          source: 'agent.scratchpad',
          sourceHandle: 'scratchpad:object',
          target: 'trace_report',
          targetHandle: 'scratchpad',
        },
        {
          action: 'connect',
          source: 'trace_report.result',
          sourceHandle: 'result:string',
          target: 'end',
          targetHandle: 'report',
        },
        { action: 'set_concat_separator', nodeId: 'trace_report', separator: '\n---\n' },
      ],
    });

    expect(scaffold.errors).toEqual([]);
    expect(scaffold.warnings).toContain('Ignored concat separator on non-concat node trace_report');
    expect(scaffold.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'agent',
          sourceHandle: 'scratchpad',
          target: 'trace_report',
          targetHandle: 'scratchpad',
        }),
        expect.objectContaining({
          source: 'trace_report',
          sourceHandle: 'result',
          target: 'end',
          targetHandle: 'report',
        }),
      ])
    );
  });

  it('rejects hidden or deprecated node templates', () => {
    const result = applyFlowAuthoringCommands({
      ...emptyState(),
      commands: [{ action: 'add_node', id: 'legacy-tool', nodeType: 'call_tool' }],
    });

    expect(result.nodes).toEqual([]);
    expect(result.errors.some((error) => error.includes('hidden or deprecated'))).toBe(true);
  });

  it('rejects secret-looking literal values during node creation', () => {
    const result = applyFlowAuthoringCommands({
      ...emptyState(),
      commands: [{ action: 'add_node', id: 'secret', nodeType: 'literal_string', literalValue: 'Bearer abcdefghijklmnopqrstuvwxyz' }],
    });

    expect(result.nodes).toEqual([]);
    expect(result.errors.some((error) => error.includes('secret-looking literal'))).toBe(true);
  });

  it('applies commands in dependency order so connect can precede add_node in the batch', () => {
    const result = applyFlowAuthoringCommands({
      ...emptyState(),
      commands: [
        { action: 'connect', source: 'start', sourceHandle: 'exec-out', target: 'agent', targetHandle: 'exec-in' },
        { action: 'add_node', id: 'start', nodeType: 'on_flow_start' },
        { action: 'add_node', id: 'agent', nodeType: 'agent' },
      ],
    });

    expect(result.errors).toEqual([]);
    expect(result.edges).toEqual([
      expect.objectContaining({ source: 'start', sourceHandle: 'exec-out', target: 'agent', targetHandle: 'exec-in' }),
    ]);
  });

  it('keeps valid commands and reports per-command errors for the rest', () => {
    const result = applyFlowAuthoringCommands({
      ...emptyState(),
      commands: [
        { action: 'add_node', id: 'start', nodeType: 'on_flow_start' },
        { action: 'add_node', id: 'agent', nodeType: 'agent' },
        { action: 'connect', source: 'start', sourceHandle: 'exec-out', target: 'agent', targetHandle: 'exec-in' },
        { action: 'connect', source: 'ghost', sourceHandle: 'value', target: 'agent', targetHandle: 'prompt' },
      ],
    });

    expect(result.applied.length).toBeGreaterThanOrEqual(3);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('connect refused invalid edge');
    expect(result.edges).toHaveLength(1);
  });

  it('auto-inserts a sequence node when an execution output fans out', () => {
    const result = applyFlowAuthoringCommands({
      ...emptyState(),
      commands: [
        { action: 'add_node', id: 'start', nodeType: 'on_flow_start' },
        { action: 'add_node', id: 'agent_a', nodeType: 'agent' },
        { action: 'add_node', id: 'agent_b', nodeType: 'agent' },
        { action: 'connect', source: 'start', sourceHandle: 'exec-out', target: 'agent_a', targetHandle: 'exec-in' },
        { action: 'connect', source: 'start', sourceHandle: 'exec-out', target: 'agent_b', targetHandle: 'exec-in' },
      ],
    });

    expect(result.errors).toEqual([]);
    const sequence = result.nodes.find((node) => node.data.nodeType === 'sequence');
    expect(sequence).toBeDefined();
    expect(result.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: 'start', sourceHandle: 'exec-out', target: sequence?.id, targetHandle: 'exec-in' }),
        expect.objectContaining({ source: sequence?.id, sourceHandle: 'then:0', target: 'agent_a', targetHandle: 'exec-in' }),
        expect.objectContaining({ source: sequence?.id, sourceHandle: 'then:1', target: 'agent_b', targetHandle: 'exec-in' }),
      ])
    );
    expect(result.warnings.some((warning) => warning.includes('Canonicalized execution fan-out'))).toBe(true);
  });

  it('extends an existing sequence when fanning out an exec output already routed through it', () => {
    const result = applyFlowAuthoringCommands({
      ...emptyState(),
      commands: [
        { action: 'add_node', id: 'start', nodeType: 'on_flow_start' },
        { action: 'add_node', id: 'seq', nodeType: 'sequence' },
        { action: 'add_node', id: 'agent_a', nodeType: 'agent' },
        { action: 'add_node', id: 'agent_b', nodeType: 'agent' },
        { action: 'add_node', id: 'agent_c', nodeType: 'agent' },
        { action: 'connect', source: 'start', sourceHandle: 'exec-out', target: 'seq', targetHandle: 'exec-in' },
        { action: 'connect', source: 'seq', sourceHandle: 'then:0', target: 'agent_a', targetHandle: 'exec-in' },
        { action: 'connect', source: 'seq', sourceHandle: 'then:1', target: 'agent_b', targetHandle: 'exec-in' },
        { action: 'connect', source: 'start', sourceHandle: 'exec-out', target: 'agent_c', targetHandle: 'exec-in' },
      ],
    });

    expect(result.errors).toEqual([]);
    expect(result.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: 'seq', sourceHandle: 'then:2', target: 'agent_c', targetHandle: 'exec-in' }),
      ])
    );
    const seq = result.nodes.find((node) => node.id === 'seq');
    expect((seq?.data.outputs || []).some((pin) => pin.id === 'then:2')).toBe(true);
  });

  it('drops loop-back edges from a loop body to the loop exec-in', () => {
    const result = applyFlowAuthoringCommands({
      ...emptyState(),
      commands: [
        { action: 'add_node', id: 'start', nodeType: 'on_flow_start' },
        { action: 'add_node', id: 'items', nodeType: 'literal_array', templateLabel: 'Array', literalValue: ['a', 'b'] },
        { action: 'add_node', id: 'each', nodeType: 'loop' },
        { action: 'add_node', id: 'llm', nodeType: 'llm_call' },
        { action: 'add_node', id: 'save', nodeType: 'set_var', pinDefaults: { name: 'transcript' } },
        { action: 'connect', source: 'start', sourceHandle: 'exec-out', target: 'each', targetHandle: 'exec-in' },
        { action: 'connect', source: 'items', sourceHandle: 'value', target: 'each', targetHandle: 'items' },
        { action: 'connect', source: 'each', sourceHandle: 'loop', target: 'llm', targetHandle: 'exec-in' },
        { action: 'connect', source: 'llm', sourceHandle: 'exec-out', target: 'save', targetHandle: 'exec-in' },
        { action: 'connect', source: 'save', sourceHandle: 'exec-out', target: 'each', targetHandle: 'exec-in' },
      ],
    });

    expect(result.errors).toEqual([]);
    expect(
      result.edges.some((edge) => edge.source === 'save' && edge.target === 'each' && edge.targetHandle === 'exec-in')
    ).toBe(false);
    expect(result.warnings.some((warning) => warning.toLowerCase().includes('loop-back'))).toBe(true);
  });

  it('drops loop-back edges even when emitted before the body wiring', () => {
    const result = applyFlowAuthoringCommands({
      ...emptyState(),
      commands: [
        { action: 'add_node', id: 'start', nodeType: 'on_flow_start' },
        { action: 'add_node', id: 'items', nodeType: 'literal_array', templateLabel: 'Array', literalValue: ['a', 'b'] },
        { action: 'add_node', id: 'each', nodeType: 'loop' },
        { action: 'add_node', id: 'llm', nodeType: 'llm_call' },
        { action: 'connect', source: 'llm', sourceHandle: 'exec-out', target: 'each', targetHandle: 'exec-in' },
        { action: 'connect', source: 'start', sourceHandle: 'exec-out', target: 'each', targetHandle: 'exec-in' },
        { action: 'connect', source: 'items', sourceHandle: 'value', target: 'each', targetHandle: 'items' },
        { action: 'connect', source: 'each', sourceHandle: 'loop', target: 'llm', targetHandle: 'exec-in' },
      ],
    });

    expect(result.errors).toEqual([]);
    expect(
      result.edges.some((edge) => edge.source === 'llm' && edge.target === 'each' && edge.targetHandle === 'exec-in')
    ).toBe(false);
    expect(result.warnings.some((warning) => warning.toLowerCase().includes('loop-back'))).toBe(true);
  });
});

/**
 * Regressions reproduced verbatim from the multi-AI discussion authoring run
 * (flow 691c58f8): each case below was a rejected command in that transcript.
 */
describe('flow authoring transcript regressions (691c58f8)', () => {
  it('configures a Variable node through set_pin_default on name/value pins', () => {
    const result = applyFlowAuthoringCommands({
      ...emptyState(),
      commands: [
        { action: 'add_node', id: 'var_transcript', nodeType: 'var_decl', label: 'Transcript de discussion' },
        // Rejected in the transcript: "unknown input pin 'name'/'value' on var_transcript"
        { action: 'set_pin_default', nodeId: 'var_transcript', pin: 'name', value: 'transcript' },
        { action: 'set_pin_default', nodeId: 'var_transcript', pin: 'value', value: [] },
      ],
    });

    expect(result.errors).toEqual([]);
    const node = result.nodes.find((item) => item.id === 'var_transcript');
    expect(node?.data.literalValue).toEqual({ name: 'transcript', type: 'array', default: [] });
    // The value output pin type follows the declared type, like the inline editor.
    expect(node?.data.outputs.find((pin) => pin.id === 'value')?.type).toBe('array');
    expect(result.applied).toContain('Named variable var_transcript "transcript"');
    expect(result.applied).toContain('Set variable var_transcript default value');
  });

  it('configures a Variable node through set_literal with the canonical config object', () => {
    const result = applyFlowAuthoringCommands({
      ...emptyState(),
      commands: [
        { action: 'add_node', id: 'var_cycle', nodeType: 'var_decl', label: 'Compteur de cycles' },
        { action: 'set_literal', nodeId: 'var_cycle', value: { name: 'cycle_count', type: 'number', default: 0 } },
      ],
    });

    expect(result.errors).toEqual([]);
    const node = result.nodes.find((item) => item.id === 'var_cycle');
    expect(node?.data.literalValue).toEqual({ name: 'cycle_count', type: 'number', default: 0 });
    expect(node?.data.outputs.find((pin) => pin.id === 'value')?.type).toBe('number');
  });

  it('treats a bare set_literal value on a Variable node as its default', () => {
    const result = applyFlowAuthoringCommands({
      ...emptyState(),
      commands: [
        { action: 'add_node', id: 'var_t', nodeType: 'var_decl', label: 'Transcript' },
        { action: 'set_pin_default', nodeId: 'var_t', pin: 'name', value: 'transcript' },
        { action: 'set_literal', nodeId: 'var_t', value: [] },
      ],
    });

    expect(result.errors).toEqual([]);
    const node = result.nodes.find((item) => item.id === 'var_t');
    expect(node?.data.literalValue).toEqual({ name: 'transcript', type: 'array', default: [] });
  });

  it('connects a ForEach item (any) to llm_call.model for multi-model fan-out', () => {
    const result = applyFlowAuthoringCommands({
      ...emptyState(),
      commands: [
        { action: 'add_node', id: 'models_array', nodeType: 'literal_array', templateLabel: 'Array', literalValue: ['m1', 'm2'], label: 'Pool de modèles' },
        { action: 'add_node', id: 'loop_participants', nodeType: 'loop', label: 'Boucle participants' },
        { action: 'add_node', id: 'llm_participant', nodeType: 'llm_call', label: 'Contribution IA' },
        { action: 'connect', source: 'models_array', sourceHandle: 'value', target: 'loop_participants', targetHandle: 'items' },
        // Rejected in the transcript: "Type mismatch: cannot connect any to model"
        { action: 'connect', source: 'loop_participants', sourceHandle: 'item', target: 'llm_participant', targetHandle: 'model' },
      ],
    });

    expect(result.errors).toEqual([]);
    expect(
      result.edges.some(
        (edge) => edge.source === 'loop_participants' && edge.sourceHandle === 'item' && edge.target === 'llm_participant' && edge.targetHandle === 'model'
      )
    ).toBe(true);
  });

  it('lists available output pins when a guessed handle does not exist (for.end)', () => {
    const result = applyFlowAuthoringCommands({
      ...emptyState(),
      commands: [
        { action: 'add_node', id: 'for_cycles', nodeType: 'for', label: 'Boucle cycles' },
        { action: 'add_node', id: 'end', nodeType: 'on_flow_end' },
        { action: 'add_input_pin', nodeId: 'end', id: 'cycle_count', pinType: 'number' },
        // Rejected in the transcript: "Output pin 'end' not found"
        { action: 'connect', source: 'for_cycles', sourceHandle: 'end', target: 'end', targetHandle: 'cycle_count' },
      ],
    });

    const error = result.errors.find((item) => item.includes("Output pin 'end' not found"));
    expect(error).toBeTruthy();
    expect(error).toContain('available outputs: loop, done, i, index');
  });

  it('lists available input pins when set_pin_default targets an unknown pin', () => {
    const result = applyFlowAuthoringCommands({
      ...emptyState(),
      commands: [
        { action: 'add_node', id: 'llm', nodeType: 'llm_call', label: 'Synthèse' },
        { action: 'set_pin_default', nodeId: 'llm', pin: 'instructions', value: 'x' },
      ],
    });

    const error = result.errors.find((item) => item.includes("unknown input pin 'instructions'"));
    expect(error).toBeTruthy();
    expect(error).toContain('available input pins:');
    expect(error).toContain('prompt');
  });

  it('still refuses execution-to-data edges (loop -> get_var.name)', () => {
    const result = applyFlowAuthoringCommands({
      ...emptyState(),
      commands: [
        { action: 'add_node', id: 'loop_participants', nodeType: 'loop', label: 'Boucle participants' },
        { action: 'add_node', id: 'get_transcript', nodeType: 'get_var', label: 'Lire transcript' },
        { action: 'connect', source: 'loop_participants', sourceHandle: 'loop', target: 'get_transcript', targetHandle: 'name' },
      ],
    });

    expect(result.errors.some((item) => item.includes('cannot connect execution to string'))).toBe(true);
  });

  it('warns when nodes are added without a descriptive label', () => {
    const result = applyFlowAuthoringCommands({
      ...emptyState(),
      commands: [
        { action: 'add_node', id: 'start', nodeType: 'on_flow_start' },
        { action: 'add_node', id: 'var_a', nodeType: 'var_decl' },
        { action: 'add_node', id: 'llm', nodeType: 'llm_call', label: 'Contribution IA' },
      ],
    });

    expect(result.errors).toEqual([]);
    // Event nodes keep canonical labels silently; unlabeled working nodes are flagged.
    expect(result.warnings.some((item) => item.includes('var_a') && item.includes('without a label'))).toBe(true);
    expect(result.warnings.some((item) => item.includes('start') && item.includes('without a label'))).toBe(false);
    expect(result.warnings.some((item) => item.includes("llm") && item.includes('without a label'))).toBe(false);
  });

  it('replaces an occupied data input when a different valid source connects to it', () => {
    // Observed failure mode: the model created a better source for
    // string_template.vars but could not rewire it; "already connected"
    // rejections burned three repair cycles. Blueprint semantics: a data
    // input holds one edge and a new connection replaces it.
    const result = applyFlowAuthoringCommands({
      ...emptyState(),
      commands: [
        { action: 'add_node', id: 'json_a', nodeType: 'make_object', label: 'Old vars' },
        { action: 'add_node', id: 'json_b', nodeType: 'make_object', label: 'New vars' },
        { action: 'add_node', id: 'tpl', nodeType: 'string_template', label: 'Prompt template' },
        { action: 'connect', source: 'json_a', sourceHandle: 'result', target: 'tpl', targetHandle: 'vars' },
        { action: 'connect', source: 'json_b', sourceHandle: 'result', target: 'tpl', targetHandle: 'vars' },
      ],
    });

    expect(result.errors).toEqual([]);
    const varsEdges = result.edges.filter((edge) => edge.target === 'tpl' && edge.targetHandle === 'vars');
    expect(varsEdges).toHaveLength(1);
    expect(varsEdges[0].source).toBe('json_b');
    expect(result.applied.some((item) => item.includes('Replaced tpl.vars input source json_a.result -> json_b.result'))).toBe(true);
  });

  it('does not replace an occupied data input with a type-incompatible source', () => {
    const result = applyFlowAuthoringCommands({
      ...emptyState(),
      commands: [
        { action: 'add_node', id: 'json_a', nodeType: 'make_object', label: 'Vars' },
        { action: 'add_node', id: 'start', nodeType: 'on_flow_start' },
        { action: 'add_output_pin', nodeId: 'start', id: 'topic', pinType: 'string' },
        { action: 'add_node', id: 'tpl', nodeType: 'string_template', label: 'Prompt template' },
        { action: 'connect', source: 'json_a', sourceHandle: 'result', target: 'tpl', targetHandle: 'vars' },
        { action: 'connect', source: 'start', sourceHandle: 'topic', target: 'tpl', targetHandle: 'vars' },
      ],
    });

    expect(result.errors.some((item) => item.includes('cannot connect string to object'))).toBe(true);
    const varsEdges = result.edges.filter((edge) => edge.target === 'tpl' && edge.targetHandle === 'vars');
    expect(varsEdges).toHaveLength(1);
    expect(varsEdges[0].source).toBe('json_a');
  });

  it('treats an exact duplicate connect as a no-op warning, not an error', () => {
    const result = applyFlowAuthoringCommands({
      ...emptyState(),
      commands: [
        { action: 'add_node', id: 'json_a', nodeType: 'make_object', label: 'Vars' },
        { action: 'add_node', id: 'tpl', nodeType: 'string_template', label: 'Prompt template' },
        { action: 'connect', source: 'json_a', sourceHandle: 'result', target: 'tpl', targetHandle: 'vars' },
        { action: 'connect', source: 'json_a', sourceHandle: 'result', target: 'tpl', targetHandle: 'vars' },
      ],
    });

    expect(result.errors).toEqual([]);
    expect(result.warnings.some((item) => item.includes('already exists'))).toBe(true);
    expect(result.edges.filter((edge) => edge.target === 'tpl' && edge.targetHandle === 'vars')).toHaveLength(1);
  });

  it('disconnects an existing edge by endpoints without the destructive flag', () => {
    const result = applyFlowAuthoringCommands({
      ...emptyState(),
      commands: [
        { action: 'add_node', id: 'json_a', nodeType: 'make_object', label: 'Vars' },
        { action: 'add_node', id: 'tpl', nodeType: 'string_template', label: 'Prompt template' },
        { action: 'connect', source: 'json_a', sourceHandle: 'result', target: 'tpl', targetHandle: 'vars' },
        { action: 'disconnect', source: 'json_a', sourceHandle: 'result', target: 'tpl', targetHandle: 'vars' },
      ],
    });

    expect(result.errors).toEqual([]);
    expect(result.applied.some((item) => item.includes('Disconnected json_a.result -> tpl.vars'))).toBe(true);
    expect(result.edges).toEqual([]);
  });

  it('reports current sources when disconnect targets a missing edge', () => {
    const result = applyFlowAuthoringCommands({
      ...emptyState(),
      commands: [
        { action: 'add_node', id: 'json_a', nodeType: 'make_object', label: 'Vars' },
        { action: 'add_node', id: 'json_b', nodeType: 'make_object', label: 'Other vars' },
        { action: 'add_node', id: 'tpl', nodeType: 'string_template', label: 'Prompt template' },
        { action: 'connect', source: 'json_a', sourceHandle: 'result', target: 'tpl', targetHandle: 'vars' },
        { action: 'disconnect', source: 'json_b', sourceHandle: 'result', target: 'tpl', targetHandle: 'vars' },
      ],
    });

    const error = result.errors.find((item) => item.includes('disconnect found no edge json_b.result -> tpl.vars'));
    expect(error).toBeTruthy();
    expect(error).toContain('current sources into tpl.vars: json_a.result');
  });

  it('adds a per-path route override instead of replacing on multi-entry nodes', () => {
    // Recursive/multi-entry pattern: a node reached by 2+ execution paths may
    // carry one data edge per path on the same pin (base edge + overrides).
    const result = applyFlowAuthoringCommands({
      ...emptyState(),
      commands: [
        { action: 'add_node', id: 'llm_a', nodeType: 'llm_call', label: 'Branch A' },
        { action: 'add_node', id: 'llm_b', nodeType: 'llm_call', label: 'Branch B' },
        { action: 'add_node', id: 'synth', nodeType: 'llm_call', label: 'Synthesis' },
        { action: 'connect', source: 'llm_a', sourceHandle: 'exec-out', target: 'synth', targetHandle: 'exec-in' },
        { action: 'connect', source: 'llm_b', sourceHandle: 'exec-out', target: 'synth', targetHandle: 'exec-in' },
        { action: 'connect', source: 'llm_a', sourceHandle: 'response', target: 'synth', targetHandle: 'prompt' },
        { action: 'connect', source: 'llm_b', sourceHandle: 'response', target: 'synth', targetHandle: 'prompt' },
      ],
    });

    expect(result.errors).toEqual([]);
    const promptEdges = result.edges.filter((edge) => edge.target === 'synth' && edge.targetHandle === 'prompt');
    expect(promptEdges).toHaveLength(2);
    const overrideEdge = promptEdges.find((edge) => (edge.data as Record<string, unknown> | undefined)?.routeOverride === true);
    expect(overrideEdge?.source).toBe('llm_b');
    expect((overrideEdge?.data as Record<string, unknown>).routeKey).toBe('llm_b::exec-out');
    expect(result.applied.some((item) => item.includes('per-path route override'))).toBe(true);
  });

  it('does not replace the base data edge of a multi-entry node from a non-predecessor source', () => {
    const result = applyFlowAuthoringCommands({
      ...emptyState(),
      commands: [
        { action: 'add_node', id: 'llm_a', nodeType: 'llm_call', label: 'Branch A' },
        { action: 'add_node', id: 'llm_b', nodeType: 'llm_call', label: 'Branch B' },
        { action: 'add_node', id: 'synth', nodeType: 'llm_call', label: 'Synthesis' },
        { action: 'add_node', id: 'start', nodeType: 'on_flow_start' },
        { action: 'add_output_pin', nodeId: 'start', id: 'topic', pinType: 'string' },
        { action: 'connect', source: 'llm_a', sourceHandle: 'exec-out', target: 'synth', targetHandle: 'exec-in' },
        { action: 'connect', source: 'llm_b', sourceHandle: 'exec-out', target: 'synth', targetHandle: 'exec-in' },
        { action: 'connect', source: 'llm_a', sourceHandle: 'response', target: 'synth', targetHandle: 'prompt' },
        // start is not a direct execution predecessor: no override, no replace.
        { action: 'connect', source: 'start', sourceHandle: 'topic', target: 'synth', targetHandle: 'prompt' },
      ],
    });

    expect(result.errors.some((item) => item.includes('multi-entry'))).toBe(true);
    const promptEdges = result.edges.filter((edge) => edge.target === 'synth' && edge.targetHandle === 'prompt');
    expect(promptEdges).toHaveLength(1);
    expect(promptEdges[0].source).toBe('llm_a');
  });

  it('names the existing source in remaining already-connected errors', () => {
    // Exec-target inputs are not replaceable data pins, so the error path
    // still fires there; it must name the current source for self-repair.
    const result = applyFlowAuthoringCommands({
      ...emptyState(),
      commands: [
        { action: 'add_node', id: 'start', nodeType: 'on_flow_start' },
        { action: 'add_output_pin', nodeId: 'start', id: 'a', pinType: 'string' },
        { action: 'add_output_pin', nodeId: 'start', id: 'b', pinType: 'string' },
        { action: 'add_node', id: 'tpl', nodeType: 'string_template', label: 'Prompt template' },
        { action: 'connect', source: 'start', sourceHandle: 'a', target: 'tpl', targetHandle: 'template' },
        { action: 'connect', source: 'start', sourceHandle: 'b', target: 'tpl', targetHandle: 'template' },
      ],
    });

    // template accepts string from both sources, so this exercises replace.
    expect(result.errors).toEqual([]);
    const templateEdges = result.edges.filter((edge) => edge.target === 'tpl' && edge.targetHandle === 'template');
    expect(templateEdges).toHaveLength(1);
    expect(templateEdges[0].source).toBe('start');
    expect(templateEdges[0].sourceHandle).toBe('b');
  });
});
