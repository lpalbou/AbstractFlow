/**
 * Draft test runs for the authoring assistant: publish the saved flow as a
 * draft bundle, start a bounded run, poll it to a terminal state, and distill
 * the run ledger into a structured test report the planning loop can act on.
 *
 * Design rules (adversary review E, 2026-07-12):
 * - Never silently run: callers gate every test behind explicit user consent
 *   (or a visible auto-test arm) — this module only provides the mechanics.
 * - The test session id is ISOLATED (never the user's stable session), so
 *   durable session memory and Approve-All blast radius stay bounded.
 * - Runs carry the draft_test/ephemeral lifecycle (server-enforced for draft
 *   versions) and a client wall-clock watchdog cancels overruns — workflows'
 *   own declared budgets are never overridden (the workflow decides).
 * - Failure feedback is STRUCTURED (failed node, effect type, verbatim error,
 *   truncated inputs labeled #TRUNCATION) so the next planning cycle can fix
 *   the graph instead of re-guessing.
 */

import type { VisualFlow } from '../types/flow';
import {
  gatewayCancelRun,
  gatewayJson,
  gatewayRunLedger,
  gatewayRunSummary,
  gatewayStartRun,
  jsonRequest,
  type GatewayContracts,
  type GatewayLedgerRecord,
} from './gatewayClient';
import { buildDraftRunMetadata, draftBundleVersion } from './runLifecycle';

export interface DraftTestPublishResult {
  bundleId: string;
  bundleVersion: string;
}

export interface DraftTestWait {
  kind: 'tool_approval' | 'ask_user' | 'other';
  waitKey?: string;
  prompt?: string;
  toolCalls?: unknown[];
  raw: Record<string, unknown>;
}

export type DraftTestVerdict =
  | 'passed'
  | 'failed'
  | 'timeout'
  | 'cancelled'
  | 'needs_interactive_input';

export interface DraftTestFailedStep {
  nodeId: string;
  nodeLabel: string;
  effectType: string;
  error: string;
  /** First 500 chars of the step's effect payload, labeled when truncated. */
  inputsPreview: string;
}

export interface DraftTestReport {
  verdict: DraftTestVerdict;
  runId: string;
  bundleRef: string;
  durationMs: number;
  inputsUsed: Record<string, unknown>;
  failedSteps: DraftTestFailedStep[];
  flowError: string | null;
  /** Data outputs from the flow-end record, when present. */
  outputs: Record<string, unknown> | null;
}

/** Stable, isolated session id for assistant test runs of one workflow. */
export function assistantTestSessionId(workflowStorageKey: string): string {
  return `assistant-test:${String(workflowStorageKey || 'draft').slice(0, 80)}`;
}

/**
 * Publish the SAVED flow under an assistant draft version. The caller must
 * have saved the flow first (drafts have no server identity) and must have
 * obtained user consent for the save+test action.
 */
export async function publishDraftForTest(args: {
  flowId: string;
  testSessionId: string;
  publishEndpoint: string;
}): Promise<DraftTestPublishResult> {
  const requestedVersion = draftBundleVersion(args.testSessionId);
  const payload = await gatewayJson<{
    ok?: boolean;
    bundle_id?: string;
    bundle_version?: string;
    gateway_reloaded?: boolean;
    gateway_reload_error?: string | null;
    detail?: string;
  }>(args.publishEndpoint, jsonRequest({ bundle_version: requestedVersion, overwrite: true, reload_gateway: true }, { method: 'POST' }));
  if (payload.ok === false) {
    throw new Error(payload.detail || 'Gateway failed to publish the draft for testing');
  }
  const bundleId = String(payload.bundle_id || '').trim();
  if (!bundleId) throw new Error('Gateway did not return bundle_id for the draft publish');
  if (payload.gateway_reloaded === false && payload.gateway_reload_error) {
    throw new Error(`Draft published but the bundle is not loaded: ${payload.gateway_reload_error}`);
  }
  return { bundleId, bundleVersion: String(payload.bundle_version || requestedVersion).trim() };
}

/** Start the draft test run with the isolated session + draft lifecycle. */
export async function startDraftTestRun(args: {
  publish: DraftTestPublishResult;
  flowId: string;
  inputData: Record<string, unknown>;
  testSessionId: string;
  contracts?: GatewayContracts | null;
}): Promise<string> {
  const started = await gatewayStartRun(
    {
      bundle_id: args.publish.bundleId,
      bundle_version: args.publish.bundleVersion,
      flow_id: args.flowId,
      input_data: args.inputData,
      session_id: args.testSessionId,
      run_lifecycle: buildDraftRunMetadata({
        editorSessionId: args.testSessionId,
        flowId: args.flowId,
        bundleVersion: args.publish.bundleVersion,
      }) as unknown as Record<string, unknown>,
    },
    args.contracts
  );
  const runId = String(started.run_id || '').trim();
  if (!runId) throw new Error('Gateway did not return run_id for the test run');
  return runId;
}

