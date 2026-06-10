import { describe, expect, it } from 'vitest';
import type { Edge, Node } from 'reactflow';
import type { FlowNodeData, VisualFlow } from '../types/flow';
import { applyFlowAuthoringCommands } from '../utils/flowAuthoringCommands';

import {
  assistantConversationClipboardText,
  assistantWorkflowStorageKey,
  authoringFailureMarkdown,
  computeAuthoringReadiness,
  isGatewayPlannerInternalWait,
  readinessProgressText,
  repairFeedbackText,
  shouldDisplayPlannerSubrunStatus,
  subRunIdsFromLedger,
  visiblePlannerStatus,
} from './AuthoringAssistantDrawer';

function toVisualFlow(name: string, nodes: Node<FlowNodeData>[], edges: Edge[]): VisualFlow {
  return {
    id: 'test-flow',
    name,
    nodes: nodes.map((node) => ({
      id: node.id,
      type: node.data.nodeType,
      position: node.position,
      data: node.data,
    })),
    edges: edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      sourceHandle: edge.sourceHandle || '',
      target: edge.target,
      targetHandle: edge.targetHandle || '',
    })),
  };
}

const DEEP_RESEARCH_REQUEST =
  'Create a complex deep research workflow with web_search and fetch_url, final report, sources, and audit summary.';

describe('AuthoringAssistantDrawer workflow-scoped conversation storage', () => {
  it('uses saved flow ids before draft ids for assistant storage', () => {
    expect(assistantWorkflowStorageKey('internet-search', 'draft-a')).toBe('flow:internet-search');
    expect(assistantWorkflowStorageKey(null, 'draft-a')).toBe('draft:draft-a');
    expect(assistantWorkflowStorageKey('', 'draft with spaces')).toBe('draft:draft%20with%20spaces');
  });

  it('copies a readable workflow-specific conversation transcript', () => {
    const text = assistantConversationClipboardText({
      workflowKey: 'flow:research',
      flowId: 'research',
      flowName: 'Research Flow',
      provider: 'OVH Provider',
      model: 'Qwen3.5-397B-A17B',
      draft: 'next instruction',
      messages: [
        { id: 'm1', role: 'assistant', content: 'Ready.' },
        { id: 'm2', role: 'user', content: 'Build a workflow.' },
      ],
    });
    expect(text).toContain('Workflow: Research Flow');
    expect(text).toContain('Conversation key: flow:research');
    expect(text).toContain('Assistant provider: OVH Provider');
    expect(text).toContain('### User');
    expect(text).toContain('Build a workflow.');
    expect(text).toContain('### Draft Input');
  });
});

function deepResearchCommands(includeSources: boolean) {
  return [
    { action: 'set_flow_name', name: 'Deep Research Workflow' },
    { action: 'add_node', id: 'start', nodeType: 'on_flow_start' },
    { action: 'add_output_pin', nodeId: 'start', id: 'topic', pinType: 'string' },
    { action: 'add_node', id: 'build_json', nodeType: 'make_object' },
    { action: 'add_node', id: 'string_template', nodeType: 'string_template' },
    { action: 'set_pin_default', nodeId: 'string_template', pin: 'template', value: 'Research {{topic}}.' },
    { action: 'add_node', id: 'tools_allowlist', nodeType: 'tools_allowlist' },
    { action: 'set_literal', nodeId: 'tools_allowlist', value: ['web_search', 'fetch_url'] },
    {
      action: 'add_node',
      id: 'agent',
      nodeType: 'agent',
      pinDefaults: {
        max_iterations: 50,
        system: 'You are a deep research agent. Search, fetch, verify, cite sources, and return a structured report.',
      },
    },
    { action: 'add_node', id: 'trace_report', nodeType: 'agent_trace_report' },
    { action: 'add_node', id: 'end', nodeType: 'on_flow_end' },
    { action: 'add_input_pin', nodeId: 'end', id: 'report', pinType: 'string' },
    { action: 'add_input_pin', nodeId: 'end', id: 'audit_summary', pinType: 'string' },
    ...(includeSources ? [{ action: 'add_input_pin', nodeId: 'end', id: 'sources', pinType: 'object' }] : []),
    { action: 'connect', source: 'start', sourceHandle: 'exec-out', target: 'agent', targetHandle: 'exec-in' },
    { action: 'connect', source: 'start', sourceHandle: 'topic', target: 'build_json', targetHandle: 'value' },
    { action: 'connect', source: 'build_json', sourceHandle: 'result', target: 'string_template', targetHandle: 'vars' },
    { action: 'connect', source: 'string_template', sourceHandle: 'result', target: 'agent', targetHandle: 'prompt' },
    { action: 'connect', source: 'tools_allowlist', sourceHandle: 'tools', target: 'agent', targetHandle: 'tools' },
    { action: 'connect', source: 'agent', sourceHandle: 'exec-out', target: 'end', targetHandle: 'exec-in' },
    { action: 'connect', source: 'agent', sourceHandle: 'response', target: 'end', targetHandle: 'report' },
    ...(includeSources ? [{ action: 'connect', source: 'agent', sourceHandle: 'data', target: 'end', targetHandle: 'sources' }] : []),
    { action: 'connect', source: 'agent', sourceHandle: 'scratchpad', target: 'trace_report', targetHandle: 'scratchpad' },
    { action: 'connect', source: 'trace_report', sourceHandle: 'result', target: 'end', targetHandle: 'audit_summary' },
  ];
}

