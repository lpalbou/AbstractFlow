import { computeRunPreflightIssues, type RunPreflightOptions } from '../../utils/preflight';
import { formatTokenCount, type PlannerUsage } from '../../utils/plannerUsage';
import { formatElapsed } from './assistantActivity';
import type { FlowAuthoringApplyResult } from '../../utils/flowAuthoringCommands';

/**
 * Message-composition layer of the authoring assistant: everything the user
 * reads in the conversation is assembled here, away from the loop. This is a
 * leaf module (no drawer import) so the presentation components and the loop
 * can both depend on it.
 *
 * Message contract (2026-07 presentation wave): chat messages are
 * OUTCOME-FIRST — a bold headline, the model's reply, capability-level
 * "What changed" bullets, "Check next" steps, verbatim caveat lines, and a
 * compact stats footer. Process narration (How It Works / How To Test /
 * What To Expect / Workflow Plan and short repair/readiness forms) folds into
 * one collapsed "Turn report" details block. Full forensic dumps (attempted
 * command batches, raw planner responses, candidate graphs) never live in
 * chat — they ride activity entry detail payloads (session-only).
 */

export type AssistantRole = 'user' | 'assistant';

export interface AssistantMessage {
  id: string;
  role: AssistantRole;
  content: string;
  /** Creation time; drives the turn separator rows in the transcript. */
  ts?: number;
  /** On the terminal assistant message of a turn: how long the turn ran. */
  turnDurationSeconds?: number;
  /** On the terminal assistant message of a turn: applied change count. */
  turnChanges?: number;
}

/** Capability areas the model may tag "what changed" entries with. */
export const AUTHORING_CHANGE_AREAS = [
  'inputs',
  'prompting',
  'agent',
  'tools',
  'control_flow',
  'outputs',
  'files',
  'models',
  'other',
] as const;

export type AuthoringChangeArea = (typeof AUTHORING_CHANGE_AREAS)[number];

export interface AuthoringChangeSummaryItem {
  area: AuthoringChangeArea;
  text: string;
}

export interface AssistantPlan {
  reply: string;
  commands: unknown[];
  /**
   * Complete workflow document emitted by the model (document authoring mode).
   * When present, the editor diffs it against the current graph and compiles
   * the diff into `commands`; `commands` remains for compatibility with
   * incremental command batches.
   */
  graph: Record<string, unknown> | null;
  status: 'continue' | 'done' | 'needs_user' | 'failed';
  /**
   * Turn intent. "explain" = the user asked a question; the reply IS the
   * deliverable, no graph is emitted, and the turn must not go through the
   * graph acceptance review (a question is not implementable by a graph).
   * Absent/anything else = "author" (default).
   */
  intent?: 'explain' | 'author';
  selfReview: string;
  nextStep: string;
  howItWorks: string;
  howToTest: string;
  expectedResult: string;
  workflowSteps: string[];
  /** Concrete, checkable statements the finished graph must satisfy (model-derived from the request, language-agnostic). */
  acceptanceCriteria: string[];
  /** Model-authored outcome headline (≤12 words); empty when omitted. */
  headline?: string;
  /** Capability-level "what changed" entries (≤5); empty when omitted. */
  changesSummary?: AuthoringChangeSummaryItem[];
  /** Short verification steps for the user; empty when omitted. */
  checkNext?: string[];
}

export interface AuthoringReadiness {
  issues: string[];
  requiresRuntimeTools: boolean;
  requiresResearchScaffold: boolean;
}

export interface AuthoringRepairAttempt {
  cycle: number;
  plan: AssistantPlan;
  result: FlowAuthoringApplyResult;
  candidateReadiness: AuthoringReadiness;
}

export interface AuthoringFailureContext {
  cycle: number | null;
  modelNote?: string;
  plan: AssistantPlan | null;
  rawPlannerResponse: string;
  result: FlowAuthoringApplyResult | null;
  readiness: AuthoringReadiness | null;
  repairAttempts?: AuthoringRepairAttempt[];
}

/** Per-turn stats rendered in the compact message footer. */
export interface AuthoringTurnStats {
  cycles?: number;
  durationSeconds?: number;
  usage?: PlannerUsage | null;
}

export interface ResultMarkdownOptions {
  preflightOptions?: RunPreflightOptions;
  /** True only when the acceptance reviewer returned an explicit pass verdict. */
  reviewPassed?: boolean;
  stats?: AuthoringTurnStats;
}