/** Classify a run summary's wait payload for drawer surfacing. */
export function classifyWait(summary: Record<string, unknown>): DraftTestWait | null {
  const waiting = summary.waiting;
  if (!waiting || typeof waiting !== 'object') return null;
  const record = waiting as Record<string, unknown>;
  const details = (record.details && typeof record.details === 'object' ? record.details : {}) as Record<string, unknown>;
  const mode = String(details.mode || '').trim();
  const detailKind = String(details.kind || '').trim();
  const isApproval = mode === 'approval_required' || detailKind === 'tool_approval';
  const toolCalls = Array.isArray(details.tool_calls) ? details.tool_calls : undefined;
  if (isApproval) {
    return {
      kind: 'tool_approval',
      waitKey: typeof record.wait_key === 'string' ? record.wait_key : undefined,
      toolCalls,
      raw: record,
    };
  }
  const reason = String(record.reason || '').trim();
  if (reason === 'user') {
    // The gateway carries the ask_user prompt at the TOP LEVEL of the wait
    // object (mapGatewayRunSummary/extractWaitInfo read it there); details
    // kept as a fallback for older payload shapes.
    const prompt = typeof record.prompt === 'string' && record.prompt.trim()
      ? record.prompt
      : typeof details.prompt === 'string'
        ? details.prompt
        : undefined;
    return {
      kind: 'ask_user',
      waitKey: typeof record.wait_key === 'string' ? record.wait_key : undefined,
      prompt,
      raw: record,
    };
  }
  return { kind: 'other', raw: record };
}

