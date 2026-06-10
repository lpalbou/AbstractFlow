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