export const ASSISTANT_INITIAL_CONTENT = [
  '**Welcome**',
  'Tell me the workflow you want and I will build it on the canvas. For example: "Build a research workflow that searches the web and writes a markdown report."',
  '',
  'Stop is safe — changes already applied stay on the canvas. Undo Turn reverts the whole last turn. Save and Run always stay yours.',
].join('\n');

/** Pre-wave welcome text: conversations persisted before the rewrite still carry it and it must stay filtered out of prompt replay. */
const LEGACY_ASSISTANT_INITIAL_CONTENT =
  '**Assistant**\nDescribe the workflow you want. I will run autonomous Gateway planning cycles, apply validated command batches to the draft canvas, then report what changed. Save and Run remain explicit.';

export const ASSISTANT_WELCOME_CONTENTS: ReadonlySet<string> = new Set([
  ASSISTANT_INITIAL_CONTENT,
  LEGACY_ASSISTANT_INITIAL_CONTENT,
]);

export function newId(prefix: string): string {
  return `${prefix}-${Math.random().toString(16).slice(2)}-${Date.now().toString(16)}`;
}

export function initialAssistantMessages(): AssistantMessage[] {
  return [
    {
      id: newId('assistant'),
      role: 'assistant',
      content: ASSISTANT_INITIAL_CONTENT,
    },
  ];
}

export function jsonForMarkdown(value: unknown): string {
  try {
    const json = JSON.stringify(value);
    if (json !== undefined) return json;
  } catch {
    // Fall through to string conversion.
  }
  return String(value);
}

export function commandListMarkdown(commands: unknown[]): string {
  if (commands.length === 0) return '- No commands were returned.';
  return commands.map((command, index) => `${index + 1}. ${jsonForMarkdown(command)}`).join('\n');
}

export function graphSummaryMarkdown(result: FlowAuthoringApplyResult): string {
  const nodeRows = result.nodes.map((node) => {
    const nodeType = node.data.nodeType || node.type || 'unknown';
    const label = node.data.label && node.data.label !== nodeType ? ` "${node.data.label}"` : '';
    return `- ${node.id} (${nodeType})${label}`;
  });
  const edgeRows = result.edges.map(
    (edge) => `- ${edge.source}.${edge.sourceHandle || 'exec-out'} -> ${edge.target}.${edge.targetHandle || 'exec-in'}`
  );
  return [
    '**Candidate Nodes**',
    nodeRows.length > 0 ? nodeRows.join('\n') : '- No candidate nodes.',
    '',
    '**Candidate Edges**',
    edgeRows.length > 0 ? edgeRows.join('\n') : '- No candidate edges.',
  ].join('\n');
}

/** Turn separator descriptor for the transcript (non-null only before user messages). */
export interface TurnSeparator {
  turn: number;
  ts?: number;
  durationSeconds?: number;
  changes?: number;
}

/**
 * A "turn" starts at each user message. The separator carries the turn number
 * and start time; once the turn's terminal assistant message lands (it is the
 * one carrying `turnDurationSeconds`), the same separator also reports the
 * duration and applied-change count.
 */
export function turnSeparatorFor(messages: AssistantMessage[], index: number): TurnSeparator | null {
  const message = messages[index];
  if (!message || message.role !== 'user') return null;
  let turn = 0;
  for (let i = 0; i <= index; i += 1) {
    if (messages[i].role === 'user') turn += 1;
  }
  let durationSeconds: number | undefined;
  let changes: number | undefined;
  for (let i = index + 1; i < messages.length && messages[i].role !== 'user'; i += 1) {
    if (typeof messages[i].turnDurationSeconds === 'number') {
      durationSeconds = messages[i].turnDurationSeconds;
      changes = messages[i].turnChanges;
    }
  }
  return { turn, ts: message.ts, durationSeconds, changes };
}

function changeAreaLabel(area: AuthoringChangeArea): string {
  return area === 'control_flow' ? 'control flow' : area;
}

/** First-word verb buckets over the validator's human applied strings. */
const APPLIED_VERB_BUCKETS: Record<string, string> = {
  added: 'added',
  created: 'added',
  connected: 'connected',
  set: 'configured',
  configured: 'configured',
  removed: 'removed',
  deleted: 'removed',
  disconnected: 'removed',
  renamed: 'renamed',
};

/**
 * ONE short line derived from applied change kinds — the fallback when the
 * model did not author `changes_summary`. Never a per-command dump.
 */
