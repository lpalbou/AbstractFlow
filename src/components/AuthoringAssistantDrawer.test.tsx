import { describe, expect, it } from 'vitest';
import type { Edge, Node } from 'reactflow';
import type { FlowNodeData, VisualFlow } from '../types/flow';
import { getAllNodeTemplates } from '../types/nodes';
import { applyFlowAuthoringCommands } from '../utils/flowAuthoringCommands';

import {
  activityClipboardText,
  assistantConversationClipboardText,
  AUTHORING_CYCLE_OPTIONS,
  AUTHORING_DEFAULT_MAX_CYCLES,
  normalizeMaxCycles,
  assistantSystemPrompt,
  assistantWorkflowStorageKey,
  authoringFailureMarkdown,
  AuthoringInterruptedError,
  buildAcceptanceReviewPrompt,
  buildGatewayPromptContext,
  computeAuthoringReadiness,
  conversationContextFor,
  cycleNoteFor,
  emptyBatchLoopAction,
  extractJsonObjectText,
  formatActivityTime,
  formatElapsed,
  isGatewayPlannerInternalWait,
  looksLikePlanText,
  parseAcceptanceReview,
  parsePlan,
  PlannerEmptyResponseError,
  postApplyLoopAction,
  readinessProgressText,
  repairFeedbackText,
  repeatedBatchProgress,
  restoreActivityPanelState,
  shouldDisplayPlannerSubrunStatus,
  stageTickerText,
  subRunIdsFromLedger,
  visiblePlannerStatus,
  type AuthoringActivityEntry,
  type PersistedActivityState,
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

  it('formats elapsed time and activity offsets as m:ss', () => {
    expect(formatElapsed(0)).toBe('0:00');
    expect(formatElapsed(7)).toBe('0:07');
    expect(formatElapsed(134.8)).toBe('2:14');
    expect(formatActivityTime(10_000, null)).toBe('0:00');
    expect(formatActivityTime(75_500, 10_000)).toBe('1:05');
    expect(formatActivityTime(5_000, 10_000)).toBe('0:00');
  });
});

