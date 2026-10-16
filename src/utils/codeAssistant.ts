/**
 * The Code node's coding assistant (operator 2026-10-16 14:37): a chat with the
 * gateway's default text model that knows the node's context — the workflow,
 * the node, the variables `transform(_input)` can read, the current body, the
 * test input and the sandbox's import rule — and answers with Python the author
 * can insert into the editor.
 *
 * Transport: one `basic-agent` run per turn on the gateway (the same bundle the
 * authoring assistant uses), sessionless; the conversation so far rides in the
 * prompt. Pure helpers (prompt, reply and code extraction, model resolution)
 * live here so they are unit-testable without a DOM or a gateway.
 */

import type { Pin } from '../types/flow';
import { TEXT_OUTPUT_CAPABILITY_ROUTE } from './capabilityRoutes';
import { extractFunctionBody, getPythonTypeLabelForPin, getPythonVarNameForPin } from './codegen';
import {
  findGatewayCapabilityDefault,
  gatewayRunSummary,
  gatewayStartRun,
  type GatewayCapabilityDefaultsResponse,
  type GatewayCodeExecutionContract,
  type GatewayContracts,
} from './gatewayClient';
import { buildDraftRunMetadata } from './runLifecycle';

export interface CodeAssistantTurn {
  role: 'user' | 'assistant';
  text: string;
  /** The Python body extracted from an assistant reply (null when the reply had no code). */
  code?: string | null;
  /** The turn is an error notice (transport or gateway), not a model reply. */
  error?: boolean;
}

export interface CodeAssistantContext {
  flowName?: string;
  nodeLabel?: string;
  params: Pin[];
  currentBody: string;
  sampleInput: string;
  permissions: string;
  policy: GatewayCodeExecutionContract | null | undefined;
}

export interface CodeAssistantModel {
  provider: string;
  model: string;
  label: string;
}

/** Modules the sandbox refuses, from the gateway's code-execution policy (AbstractRuntime 0.10.2+). */
export function deniedModulesOf(policy: GatewayCodeExecutionContract | null | undefined): string[] {
  const sandbox = (policy?.modes || []).find((m) => m.id === 'sandbox' || m.value === 'sandbox');
  const imports = sandbox && typeof sandbox.imports === 'object' && sandbox.imports ? (sandbox.imports as Record<string, unknown>) : null;
  const denied = imports && Array.isArray(imports.denied_modules) ? imports.denied_modules : [];
  return denied.filter((m): m is string => typeof m === 'string' && m.trim().length > 0);
}

export function variableLines(params: Pin[]): string[] {
  const rows = ['_input (dict) — the whole input payload'];
  for (const pin of params) {
    const name = getPythonVarNameForPin(pin);
    rows.push(`${name} (${getPythonTypeLabelForPin(pin)}) = _input.get(${JSON.stringify(pin.id)})`);
  }
  return rows;
}

const STDLIB_EXAMPLES = 'json, re, datetime, time, math, random, collections, itertools, statistics, textwrap, hashlib, base64, uuid, decimal, csv, html, urllib.parse';

export function buildCodeAssistantSystemPrompt(ctx: CodeAssistantContext): string {
  const denied = deniedModulesOf(ctx.policy);
  const sandbox = ctx.permissions !== 'full_access';
  const lines = [
    'You are the coding assistant of an AbstractFlow Code node. You write Python 3 for the BODY of `def transform(_input):`.',
    '',
    'Contract:',
    '- The editor holds only the body of transform(_input). Never write the `def transform` line and never write the "# Available variables" header; the body ends with a `return`.',
    '- `_input` is a dict carrying the node\'s inputs. Variables available in the body:',
    ...variableLines(ctx.params).map((row) => `    ${row}`),
    '- Return JSON data only: str, int, float, bool, None, lists and dicts of those. Never return a module, a function, a set, bytes or a datetime object (format it as text first).',
    '- Helper functions may be defined inside the body, before the return.',
    sandbox
      ? `- Sandbox: Python's standard library is importable (${STDLIB_EXAMPLES}…); write the import at the top of the body. Refused: third-party packages, exec/eval/compile/__import__, attribute names starting with "_"${denied.length ? `, and these modules: ${denied.join(', ')}` : ', and the modules that reach processes, files, the network or code loading'}.`
      : '- The node runs with full access: any import is available.',
    '- Python only. If the request asks for another language, say the Code node runs Python and give the Python.',
    '',
    'Reply format: one or two short sentences, then exactly one ```python fenced block holding the body, and nothing after the block.',
  ];
  return lines.join('\n');
}

const HISTORY_TURNS = 6;
const HISTORY_CHARS = 2400;