export function appliedChangesFallbackLine(applied: string[], touchedNodeCount: number): string {
  if (applied.length === 0) return '';
  const counts = new Map<string, number>();
  for (const entry of applied) {
    const verb = (entry.trim().split(/\s+/)[0] || '').toLowerCase();
    const bucket = APPLIED_VERB_BUCKETS[verb] || 'updated';
    counts.set(bucket, (counts.get(bucket) || 0) + 1);
  }
  const breakdown = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([bucket, count]) => `${count} ${bucket}`)
    .join(', ');
  const scope = touchedNodeCount > 0 ? ` across ${touchedNodeCount} node${touchedNodeCount === 1 ? '' : 's'}` : '';
  return `${applied.length} validated change${applied.length === 1 ? '' : 's'} (${breakdown})${scope}.`;
}

/** Status-derived outcome headline used when the model omits `headline`. */
export function fallbackHeadline(
  status: AssistantPlan['status'],
  appliedCount: number,
  remainingIssueCount: number
): string {
  if (status === 'failed') return 'I could not finish this request';
  if (status === 'needs_user') return 'I need your answer to continue';
  if (remainingIssueCount > 0) {
    return `Workflow updated — ${remainingIssueCount} check${remainingIssueCount === 1 ? '' : 's'} still open`;
  }
  if (appliedCount === 0) return 'No changes needed — the workflow already satisfies the request';
  return `Workflow updated — ${appliedCount} change${appliedCount === 1 ? '' : 's'} applied`;
}

/** Every aggregated warning verbatim, one "⚠ …" line each — never counts. */
function caveatLines(warnings: string[]): string[] {
  return warnings.map((warning) => `⚠ ${warning}`);
}

function keptSoFarLine(appliedCount: number): string {
  if (appliedCount === 0) return 'Kept so far: no graph changes were applied this turn.';
  return `Kept so far: ${appliedCount} change${appliedCount === 1 ? '' : 's'} remain applied (Undo Turn reverts).`;
}

function shortList(items: string[], max = 3): string {
  const shown = items.slice(0, max).map((item) => `- ${item}`);
  if (items.length > max) shown.push(`- …and ${items.length - max} more (full details in the activity log payloads)`);
  return shown.join('\n');
}

function statsFooterLine(stats: AuthoringTurnStats | undefined, appliedCount: number): string {
  const parts: string[] = [`${appliedCount} change${appliedCount === 1 ? '' : 's'}`];
  if (stats?.cycles && stats.cycles > 0) parts.push(`${stats.cycles} cycle${stats.cycles === 1 ? '' : 's'}`);
  if (typeof stats?.durationSeconds === 'number' && stats.durationSeconds >= 0) {
    parts.push(formatElapsed(stats.durationSeconds));
  }
  if (stats?.usage && stats.usage.calls > 0) {
    parts.push(`${formatTokenCount(stats.usage.inputTokens)} in / ${formatTokenCount(stats.usage.outputTokens)} out tokens`);
  }
  return `*${parts.join(' · ')}*`;
}

/**
 * The collapsed "Turn report" block: process narration and SHORT forms of
 * repair/readiness history. Full dumps stay out (activity payloads carry
 * them). Blank lines around the markdown body are required — the markdown
 * parser only resumes inside an HTML block after a blank line.
 */
function turnReportBlock(args: {
  plan: AssistantPlan;
  modelNote: string;
  errors: string[];
  converged: boolean;
  readinessIssues: string[];
  preflightNotes: string[];
}): string {
  const body: string[] = [];
  if (args.modelNote) body.push(args.modelNote, '');
  if (args.plan.workflowSteps.length > 0) {
    body.push('**Workflow Plan**', args.plan.workflowSteps.map((item) => `- ${item}`).join('\n'), '');
  }
  body.push(
    '**How It Works**',
    args.plan.howItWorks || 'The draft graph uses normal AbstractFlow nodes and remains unsaved until you use Save.',
    '',
    '**How To Test**',
    args.plan.howToTest || 'Review the graph, save it, then use the existing Run button.',
    '',
    '**What To Expect**',
    args.plan.expectedResult || 'The run should follow the visible node graph and produce the exposed On Flow End outputs.'
  );
  if (args.errors.length > 0) {
    body.push(
      '',
      '**Repaired during authoring**',
      args.converged
        ? `The validator rejected ${args.errors.length} proposed edit${args.errors.length === 1 ? '' : 's'} along the way; the assistant corrected course and the final graph passed all readiness checks.`
        : `${args.errors.length} proposed edit${args.errors.length === 1 ? ' was' : 's were'} rejected by the validator this turn.`,
      shortList(args.errors)
    );
  }
  if (args.readinessIssues.length > 0) {
    body.push('', '**Remaining readiness issues**', shortList(args.readinessIssues));
  }
  if (args.preflightNotes.length > 0) {
    body.push('', '**Preflight notes**', shortList(args.preflightNotes));
  }
  return ['<details>', '<summary>Turn report</summary>', '', ...body, '', '</details>'].join('\n');
}