describe('AuthoringAssistantDrawer interruption', () => {
  it('marks user stops with a dedicated error type distinct from failures', () => {
    const error = new AuthoringInterruptedError();
    expect(error.name).toBe('AuthoringInterrupted');
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain('interrupted');
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
        graph: null,
        selfReview: 'The graph still needs validation.',
        nextStep: 'Fix the invalid edge.',
        howItWorks: '',
        howToTest: '',
        expectedResult: '',
        acceptanceCriteria: [],
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
          graph: null,
          selfReview: '',
          nextStep: '',
          howItWorks: '',
          howToTest: '',
          expectedResult: '',
          workflowSteps: [],
          acceptanceCriteria: [],
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
    expect(feedback).toContain('Candidate workflow document after accepted commands before rejection');
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

  it('does not force the research scaffold onto a discussion workflow that merely mentions research', () => {
    // Regression (draft-4517c65caf619): "genuine discussion, research, and
    // deepening of ideas" triggered the full deep-research floor (Agent node,
    // sources, citations, audit trace), producing 8 readiness issues the
    // model could never satisfy with a multi-LLM discussion graph.
    const discussionRequest =
      'I would like you to create a workflow to determine (a) the number of AIs in a discussion and (b) the maximum number of discussion cycles between these AIs before concluding and providing an answer.\n\nThere must be a genuine discussion, research, and deepening of ideas. Each iteration must add something more to the reasoning and the discussion. When this discussion ends, a final response is provided to the user based on all the elements addressed.';
    const readiness = computeAuthoringReadiness(
      toVisualFlow('Discussion Multi-AI', [], []),
      discussionRequest,
      {}
    );
    expect(readiness.requiresResearchScaffold).toBe(false);
    expect(readiness.issues).not.toContain('Add an Agent node for the research and reporting step.');
    expect(readiness.issues).not.toContain('Expose sources or citations through a connected On Flow End data input.');
  });

  it('accepts a dynamically wired model pin with provider left on Gateway defaults', () => {
    // Regression (flow 4a9eee4e): "Set both provider and model, or leave both
    // blank" fired on llm_call.model wired from a loop item (a model pool).
    // The demand was unsatisfiable without deleting a wire the design needed,
    // and the authoring loop burned 10 cycles trying to clear it.
    const result = applyFlowAuthoringCommands({
      flowName: 'Untitled Flow',
      flowInterfaces: [],
      nodes: [],
      edges: [],
      commands: [
        { action: 'add_node', id: 'start', nodeType: 'on_flow_start' },
        { action: 'add_node', id: 'pool', nodeType: 'literal_array', templateLabel: 'Array' },
        { action: 'set_literal', nodeId: 'pool', value: ['model-a', 'model-b'] },
        { action: 'add_node', id: 'ploop', nodeType: 'loop' },
        { action: 'add_node', id: 'llm', nodeType: 'llm_call' },
        { action: 'add_node', id: 'end', nodeType: 'on_flow_end' },
        { action: 'connect', source: 'start', sourceHandle: 'exec-out', target: 'ploop', targetHandle: 'exec-in' },
        { action: 'connect', source: 'pool', sourceHandle: 'value', target: 'ploop', targetHandle: 'items' },
        { action: 'connect', source: 'ploop', sourceHandle: 'loop', target: 'llm', targetHandle: 'exec-in' },
        { action: 'connect', source: 'ploop', sourceHandle: 'item', target: 'llm', targetHandle: 'model' },
        { action: 'connect', source: 'ploop', sourceHandle: 'done', target: 'end', targetHandle: 'exec-in' },
      ],
    });
    expect(result.errors).toEqual([]);

    const readiness = computeAuthoringReadiness(
      toVisualFlow(result.flowName, result.nodes, result.edges),
      'A discussion between several AIs using different models.',
      {}
    );
    expect(readiness.issues.filter((issue) => /provider/i.test(issue))).toEqual([]);
  });

  it('flags a half-typed provider/model default pair with the current values', () => {
    const result = applyFlowAuthoringCommands({
      flowName: 'Untitled Flow',
      flowInterfaces: [],
      nodes: [],
      edges: [],
      commands: [
        { action: 'add_node', id: 'start', nodeType: 'on_flow_start' },
        { action: 'add_node', id: 'llm', nodeType: 'llm_call' },
        { action: 'add_node', id: 'end', nodeType: 'on_flow_end' },
        { action: 'set_pin_default', nodeId: 'llm', pin: 'provider', value: 'openai' },
        { action: 'connect', source: 'start', sourceHandle: 'exec-out', target: 'llm', targetHandle: 'exec-in' },
        { action: 'connect', source: 'llm', sourceHandle: 'exec-out', target: 'end', targetHandle: 'exec-in' },
      ],
    });
    expect(result.errors).toEqual([]);

    const readiness = computeAuthoringReadiness(
      toVisualFlow(result.flowName, result.nodes, result.edges),
      'Summarize a text.',
      {}
    );
    // The message names the current values so users and the authoring model
    // can see exactly what to fix (the old message gave no state at all, and
    // the old check could not even see typed pin defaults).
    expect(
      readiness.issues.some((issue) =>
        issue.includes('Provider is "openai" but model is blank')
      )
    ).toBe(true);
  });

  it('still requires the research scaffold for genuine research deliverables', () => {
    const flow = toVisualFlow('Research', [], []);
    expect(computeAuthoringReadiness(flow, 'Create an internet research workflow about a topic.', {}).requiresResearchScaffold).toBe(true);
    expect(computeAuthoringReadiness(flow, DEEP_RESEARCH_REQUEST, {}).requiresResearchScaffold).toBe(true);
    expect(computeAuthoringReadiness(flow, 'Build a research report with cited sources.', {}).requiresResearchScaffold).toBe(true);
    expect(computeAuthoringReadiness(flow, 'Summarize tomorrow\'s news into a digest.', {}).requiresResearchScaffold).toBe(true);
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
    expect(missingReadiness.issues).toContain('Create a Write File node for the Markdown report file, connect report content to Write File.content, and place it on the execution path before On Flow End.');
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

describe('AuthoringAssistantDrawer loop completion ownership', () => {
  it('keeps cycling while the model returns continue, even with clean readiness', () => {
    // Regression guard: the loop used to force-stop on clean heuristic
    // readiness, cutting the model off before it finished its own plan.
    expect(postApplyLoopAction('continue', 0)).toBe('continue');
    expect(postApplyLoopAction('continue', 3)).toBe('continue');
  });

  it('routes a done claim through acceptance review only when readiness is clean', () => {
    expect(postApplyLoopAction('done', 0)).toBe('request-review');
    expect(postApplyLoopAction('done', 2)).toBe('continue');
  });

  it('never hard-fails a command-less continue; it notes, retries, then stalls as blocked', () => {
    // Regression (draft-4517c65caf619): a "continue" plan with zero commands
    // used to throw "Gateway assistant returned no graph commands", killing
    // the whole turn at cycle 8 of an otherwise progressing build.
    expect(emptyBatchLoopAction('continue', 3, 0, 2)).toBe('note-and-continue');
    expect(emptyBatchLoopAction('continue', 3, 1, 2)).toBe('note-and-continue');
    expect(emptyBatchLoopAction('continue', 3, 2, 2)).toBe('stalled');
  });

  it('routes command-less done and blocked statuses correctly', () => {
    expect(emptyBatchLoopAction('done', 0, 0, 2)).toBe('request-review');
    // done with readiness issues gets a corrective cycle instead of a hard failure.
    expect(emptyBatchLoopAction('done', 2, 0, 2)).toBe('note-and-continue');
    expect(emptyBatchLoopAction('needs_user', 1, 0, 2)).toBe('blocked');
    expect(emptyBatchLoopAction('failed', 0, 0, 2)).toBe('blocked');
  });

  it('counts identical applied batches with unchanged readiness as repetition, not progress', () => {
    // Regression (flow 4a9eee4e): "Set provider; Set model" applied 8 times
    // across 10 minutes, each cycle counted as progress because commands
    // "applied", until the 20-cycle cap failed the turn.
    const applied = ['Set llm.provider = ""', 'Set llm.model = ""'];
    const issues = ['AI Participant Response: Provider is blank'];

    const first = repeatedBatchProgress('', applied, issues, 0);
    expect(first.repeats).toBe(0);
    const second = repeatedBatchProgress(first.signature, applied, issues, first.repeats);
    expect(second.repeats).toBe(1);
    const third = repeatedBatchProgress(second.signature, applied, issues, second.repeats);
    expect(third.repeats).toBe(2);
  });

  it('resets the repetition count when the batch or the readiness issues change', () => {
    const issues = ['issue-a'];
    const first = repeatedBatchProgress('', ['Set llm.provider = ""'], issues, 0);
    const second = repeatedBatchProgress(first.signature, ['Set llm.provider = ""'], issues, first.repeats);
    expect(second.repeats).toBe(1);
    // Different batch -> reset.
    const differentBatch = repeatedBatchProgress(second.signature, ['Connected a.x -> b.y'], issues, second.repeats);
    expect(differentBatch.repeats).toBe(0);
    // Same batch but the readiness issues changed -> real progress -> reset.
    const differentIssues = repeatedBatchProgress(second.signature, ['Set llm.provider = ""'], [], second.repeats);
    expect(differentIssues.repeats).toBe(0);
  });

  it('summarizes applied cycles with the pending plan for later cycles', () => {
    const note = cycleNoteFor(
      2,
      { status: 'continue', nextStep: 'Wire the model pool into the loop.', workflowSteps: ['Add For loop', 'Add LLM Call per participant'] },
      13
    );
    expect(note).toContain('Cycle 2: applied 13 changes (status continue).');
    expect(note).toContain('Wire the model pool into the loop.');
    expect(note).toContain('Add For loop | Add LLM Call per participant');
  });
});

describe('AuthoringAssistantDrawer acceptance review', () => {
  it('parses pass and fail verdicts', () => {
    expect(parseAcceptanceReview('{"verdict":"pass","unmet":[],"notes":"ok"}')).toEqual({ verdict: 'pass', unmet: [], notes: 'ok' });
    expect(
      parseAcceptanceReview('{"verdict":"fail","unmet":["No distinct model per participant"],"notes":""}')
    ).toEqual({ verdict: 'fail', unmet: ['No distinct model per participant'], notes: '' });
  });

  it('rejects malformed or non-actionable reviews', () => {
    expect(parseAcceptanceReview('not json')).toBeNull();
    expect(parseAcceptanceReview('{"verdict":"maybe","unmet":[]}')).toBeNull();
    // A fail without findings cannot drive a repair cycle.
    expect(parseAcceptanceReview('{"verdict":"fail","unmet":[]}')).toBeNull();
  });

  it('builds a review prompt around the request, criteria, and graph', () => {
    const prompt = buildAcceptanceReviewPrompt({
      request: 'N AIs discuss for M rounds with different models.',
      priorUserTurns: 'USER TURN 1: ...',
      criteria: ['Each participant uses a distinct model'],
      graph: '{"nodes":[]}',
    });
    expect(prompt).toContain('USER REQUEST:');
    expect(prompt).toContain('Each participant uses a distinct model');
    expect(prompt).toContain('CURRENT DRAFT GRAPH:');
  });

  it('parses reviews wrapped in markdown fences or prose', () => {
    expect(parseAcceptanceReview('```json\n{"verdict":"pass","unmet":[],"notes":""}\n```')).toEqual({
      verdict: 'pass',
      unmet: [],
      notes: '',
    });
    expect(parseAcceptanceReview('Here is my verdict:\n{"verdict":"fail","unmet":["missing loop"]}\nDone.')).toEqual({
      verdict: 'fail',
      unmet: ['missing loop'],
      notes: '',
    });
  });
});

describe('AuthoringAssistantDrawer plan response tolerance', () => {
  const planJson =
    '{"status":"done","reply":"ok","commands":[{"action":"set_flow_name","name":"X"}],"self_review":"","next_step":""}';

  it('extracts a JSON object from fenced and prose-wrapped responses', () => {
    expect(extractJsonObjectText(planJson)).toBe(planJson);
    expect(extractJsonObjectText('```json\n' + planJson + '\n```')).toBe(planJson);
    expect(extractJsonObjectText('Voici le plan :\n' + planJson + '\nFin.')).toBe(planJson);
    // String-aware: braces inside string values must not break the scan.
    const withBraces = '{"status":"done","reply":"uses { and } inside","commands":[]}';
    expect(extractJsonObjectText('prefix ' + withBraces + ' suffix')).toBe(withBraces);
    expect(extractJsonObjectText('no json here')).toBe('');
  });

  // Document-mode plan: the model emits the full workflow under "graph"
  // (no commands array at all).
  const graphPlanJson =
    '{"status":"continue","reply":"ok","graph":{"flow_name":"X","nodes":[{"id":"start","type":"on_flow_start"}],"edges":[]},"self_review":"","next_step":""}';

  it('parses plans despite fences or surrounding prose', () => {
    expect(parsePlan(planJson)?.status).toBe('done');
    expect(parsePlan('```json\n' + planJson + '\n```')?.status).toBe('done');
    expect(parsePlan('Je construis le workflow.\n' + planJson)?.status).toBe('done');
  });

  it('parses document-mode plans carrying a graph instead of commands', () => {
    const plan = parsePlan(graphPlanJson);
    expect(plan?.status).toBe('continue');
    expect(plan?.graph).toEqual({
      flow_name: 'X',
      nodes: [{ id: 'start', type: 'on_flow_start' }],
      edges: [],
    });
    // Commands default to an empty batch; the loop compiles the graph diff.
    expect(plan?.commands).toEqual([]);
    // Fenced/prose-wrapped document plans parse the same way.
    expect(parsePlan('```json\n' + graphPlanJson + '\n```')?.graph).toBeTruthy();
    expect(parsePlan('Voici le workflow.\n' + graphPlanJson)?.graph).toBeTruthy();
    // A command-mode plan keeps graph null (compat path).
    expect(parsePlan(planJson)?.graph).toBeNull();
  });

  it('rejects continue plans with neither graph nor commands and non-object graphs', () => {
    expect(parsePlan('{"status":"continue","reply":"ok"}')).toBeNull();
    // Arrays are not a valid document; without commands the continue plan is unusable.
    expect(parsePlan('{"status":"continue","reply":"ok","graph":[1,2]}')).toBeNull();
    // Blocked/done plans may arrive without either field.
    expect(parsePlan('{"status":"needs_user","reply":"which provider?"}')?.status).toBe('needs_user');
  });

  it('returns null for truncated or non-plan JSON', () => {
    expect(parsePlan(planJson.slice(0, planJson.length - 20))).toBeNull();
    // Truncated document plans (mid-graph) must fail parse so the retry path runs.
    expect(parsePlan(graphPlanJson.slice(0, graphPlanJson.length - 30))).toBeNull();
    expect(parsePlan('{"foo":"bar"}')).toBeNull();
    expect(parsePlan('')).toBeNull();
  });

  it('recognizes plan-looking text so truncated answers retry instead of failing as missing', () => {
    expect(looksLikePlanText(planJson.slice(0, 60))).toBe(true);
    expect(looksLikePlanText('```json\n{"status":"continue","commands":[')).toBe(true);
    // Document-mode truncations are recognized via the "graph" key.
    expect(looksLikePlanText('{"status":"continue","reply":"ok","graph":{"flow_name":')).toBe(true);
    expect(looksLikePlanText('completed')).toBe(false);
    expect(looksLikePlanText('')).toBe(false);
  });

  it('keeps a typed error for runs that complete without any response', () => {
    const error = new PlannerEmptyResponseError('run-123');
    expect(error.name).toBe('PlannerEmptyResponse');
    expect(error.message).toContain('run-123');
    expect(error.message).toContain('without an authoring response');
  });
});

describe('AuthoringAssistantDrawer conversation replay', () => {
  it('replays assistant turns trimmed so pending plan items survive across turns', () => {
    const longAssistant = `**Workflow Plan**\n- 1. Add nodes\n- 6. Ajouter la logique de sélection de modèles\n${'x'.repeat(2000)}`;
    const context = conversationContextFor([
      { id: 'u1', role: 'user', content: 'Create a multi-AI discussion workflow.' },
      { id: 'a1', role: 'assistant', content: longAssistant },
      { id: 'u2', role: 'user', content: 'Each AI must use a different model.' },
    ]);
    expect(context).toContain('USER TURN 1:');
    expect(context).toContain('ASSISTANT TURN 2');
    expect(context).toContain('Ajouter la logique de sélection de modèles');
    expect(context).toContain('#TRUNCATION');
    expect(context).toContain('Each AI must use a different model.');
  });

  it('gives follow-up turns the prior conversation AND the current workflow graph', () => {
    // Build the current draft the way a prior turn would have left it.
    const applied = applyFlowAuthoringCommands({
      flowName: 'Discussion Multi-IA Itérative',
      flowInterfaces: [],
      nodes: [],
      edges: [],
      commands: [
        { action: 'add_node', id: 'start', nodeType: 'on_flow_start' },
        { action: 'add_node', id: 'var_transcript', nodeType: 'var_decl', label: 'Transcript de discussion' },
        { action: 'set_pin_default', nodeId: 'var_transcript', pin: 'name', value: 'transcript' },
        { action: 'add_node', id: 'synthesis_llm', nodeType: 'llm_call', label: 'Synthèse Finale' },
        { action: 'connect', source: 'start', sourceHandle: 'exec-out', target: 'synthesis_llm', targetHandle: 'exec-in' },
      ],
    });
    expect(applied.errors).toEqual([]);
    const flow = toVisualFlow(applied.flowName, applied.nodes, applied.edges);

    const followUpRequest = 'Ajoute un résumé par cycle dans le transcript.';
    const readiness = computeAuthoringReadiness(flow, followUpRequest, {});
    const context = buildGatewayPromptContext(
      followUpRequest,
      flow,
      null,
      [
        { id: 'u1', role: 'user', content: 'Crée un workflow de discussion multi-IA.' },
        { id: 'a1', role: 'assistant', content: 'Workflow de discussion multi-IA itérative complété avec succès.' },
      ],
      { readiness, tools: { text: 'No tools discovered.', selectedTools: 0, totalTools: 0 }, preflightOptions: {} }
    );

    // Prior conversation is replayed inside the prompt.
    expect(context.prompt).toContain('Crée un workflow de discussion multi-IA.');
    expect(context.prompt).toContain('complété avec succès');
    // The live graph is replayed as the authoring document: nodes, labels,
    // declared variable config, edges.
    expect(context.prompt).toContain('CURRENT WORKFLOW DOCUMENT');
    expect(context.prompt).toContain('var_transcript');
    expect(context.prompt).toContain('Transcript de discussion');
    expect(context.prompt).toContain('"name": "transcript"');
    expect(context.prompt).toContain('synthesis_llm');
    expect(context.prompt).toContain('start.exec-out');
    // And the new request is the active instruction.
    expect(context.prompt).toContain(followUpRequest);
  });
});

describe('AuthoringAssistantDrawer language and follow-up question contract', () => {
  it('instructs the model to match the request language and never embeds non-English example labels', () => {
    // Regression: an English request produced a French workflow. The system
    // prompt carried a French example label and no explicit language rule.
    const prompt = assistantSystemPrompt();
    expect(prompt).toContain('language of the USER REQUEST');
    expect(prompt).not.toContain('Transcript de discussion');
  });

  it('anchors the language directive at the request site and marks replayed history as non-authoritative', () => {
    // Regression: with a French prior conversation replayed in the prompt,
    // an English follow-up request still produced French labels. The active
    // request must carry the language rule next to its own text.
    const flow = toVisualFlow('Untitled Flow', [], []);
    const readiness = computeAuthoringReadiness(flow, 'Build a discussion workflow.', {});
    const context = buildGatewayPromptContext(
      'Build a discussion workflow.',
      flow,
      null,
      [
        { id: 'u1', role: 'user', content: 'Crée un workflow de discussion multi-IA.' },
        { id: 'a1', role: 'assistant', content: 'Workflow créé avec succès.' },
      ],
      { readiness, tools: { text: 'No tools discovered.', selectedTools: 0, totalTools: 0 }, preflightOptions: {} }
    );
    expect(context.prompt).toContain('in the language of THIS request');
    expect(context.prompt).toContain('the USER REQUEST above controls the language');
    // The directive precedes the replayed (possibly other-language) history.
    expect(context.prompt.indexOf('language of THIS request')).toBeLessThan(context.prompt.indexOf('Crée un workflow'));
  });

  it('instructs the model to ask the user instead of stalling in the loop', () => {
    const prompt = assistantSystemPrompt();
    expect(prompt).toContain('needs_user');
    expect(prompt).toContain('Ask instead of stalling');
    // Document mode: stalling is prevented by ownership ("continue" must carry
    // graph work) and explicit repair guidance, not an empty-batch prohibition.
    expect(prompt).toContain('repairs keep failing, ask the user');
  });
});

describe('AuthoringAssistantDrawer live stage ticker', () => {
  it('prefixes the cycle and prefers the stage purpose detail over the label', () => {
    expect(
      stageTickerText({ cycle: 3, label: 'Planning workflow graph (cycle 3)', detail: 'Waiting for the model — authoring the full workflow document' })
    ).toBe('Cycle 3 · Waiting for the model — authoring the full workflow document');
    expect(stageTickerText({ label: 'Resolving Gateway model' })).toBe('Resolving Gateway model');
  });
});

describe('AuthoringAssistantDrawer catalog fidelity (ADR-0026)', () => {
  it('keeps every template and pin description intact in the prompt — no budget truncation', () => {
    // The catalog rendering may compact FORMATTING (one line per template
    // instead of repeated headings), but it must never drop or slice semantic
    // content: full node descriptions and full per-pin descriptions are the
    // model's only source for node semantics.
    const flow = toVisualFlow('Untitled Flow', [], []);
    const readiness = computeAuthoringReadiness(flow, 'Build a research workflow.', {});
    const context = buildGatewayPromptContext(
      'Build a research workflow.',
      flow,
      null,
      [],
      { readiness, tools: { text: 'No tools discovered.', selectedTools: 0, totalTools: 0 }, preflightOptions: {} }
    );
    const normalize = (text: string) => text.replace(/\s+/g, ' ').trim();
    const prompt = normalize(context.prompt);
    const templates = getAllNodeTemplates().filter((template) => !template.hiddenInPalette && !template.deprecated);
    expect(templates.length).toBeGreaterThan(20);
    for (const template of templates) {
      if (template.description) {
        expect(prompt).toContain(normalize(template.description));
      }
      for (const pin of [...template.inputs, ...template.outputs]) {
        if (pin.description) expect(prompt).toContain(normalize(pin.description));
        if (pin.label && pin.label !== pin.id) expect(prompt).toContain(`${pin.id}:${pin.type} "${pin.label}"`);
      }
    }
    // The compact one-line catalog grammar is present.
    expect(context.prompt).toContain('Grammar per line');
    expect(context.prompt).toMatch(/- agent \(/);
  });

  it('ships the node-choice and tool-selection decision guidance to the model every cycle', () => {
    // The authoring model only knows AbstractFlow through this prompt. These
    // contracts cover the two recurring quality gaps observed in real runs:
    // picking llm_call vs agent vs direct tool calls, and matching each
    // agent's tool allowlist to its role.
    const flow = toVisualFlow('Untitled Flow', [], []);
    const readiness = computeAuthoringReadiness(flow, 'Build a research workflow.', {});
    const context = buildGatewayPromptContext(
      'Build a research workflow.',
      flow,
      null,
      [],
      { readiness, tools: { text: 'No tools discovered.', selectedTools: 0, totalTools: 0 }, preflightOptions: {} }
    );
    // llm_call vs agent vs deterministic tool-call decision matrix.
    expect(context.prompt).toContain('decide per\nstep, not per workflow');
    expect(context.prompt).toContain('ONE model pass over inputs already in the graph');
    expect(context.prompt).toContain('DISCOVER information or iterate');
    expect(context.prompt).toContain('a bare `llm_call` CANNOT satisfy it');
    // Per-agent least-privilege tool selection + the unset-tools default.
    expect(context.prompt).toContain('Tool selection discipline (per agent, least privilege)');
    expect(context.prompt).toContain('DIFFERENT allowlists');
    expect(context.prompt).toContain('FULL runtime tool set');
    expect(context.prompt).toContain('Never invent tool names');
    // Wiring mistakes observed in real runs stay documented.
    expect(context.prompt).toContain('Common rejected-edge mistakes');
  });

  it('teaches the artifact versus server-path source contract to the planner', () => {
    const prompt = assistantSystemPrompt();
    expect(prompt).toContain('Artifact = saved reusable file');
    expect(prompt).toContain('Local File = upload from this computer');
    expect(prompt).toContain('Server File = workspace-scoped server file');
    expect(prompt).toContain('Artifact pins expect saved artifacts; Read File/Write File use workspace-scoped server paths');
  });
});

describe('AuthoringAssistantDrawer activity panel export', () => {
  it('copies the activity feed grouped by planning cycle', () => {
    const start = Date.now();
    const entries: AuthoringActivityEntry[] = [
      { id: 'a', ts: start, kind: 'info', text: 'Turn started (request 120 chars)' },
      { id: 'b', ts: start + 5000, kind: 'model', text: 'Sending plan request (12k chars prompt)', cycle: 1 },
      { id: 'c', ts: start + 65000, kind: 'apply', text: 'Applied 14 changes — added start; added loop; +12 more', cycle: 1 },
      { id: 'd', ts: start + 70000, kind: 'model', text: 'Sending plan request (15k chars prompt)', cycle: 2 },
      { id: 'e', ts: start + 130000, kind: 'error', text: 'Batch rejected (1 error)', cycle: 2 },
    ];
    const text = activityClipboardText('Authoring complete', entries, start);
    expect(text).toContain('# Authoring Activity — Authoring complete');
    expect(text).toContain('## Cycle 1');
    expect(text).toContain('## Cycle 2');
    expect(text).toContain('[0:05] Sending plan request (12k chars prompt)');
    expect(text).toContain('[2:10] Batch rejected (1 error)');
    // Pre-cycle entries appear before the first cycle header.
    expect(text.indexOf('Turn started')).toBeLessThan(text.indexOf('## Cycle 1'));
  });
});

describe('AuthoringAssistantDrawer max cycles selection', () => {
  it('accepts only supported cycle caps and defaults to 40', () => {
    expect(AUTHORING_DEFAULT_MAX_CYCLES).toBe(40);
    expect(AUTHORING_CYCLE_OPTIONS).toEqual([10, 20, 40, 60, 80]);
    for (const option of AUTHORING_CYCLE_OPTIONS) {
      expect(normalizeMaxCycles(option)).toBe(option);
      expect(normalizeMaxCycles(String(option))).toBe(option);
    }
    // Foreign/corrupted values fall back to the default.
    for (const bad of [null, undefined, '', '50', 50, 0, -10, 'lots', Number.NaN]) {
      expect(normalizeMaxCycles(bad)).toBe(AUTHORING_DEFAULT_MAX_CYCLES);
    }
  });
});

describe('AuthoringAssistantDrawer activity panel persistence', () => {
  it('round-trips a terminal status card through persisted JSON', () => {
    const persisted: PersistedActivityState = {
      activity: [
        { id: 'a', ts: 1000, kind: 'info', text: 'Turn started' },
        { id: 'b', ts: 2000, kind: 'apply', text: 'Applied 12 changes', cycle: 1 },
      ],
      turnStartedAt: 1000,
      statusCollapsed: true,
      workingStatus: { stage: 'done', label: 'Draft graph updated', applied: 12, issues: 0 },
    };

    const restored = restoreActivityPanelState(JSON.stringify(persisted));

    expect(restored).toEqual(persisted);
  });

  it('marks a persisted in-flight turn as interrupted instead of still running', () => {
    // The autonomous loop is in-memory; if the page reloaded mid-turn the
    // restored card must not pretend the run is still progressing.
    const persisted: PersistedActivityState = {
      activity: [{ id: 'a', ts: 1000, kind: 'model', text: 'Sending plan request', cycle: 3 }],
      turnStartedAt: 1000,
      statusCollapsed: false,
      workingStatus: { stage: 'applying_commands', label: 'Applying commands', applied: 4, issues: 2, detail: 'cycle 3' },
    };

    const restored = restoreActivityPanelState(JSON.stringify(persisted));

    expect(restored.workingStatus?.stage).toBe('blocked');
    expect(restored.workingStatus?.label).toBe('Interrupted (editor reloaded)');
    expect(restored.workingStatus?.detail).toBeUndefined();
    expect(restored.workingStatus?.applied).toBe(4);
    expect(restored.activity).toHaveLength(1);
  });

  it('returns an empty panel for missing or corrupted persisted state', () => {
    for (const raw of [null, '', 'not-json', '{"activity":"nope"}']) {
      const restored = restoreActivityPanelState(raw);
      expect(restored.activity).toEqual([]);
      expect(restored.workingStatus).toBeNull();
      expect(restored.turnStartedAt).toBeNull();
      expect(restored.statusCollapsed).toBe(false);
    }
  });
});