function clip(text: string, max: number): string {
  const t = String(text || '').trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

export function buildCodeAssistantPrompt(ctx: CodeAssistantContext, history: CodeAssistantTurn[], request: string): string {
  const parts: string[] = [];
  const where = [ctx.flowName ? `Workflow: ${ctx.flowName}` : '', ctx.nodeLabel ? `Node: ${ctx.nodeLabel}` : ''].filter(Boolean).join(' · ');
  if (where) parts.push(where);
  parts.push('Current body of transform(_input):', '```python', ctx.currentBody.trimEnd() || '# (empty)', '```');
  if (ctx.sampleInput.trim()) parts.push(`Test input (JSON): ${clip(ctx.sampleInput, 1200)}`);
  const recent = history.filter((t) => !t.error).slice(-HISTORY_TURNS);
  if (recent.length) {
    parts.push('', 'Conversation so far:');
    for (const turn of recent) {
      parts.push(`${turn.role === 'user' ? 'User' : 'Assistant'}: ${clip(turn.role === 'assistant' && turn.code ? `${turn.text}\n\`\`\`python\n${turn.code}\n\`\`\`` : turn.text, HISTORY_CHARS)}`);
    }
  }
  parts.push('', `Request: ${request.trim()}`);
  return parts.join('\n');
}

const HEADER_LINE = /^#\s*(Available variables:|_input \(dict\)|[A-Za-z_][A-Za-z0-9_]* \([^)]*\))\s*$/;

/** The Python body in a reply: the first fenced block, minus a `def transform` wrapper and the variables header. */
export function extractCodeBlock(reply: string): string | null {
  const text = String(reply || '').replace(/\r\n/g, '\n');
  const fence = text.match(/```(?:python|py)?[ \t]*\n([\s\S]*?)```/);
  if (!fence) return null;
  let code = fence[1].replace(/\s+$/, '');
  if (/^\s*def transform\(/m.test(code)) {
    const body = extractFunctionBody(code);
    if (body !== null) code = body;
  }
  const lines = code.split('\n');
  while (lines.length && (HEADER_LINE.test(lines[0]) || lines[0].trim() === '')) lines.shift();
  const out = lines.join('\n').trimEnd();
  return out ? out : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** The model's text in a basic-agent run output (`response`, or the usual aliases). */
export function replyTextFromRunOutput(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  const rec = asRecord(value);
  if (!rec) return '';
  for (const key of ['response', 'answer', 'message', 'text', 'content', 'data']) {
    const found = replyTextFromRunOutput(rec[key]);
    if (found) return found;
  }
  for (const key of ['output', 'result']) {
    const found = replyTextFromRunOutput(rec[key]);
    if (found) return found;
  }
  return '';
}

export function resolveCodeAssistantModel(defaults: GatewayCapabilityDefaultsResponse | null | undefined): CodeAssistantModel | null {
  const route = findGatewayCapabilityDefault(defaults, TEXT_OUTPUT_CAPABILITY_ROUTE);
  const provider = String(route?.provider || '').trim();
  const model = String(route?.model || '').trim();
  if (!provider || !model) return null;
  return { provider, model, label: `${provider} / ${model}` };
}

export class CodeAssistantCancelled extends Error {
  constructor() {
    super('Code assistant request cancelled.');
    this.name = 'CodeAssistantCancelled';
  }
}

const POLL_MS = 750;
const TIMEOUT_MS = 180_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** One turn: start a basic-agent run with the system prompt and the prompt, wait for its reply text. */
export async function askCodeAssistant(args: {
  contracts: GatewayContracts | null;
  model: CodeAssistantModel;
  system: string;
  prompt: string;
  isCancelled?: () => boolean;
  onRunStarted?: (runId: string) => void;
}): Promise<string> {
  const started = await gatewayStartRun(
    {
      bundle_id: 'basic-agent',
      input_data: {
        provider: args.model.provider,
        model: args.model.model,
        prompt: args.prompt,
        system: args.system,
        tools: [],
        temperature: 0.2,
      },
      run_lifecycle: buildDraftRunMetadata({ flowId: 'code-assistant' }) as unknown as Record<string, unknown>,
    },
    args.contracts
  );
  const runId = typeof started.run_id === 'string' ? started.run_id.trim() : '';
  if (!runId) throw new Error('The gateway did not return a run id for the assistant.');
  args.onRunStarted?.(runId);
  const deadline = Date.now() + TIMEOUT_MS;
  while (true) {
    if (args.isCancelled?.()) throw new CodeAssistantCancelled();
    if (Date.now() > deadline) throw new Error('The assistant did not answer within 3 minutes.');
    const summary = await gatewayRunSummary(runId, args.contracts);
    const status = String(summary.status || '').trim().toLowerCase();
    if (status === 'completed') {
      const text = replyTextFromRunOutput(summary.output);
      if (!text) throw new Error('The assistant run completed without a reply.');
      return text;
    }
    if (status === 'failed') {
      const detail = typeof summary.error === 'string' && summary.error.trim() ? `: ${summary.error.trim()}` : '';
      throw new Error(`The assistant run failed${detail}`);
    }
    if (status === 'cancelled') throw new Error('The assistant run was cancelled.');
    await sleep(POLL_MS);
  }
}