/**
 * Explain-turn rendering: the grounded answer IS the deliverable. No applied
 * changes, no readiness sections, no graph-shaped fallback prose ("The draft
 * graph uses normal AbstractFlow nodes…") — that narration is authoring-turn
 * text and would be dishonest under a question (adversary P1, 2026-07-15).
 */
export function explainResultMarkdown(plan: AssistantPlan): string {
  const parts: string[] = [];
  if (plan.headline) parts.push(`**${plan.headline}**`, '');
  parts.push(plan.reply || '(no answer text returned)');
  if (plan.checkNext && plan.checkNext.length > 0) {
    parts.push('', '**See also**', plan.checkNext.map((item) => `- ${item}`).join('\n'));
  }
  return parts.join('\n');
}

export function resultMarkdown(
  plan: AssistantPlan,
  result: FlowAuthoringApplyResult | null,
  readiness: AuthoringReadiness,
  modelNote = '',
  options: ResultMarkdownOptions = {}
): string {
  const applied = result?.applied || [];
  const warnings = result?.warnings || [];
  const errors = result?.errors || [];
  const preflightNotes = result
    ? computeRunPreflightIssues(result.nodes, result.edges, options.preflightOptions || {}).map(
        (issue) => `${issue.nodeLabel}: ${issue.message}`
      )
    : [];
  const touchedCount = result?.touchedNodeIds?.length || 0;

  // Question-first shape: the user's next move is answering, so nothing may
  // stand between the headline and the question. No boilerplate sections.
  if (plan.status === 'needs_user') {
    const parts: string[] = [
      '**I need your answer to continue**',
      '',
      plan.reply || 'Please tell me how to proceed.',
    ];
    const caveats = caveatLines(warnings);
    if (caveats.length > 0) parts.push('', caveats.join('\n'));
    parts.push('', keptSoFarLine(applied.length));
    return parts.join('\n');
  }

  const headline = (plan.headline || '').trim() || fallbackHeadline(plan.status, applied.length, readiness.issues.length);
  const parts: string[] = [`**${headline}**`, '', plan.reply || 'I prepared an authoring plan.'];

  if (applied.length > 0) {
    const summary = plan.changesSummary || [];
    parts.push('', '#### What changed');
    if (summary.length > 0) {
      parts.push(summary.map((item) => `- **${changeAreaLabel(item.area)}** — ${item.text}`).join('\n'));
    } else {
      parts.push(appliedChangesFallbackLine(applied, touchedCount));
    }
  }

  const checkNext = plan.checkNext || [];
  if (checkNext.length > 0) {
    parts.push('', '#### Check next', checkNext.map((item) => `- ${item}`).join('\n'));
  }

  const caveats = caveatLines(warnings);
  if (caveats.length > 0) parts.push('', caveats.join('\n'));

  if (options.reviewPassed) {
    parts.push('', '✓ An independent acceptance review verified the result against your request.');
  }

  parts.push(
    '',
    turnReportBlock({
      plan,
      modelNote,
      errors,
      converged: plan.status === 'done' && readiness.issues.length === 0,
      readinessIssues: readiness.issues,
      preflightNotes,
    })
  );

  parts.push('', statsFooterLine(options.stats, applied.length));
  return parts.join('\n');
}

/**
 * Cycle-cap exhaustion is a PAUSE (the model was still cooperating; the
 * budget ran out), never a failure. The user resumes with "continue", a
 * higher cycle cap, or different guidance.
 */
export function pausedTurnMarkdown(args: {
  maxCycles: number;
  remainingIssues: string[];
  appliedCount: number;
  stats?: AuthoringTurnStats;
}): string {
  const parts: string[] = [`**Paused after ${args.maxCycles} cycles — not finished yet**`];
  if (args.remainingIssues.length > 0) {
    parts.push('', 'Still open:', shortList(args.remainingIssues));
  }
  parts.push(
    '',
    `Changes applied so far stay on the canvas (Undo Turn reverts). Send "continue", raise the cycle limit, or guide me differently.`,
    '',
    statsFooterLine(args.stats, args.appliedCount)
  );
  return parts.join('\n');
}

/**
 * Failure chat message: what failed / why / what to try — three short lines.
 * The forensic dumps that used to live here ride an activity entry detail
 * payload now (see authoringFailureDetailText).
 */