function deepResearchWithArtifactsCommands() {
  const base = deepResearchCommands(true).filter((cmd) => {
    if (!cmd || typeof cmd !== 'object') return true;
    const record = cmd as Record<string, unknown>;
    return !(
      record.action === 'connect' &&
      record.source === 'agent' &&
      record.sourceHandle === 'exec-out' &&
      record.target === 'end' &&
      record.targetHandle === 'exec-in'
    );
  });
  return [
    ...base,
    { action: 'add_node', id: 'write_markdown', nodeType: 'write_file', label: 'Write Markdown Report' },
    { action: 'set_pin_default', nodeId: 'write_markdown', pin: 'file_path', value: 'reports/deep-research.md' },
    { action: 'connect', source: 'agent', sourceHandle: 'exec-out', target: 'write_markdown', targetHandle: 'exec-in' },
    { action: 'connect', source: 'agent', sourceHandle: 'response', target: 'write_markdown', targetHandle: 'content' },
    { action: 'add_input_pin', nodeId: 'end', id: 'markdown_path', pinType: 'string' },
    { action: 'connect', source: 'write_markdown', sourceHandle: 'file_path', target: 'end', targetHandle: 'markdown_path' },
    { action: 'add_node', id: 'write_pdf', nodeType: 'write_pdf', label: 'Write PDF Report' },
    { action: 'set_pin_default', nodeId: 'write_pdf', pin: 'file_path', value: 'reports/deep-research.pdf' },
    { action: 'connect', source: 'write_markdown', sourceHandle: 'exec-out', target: 'write_pdf', targetHandle: 'exec-in' },
    { action: 'connect', source: 'agent', sourceHandle: 'response', target: 'write_pdf', targetHandle: 'content' },
    { action: 'connect', source: 'write_pdf', sourceHandle: 'exec-out', target: 'end', targetHandle: 'exec-in' },
    { action: 'add_input_pin', nodeId: 'end', id: 'pdf_path', pinType: 'string' },
    { action: 'connect', source: 'write_pdf', sourceHandle: 'file_path', target: 'end', targetHandle: 'pdf_path' },
  ];
}

describe('AuthoringAssistantDrawer planner waits', () => {
  it('treats Gateway subworkflow waits as internal planner progress', () => {
    expect(isGatewayPlannerInternalWait({ status: 'waiting', waiting: { reason: 'subworkflow' } })).toBe(true);
    expect(isGatewayPlannerInternalWait({ status: 'waiting', wait_reason: 'subworkflow' })).toBe(true);
    expect(isGatewayPlannerInternalWait({ status: 'waiting', waiting: { wait_key: 'subworkflow:child-run' } })).toBe(true);
    expect(isGatewayPlannerInternalWait({ status: 'waiting', waiting: { details: { sub_run_id: 'child-run' } } })).toBe(true);
  });

  it('does not hide interactive Gateway waits', () => {
    expect(isGatewayPlannerInternalWait({ status: 'waiting', waiting: { reason: 'user' } })).toBe(false);
    expect(isGatewayPlannerInternalWait({ status: 'waiting', waiting: { reason: 'event' } })).toBe(false);
  });

  it('extracts child run ids from subworkflow ledger records', () => {
    expect(
      subRunIdsFromLedger([
        { result: { wait: { wait_key: 'subworkflow:child-a' } } },
        { result: { wait: { details: { sub_run_id: 'child-b' } } } },
        { effect: { type: 'start_subworkflow', payload: { subRunId: 'child-c' } } },
        { result: { sub_run_id: 'child-d' } },
        { result: { wait: { details: { sub_run_id: 'child-b' } } } },
      ])
    ).toEqual(['child-a', 'child-b', 'child-c', 'child-d']);
  });

  it('does not render completed child subruns as active progress', () => {
    expect(shouldDisplayPlannerSubrunStatus('running')).toBe(true);
    expect(shouldDisplayPlannerSubrunStatus('waiting for subworkflow')).toBe(true);
    expect(shouldDisplayPlannerSubrunStatus('completed')).toBe(false);
  });

  it('normalizes only active planner states into visible progress states', () => {
    expect(visiblePlannerStatus({ status: ' completed ', runId: 'root', role: 'root' })).toBeNull();
    expect(visiblePlannerStatus({ status: '', runId: 'root', role: 'root' })).toBeNull();
    expect(visiblePlannerStatus({ status: 'RUNNING', runId: 'child', role: 'subrun', parentRunId: 'root' })).toEqual({
      status: 'running',
      runId: 'child',
      role: 'subrun',
      parentRunId: 'root',
    });
  });
});