export interface PollDraftTestOptions {
  contracts?: GatewayContracts | null;
  /** Wall-clock budget; on expiry the run is cancelled and verdict=timeout. */
  timeoutMs?: number;
  pollIntervalMs?: number;
  /** Surfaced whenever the run parks on a wait; return value not consumed. */
  onWait?: (wait: DraftTestWait) => void;
  /** Cooperative stop (user pressed Stop): cancels the run, verdict=cancelled. */
  shouldStop?: () => boolean;
  /**
   * True when the CALLER knows a human interaction (approval/question) is
   * pending — agent workflows park approvals in SUB-runs the root summary
   * only reports as "subworkflow", so the poller cannot see them itself. A
   * watchdog expiry with a pending interaction is a needs_interactive_input
   * finding about the run, never a graph-defect timeout.
   */
  hasPendingInteraction?: () => boolean;
  /** Injectable clock/sleep for tests. */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled']);

/**
 * Poll a test run to a terminal state. Waits are surfaced via onWait each
 * poll; if the SAME ask_user wait persists past the watchdog the run is
 * cancelled with verdict needs_interactive_input (that is a finding about
 * the workflow, not an error).
 */
export async function pollDraftTestRun(
  runId: string,
  options: PollDraftTestOptions = {}
): Promise<{ status: string; verdict: DraftTestVerdict; summary: Record<string, unknown> }> {
  const now = options.now ?? (() => Date.now());
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const timeoutMs = options.timeoutMs ?? 5 * 60 * 1000;
  const interval = options.pollIntervalMs ?? 750;
  const startedAt = now();
  let sawInteractiveWait = false;

  for (;;) {
    if (options.shouldStop?.()) {
      await gatewayCancelRun(runId, options.contracts).catch(() => undefined);
      return { status: 'cancelled', verdict: 'cancelled', summary: {} };
    }
    const summary = (await gatewayRunSummary(runId, options.contracts)) as Record<string, unknown>;
    const status = String(summary.status || '').trim().toLowerCase();
    if (TERMINAL_STATUSES.has(status)) {
      const verdict: DraftTestVerdict =
        status === 'completed' ? 'passed' : status === 'cancelled' ? 'cancelled' : 'failed';
      return { status, verdict, summary };
    }
    const wait = classifyWait(summary);
    if (wait) {
      options.onWait?.(wait);
      // Approvals are interactive too: an unanswered Approve/Deny at watchdog
      // expiry is a human-attention finding, not a graph defect. The flag
      // tracks the CURRENT poll only — an early answered question must not
      // convert a later genuine timeout into needs_interactive_input.
      sawInteractiveWait = wait.kind === 'ask_user' || wait.kind === 'tool_approval';
    } else {
      sawInteractiveWait = false;
    }
    if (now() - startedAt > timeoutMs) {
      await gatewayCancelRun(runId, options.contracts).catch(() => undefined);
      const interactive = sawInteractiveWait || Boolean(options.hasPendingInteraction?.());
      return {
        status: 'timeout',
        verdict: interactive ? 'needs_interactive_input' : 'timeout',
        summary,
      };
    }
    await sleep(interval);
  }
}

function truncateInputs(payload: unknown): string {
  let text = '';
  try {
    text = JSON.stringify(payload) ?? '';
  } catch {
    text = String(payload);
  }
  return text.length > 500 ? `${text.slice(0, 500)}… #TRUNCATION` : text;
}

/** Node label lookup from the authored graph so failures name what users see. */
function nodeLabels(flow: VisualFlow | null): Map<string, string> {
  const labels = new Map<string, string>();
  for (const node of flow?.nodes || []) {
    const label = typeof node.data?.label === 'string' && node.data.label.trim() ? node.data.label.trim() : node.id;
    labels.set(node.id, label);
  }
  return labels;
}

/**
 * Distill ledger records into the structured test report. Pure over the
 * fetched records; network happens in `collectDraftTestReport`.
 */
export function buildDraftTestReport(args: {
  runId: string;
  bundleRef: string;
  verdict: DraftTestVerdict;
  durationMs: number;
  inputsUsed: Record<string, unknown>;
  records: GatewayLedgerRecord[];
  flow: VisualFlow | null;
  flowError?: string | null;
}): DraftTestReport {
  const labels = nodeLabels(args.flow);
  // Match the flow-end record by NODE TYPE from the authored graph — an
  // /end/i id-substring test attributed render/send_email/append results as
  // the workflow outputs (adversary find).
  const endNodeIds = new Set(
    (args.flow?.nodes || [])
      .filter((node) => String(node.data?.nodeType || node.type) === 'on_flow_end')
      .map((node) => node.id)
  );
  const failedSteps: DraftTestFailedStep[] = [];
  let outputs: Record<string, unknown> | null = null;
  for (const record of args.records) {
    const status = String(record.status || '').trim().toLowerCase();
    const error = typeof record.error === 'string' ? record.error.trim() : '';
    const effect = (record.effect && typeof record.effect === 'object' ? record.effect : {}) as Record<string, unknown>;
    const effectType = String(effect.type || '').trim() || 'unknown';
    const nodeId = String(record.node_id || '').trim();
    if (status === 'failed' || error) {
      failedSteps.push({
        nodeId: nodeId || '(run)',
        nodeLabel: nodeId ? labels.get(nodeId) || nodeId : '(run)',
        effectType,
        error: error || 'step failed without an error message',
        inputsPreview: truncateInputs(effect.payload ?? {}),
      });
    }
    // The flow-end record's result carries the exposed On Flow End outputs.
    const result = record.result;
    if (
      result &&
      typeof result === 'object' &&
      effectType === 'unknown' &&
      nodeId &&
      (endNodeIds.has(nodeId) || (endNodeIds.size === 0 && /^(__implicit_flow_end__|on_flow_end)/.test(nodeId)))
    ) {
      outputs = result as Record<string, unknown>;
    }
    if (result && typeof result === 'object') {
      const resultRecord = result as Record<string, unknown>;
      if (resultRecord.outputs && typeof resultRecord.outputs === 'object') {
        outputs = resultRecord.outputs as Record<string, unknown>;
      }
    }
  }
  return {
    verdict: args.verdict,
    runId: args.runId,
    bundleRef: args.bundleRef,
    durationMs: args.durationMs,
    inputsUsed: args.inputsUsed,
    failedSteps,
    flowError: args.flowError ?? null,
    outputs,
  };
}

/** Fetch the run ledger and distill it (network half of report building). */
export async function collectDraftTestReport(args: {
  runId: string;
  bundleRef: string;
  verdict: DraftTestVerdict;
  durationMs: number;
  inputsUsed: Record<string, unknown>;
  flow: VisualFlow | null;
  flowError?: string | null;
  contracts?: GatewayContracts | null;
}): Promise<DraftTestReport> {
  let records: GatewayLedgerRecord[] = [];
  try {
    const ledger = await gatewayRunLedger(args.runId, args.contracts, 0, 2000);
    records = Array.isArray(ledger.items) ? ledger.items : [];
  } catch {
    // Report building must never mask the run verdict; a missing ledger just
    // yields an empty failed-step list with the flow error carrying the truth.
  }
  return buildDraftTestReport({ ...args, records });
}

/** Prompt-facing rendering of a test report for the next planning cycle. */
export function testReportPromptSection(report: DraftTestReport): string {
  const lines: string[] = [
    `LAST TEST RUN (${report.bundleRef}, run ${report.runId}, ${Math.round(report.durationMs / 1000)}s): verdict=${report.verdict}`,
    `inputs used: ${truncateInputs(report.inputsUsed)}`,
  ];
  if (report.flowError) lines.push(`flow error: ${report.flowError}`);
  for (const step of report.failedSteps.slice(0, 8)) {
    lines.push(
      `FAILED step node=${step.nodeId} (“${step.nodeLabel}”, effect=${step.effectType}): ${step.error} — inputs: ${step.inputsPreview}`
    );
  }
  if (report.verdict === 'passed' && report.outputs) {
    lines.push(`outputs: ${truncateInputs(report.outputs)}`);
  }
  lines.push(
    report.verdict === 'passed'
      ? 'The test passed. If the outputs above do not plausibly satisfy the request, fix the graph; otherwise declare done.'
      : 'Fix the graph so this test passes; do not change the test inputs unless they are themselves wrong.'
  );
  return lines.join('\n');
}