export function authoringFailureMarkdown(
  message: string,
  partialApplied: boolean,
  _context?: Partial<AuthoringFailureContext>
): string {
  return [
    '**Authoring failed**',
    message || 'The authoring turn failed without an error message.',
    partialApplied
      ? 'Changes validated before the failure are kept (Undo Turn reverts them).'
      : 'The workflow draft is unchanged.',
    'Try: fix the reported issue and send the request again — the full trace is in the activity log payloads.',
  ].join('\n');
}

/**
 * Full failure forensics for the activity detail payload (session-only):
 * attempted command batch, raw planner response, validator result, candidate
 * graph, repair attempts, readiness at failure — verbatim, no truncation.
 */
export function authoringFailureDetailText(context: Partial<AuthoringFailureContext>): string {
  const parts: string[] = ['AUTHORING FAILURE FORENSICS'];
  if (context.cycle) parts.push(`Planner cycle: ${context.cycle}`);
  if (context.modelNote) parts.push(context.modelNote);

  if (context.plan) {
    const plan = context.plan;
    parts.push('', 'PLANNER REPLY:', plan.reply || '(empty reply)', '', `PLANNER STATUS: ${plan.status}`);
    if (plan.workflowSteps.length > 0) {
      parts.push('', 'WORKFLOW PLAN RETURNED:', plan.workflowSteps.map((item) => `- ${item}`).join('\n'));
    }
    if (plan.selfReview) parts.push('', 'SELF REVIEW RETURNED:', plan.selfReview);
    if (plan.nextStep) parts.push('', 'NEXT STEP RETURNED:', plan.nextStep);
    parts.push('', 'ATTEMPTED COMMAND BATCH:', commandListMarkdown(plan.commands));
  }
  if (context.rawPlannerResponse) {
    parts.push('', 'PLANNER RAW RESPONSE:', context.rawPlannerResponse);
  }

  if (context.result) {
    const result = context.result;
    parts.push(
      '',
      'VALIDATOR RESULT:',
      result.applied.length > 0
        ? result.applied.map((item) => `- Applied candidate: ${item}`).join('\n')
        : '- No candidate graph changes were accepted before rejection.'
    );
    if (result.warnings.length > 0) {
      parts.push('', 'VALIDATOR WARNINGS:', result.warnings.map((item) => `- ${item}`).join('\n'));
    }
    if (result.errors.length > 0) {
      parts.push('', 'VALIDATOR ERRORS:', result.errors.map((item) => `- ${item}`).join('\n'));
    }
    parts.push('', 'CANDIDATE GRAPH BEFORE REJECTION:', graphSummaryMarkdown(result));
  }

  if (context.repairAttempts && context.repairAttempts.length > 0) {
    parts.push(
      '',
      'AUTONOMOUS REPAIR ATTEMPTS:',
      context.repairAttempts
        .map((attempt) => {
          const errors =
            attempt.result.errors.length > 0
              ? attempt.result.errors.map((error) => `  - ${error}`).join('\n')
              : '  - No explicit validator errors.';
          return `- Cycle ${attempt.cycle}: rejected ${attempt.plan.commands.length} command${attempt.plan.commands.length === 1 ? '' : 's'}\n${errors}`;
        })
        .join('\n')
    );
  }

  if (context.readiness) {
    parts.push(
      '',
      'READINESS CHECKS AT FAILURE:',
      context.readiness.issues.length > 0
        ? context.readiness.issues.map((issue) => `- ${issue}`).join('\n')
        : '- Readiness checks passed.'
    );
  }

  return parts.join('\n');
}

export function assistantConversationClipboardText(args: {
  workflowKey: string;
  flowId: string | null;
  flowName: string;
  provider: string;
  model: string;
  messages: AssistantMessage[];
  draft: string;
}): string {
  const lines = [
    '# AbstractFlow Authoring Assistant Conversation',
    '',
    `Workflow: ${args.flowName || 'Untitled Flow'}`,
    `Flow ID: ${args.flowId || '(unsaved draft)'}`,
    `Conversation key: ${args.workflowKey}`,
    `Assistant provider: ${args.provider || 'Gateway default'}`,
    `Assistant model: ${args.model || 'Gateway default'}`,
    '',
    '## Messages',
  ];
  for (const message of args.messages) {
    lines.push('', `### ${message.role === 'user' ? 'User' : 'Assistant'}`, '', message.content);
  }
  if (args.draft.trim()) {
    lines.push('', '### Draft Input', '', args.draft.trim());
  }
  return lines.join('\n');
}