describe('AuthoringAssistantDrawer progress labels', () => {
  it('labels empty-draft readiness as checks to satisfy, not issues', () => {
    expect(readinessProgressText({ stage: 'planning_graph', applied: 0, issues: 11 })).toBe('11 readiness checks to satisfy');
    expect(readinessProgressText({ stage: 'checking_graph', applied: 4, issues: 2 })).toBe('2 readiness checks pending');
    expect(readinessProgressText({ stage: 'done', applied: 12, issues: 0 })).toBe('Readiness checks passed');
  });
});

describe('AuthoringAssistantDrawer failure report', () => {
  it('includes the returned plan, attempted commands, validator details, and candidate graph', () => {
    const markdown = authoringFailureMarkdown('Command plan rejected by the graph validator: connect refused invalid edge a.out -> b.in', false, {
      cycle: 2,
      modelNote: 'Assistant model: Gateway default (lmstudio / qwen).',
      plan: {
        status: 'continue',
        reply: 'I will build a research workflow.',
        workflowSteps: ['Collect a query', 'Build a prompt', 'Run the agent'],
        commands: [
          { action: 'add_node', id: 'start', nodeType: 'on_flow_start' },
          { action: 'connect', source: 'start.search_query', target: 'build_json.value' },
        ],
        selfReview: 'The graph still needs validation.',
        nextStep: 'Fix the invalid edge.',
        howItWorks: '',
        howToTest: '',
        expectedResult: '',
      },
      rawPlannerResponse: '',
      readiness: { issues: ['Expose a report output.'], requiresRuntimeTools: true, requiresResearchScaffold: true },
      result: {
        flowName: 'Deep Research',
        flowInterfaces: [],
        nodes: [
          {
            id: 'start',
            type: 'custom',
            position: { x: 0, y: 0 },
            data: { nodeType: 'on_flow_start', label: 'On Flow Start', icon: '🏁', headerColor: '#d0443e', inputs: [], outputs: [] },
          },
        ],
        edges: [],
        applied: ['Added On Flow Start'],
        warnings: ['Canonicalized build_json.value'],
        errors: ['connect refused invalid edge start.search_query -> build_json.value (Input pin value already connected)'],
        touchedNodeIds: ['start'],
        snapshot: { flowName: 'Untitled Flow', flowInterfaces: [], nodes: [], edges: [] },
      },
    });

    expect(markdown).toContain('**Planner Reply**');
    expect(markdown).toContain('Collect a query');
    expect(markdown).toContain('"action":"connect"');
    expect(markdown).toContain('**Validator Errors**');
    expect(markdown).toContain('Input pin value already connected');
    expect(markdown).toContain('**Candidate Graph Before Rejection**');
    expect(markdown).toContain('start (on_flow_start)');
    expect(markdown).toContain('Expose a report output.');
  });
});

describe('AuthoringAssistantDrawer repair feedback', () => {
  it('serializes rejected validator details for the next autonomous planning cycle', () => {
    const feedback = repairFeedbackText([
      {
        cycle: 1,
        plan: {
          status: 'continue',
          reply: 'Build a deep research scaffold.',
          commands: [{ action: 'connect', source: 'trace_report.result', target: 'on_end.trace_summary' }],
          selfReview: '',
          nextStep: '',
          howItWorks: '',
          howToTest: '',
          expectedResult: '',
          workflowSteps: [],
        },
        result: {
          flowName: 'Deep Research',
          flowInterfaces: [],
          nodes: [
            {
              id: 'trace_report',
              type: 'custom',
              position: { x: 0, y: 0 },
              data: { nodeType: 'agent_trace_report', label: 'Agent Trace Report', icon: '📋', headerColor: '#2563eb', inputs: [], outputs: [] },
            },
          ],
          edges: [],
          applied: ['Added Agent Trace Report'],
          warnings: [],
          errors: ['connect refused invalid edge trace_report.result -> on_end.trace_summary (Type mismatch: cannot connect string to object)'],
          touchedNodeIds: ['trace_report'],
          snapshot: { flowName: 'Untitled Flow', flowInterfaces: [], nodes: [], edges: [] },
        },
        candidateReadiness: { issues: ['Expose an audit or trace summary through a connected On Flow End data input.'], requiresRuntimeTools: true, requiresResearchScaffold: true },
      },
    ]);

    expect(feedback).toContain('REJECTED ATTEMPT CYCLE 1');
    expect(feedback).toContain('"action":"connect"');
    expect(feedback).toContain('Type mismatch: cannot connect string to object');
    expect(feedback).toContain('Candidate graph after accepted commands before rejection');
    expect(feedback).toContain('Expose an audit or trace summary');
  });
});

describe('AuthoringAssistantDrawer readiness', () => {
  it('does not mark a deep research workflow ready until report, sources, audit, tools, prompt, and execution wiring exist', () => {
    const missingSources = applyFlowAuthoringCommands({
      flowName: 'Untitled Flow',
      flowInterfaces: [],
      nodes: [],
      edges: [],
      commands: deepResearchCommands(false),
    });
    expect(missingSources.errors).toEqual([]);

    const missingSourcesReadiness = computeAuthoringReadiness(
      toVisualFlow(missingSources.flowName, missingSources.nodes, missingSources.edges),
      DEEP_RESEARCH_REQUEST,
      {}
    );
    expect(missingSourcesReadiness.issues).toContain('Expose sources or citations through a connected On Flow End data input.');

    const complete = applyFlowAuthoringCommands({
      flowName: 'Untitled Flow',
      flowInterfaces: [],
      nodes: [],
      edges: [],
      commands: deepResearchCommands(true),
    });
    expect(complete.errors).toEqual([]);

    const completeReadiness = computeAuthoringReadiness(
      toVisualFlow(complete.flowName, complete.nodes, complete.edges),
      DEEP_RESEARCH_REQUEST,
      {}
    );
    expect(completeReadiness.issues).toEqual([]);
  });

  it('does not accept Agent.meta as research sources', () => {
    const result = applyFlowAuthoringCommands({
      flowName: 'Untitled Flow',
      flowInterfaces: [],
      nodes: [],
      edges: [],
      commands: [
        ...deepResearchCommands(false),
        { action: 'add_input_pin', nodeId: 'end', id: 'sources', pinType: 'object' },
        { action: 'connect', source: 'agent', sourceHandle: 'meta', target: 'end', targetHandle: 'sources' },
      ],
    });
    expect(result.errors).toEqual([]);

    const readiness = computeAuthoringReadiness(
      toVisualFlow(result.flowName, result.nodes, result.edges),
      DEEP_RESEARCH_REQUEST,
      {}
    );
    expect(readiness.issues).toContain(
      'Do not expose Agent.meta as research sources; use structured Agent.data, parsed report citations, or a dedicated sources object.'
    );
  });

  it('requires executable markdown and PDF artifact generation when requested', () => {
    const request = 'Create a deep research workflow that produces both markdown and PDF results.';
    const missingArtifacts = applyFlowAuthoringCommands({
      flowName: 'Untitled Flow',
      flowInterfaces: [],
      nodes: [],
      edges: [],
      commands: deepResearchCommands(true),
    });
    expect(missingArtifacts.errors).toEqual([]);

    const missingReadiness = computeAuthoringReadiness(
      toVisualFlow(missingArtifacts.flowName, missingArtifacts.nodes, missingArtifacts.edges),
      request,
      {}
    );
    expect(missingReadiness.issues).toContain('Create a Write File node for the Markdown artifact, connect report content to Write File.content, and place it on the execution path before On Flow End.');
    expect(missingReadiness.issues).toContain(
      'Create a Write PDF node for the PDF artifact, set a .pdf file_path, connect report content to Write PDF.content, and place it on the execution path before On Flow End.'
    );

    const completeArtifacts = applyFlowAuthoringCommands({
      flowName: 'Untitled Flow',
      flowInterfaces: [],
      nodes: [],
      edges: [],
      commands: deepResearchWithArtifactsCommands(),
    });
    expect(completeArtifacts.errors).toEqual([]);

    const artifactReadiness = computeAuthoringReadiness(
      toVisualFlow(completeArtifacts.flowName, completeArtifacts.nodes, completeArtifacts.edges),
      request,
      {}
    );
    expect(artifactReadiness.issues).toEqual([]);
  });
});
