import type { Edge, Node } from 'reactflow';
import type { FlowFunction, FlowNodeData, Pin } from '../types/flow';
import { isEntryNodeType } from '../types/flow';
import type { GatewayFlowEditorReadiness } from './gatewayClient';
import { gatewayAuthoringCapabilityStatus } from './gatewayClient';
import { getArtifactConnectionError, getConfiguredArtifactInputError } from './mediaArtifacts';
import { gatewayCapabilityForNodeType } from './nodeCapabilities';

export type RunPreflightIssue = {
  id: string;
  nodeId: string;
  nodeLabel: string;
  message: string;
  /** 'warning' issues are ADVISORY: shown in the panel, never blocking Run.
   * Absent = blocking (the historical behavior for definite defects). */
  severity?: 'warning';
};

export type RunPreflightOptions = {
  gatewayReadiness?: GatewayFlowEditorReadiness | null;
  gatewayCapabilitiesLoading?: boolean;
  gatewayCapabilitiesKnown?: boolean;
  /** The flow's named function library (tier 2): enables unknown-call checks. */
  flowFunctions?: FlowFunction[];
};

/**
 * Names an expression may CALL without them being flow functions — the
 * sandbox vocabulary (mirrors runtime `sandbox_helper_globals` + the safe
 * builtins expressions actually use). Kept as an allowlist for the
 * unknown-call check: a call to anything outside this set and the flow's
 * library is a runtime NameError waiting to happen — catch it pre-run.
 */
export const EXPRESSION_BUILTIN_CALLABLES: ReadonlySet<string> = new Set([
  'len', 'str', 'int', 'float', 'bool', 'list', 'dict', 'tuple', 'set',
  'range', 'enumerate', 'zip', 'map', 'filter', 'sorted', 'reversed',
  'min', 'max', 'sum', 'abs', 'round', 'isinstance', 'type',
  'parse_json', 'to_json', 'print', 'repr', 'format', 'divmod', 'hash',
  'ord', 'chr', 'hex', 'oct', 'bin', 'any', 'all', 'getattr', 'hasattr',
]);

/**
 * Python keywords that can legally precede `(` in an EXPRESSION — they are
 * NOT calls. Excluding them is load-bearing: `vars.mode in ("a","b")`,
 * `a and (b or c)`, `x if y else (z)`, `not (done)`, `lambda: (…)` are
 * everyday boolean/grouping syntax the fx editor's own hint invites. Treating
 * them as unknown calls hard-blocks the Run button — the exact
 * unsatisfiable-preflight incident class from 2026-06-10, this time against
 * both human authors and the authoring assistant (adversary P0-2).
 */
const EXPRESSION_KEYWORDS: ReadonlySet<string> = new Set([
  'and', 'or', 'not', 'in', 'is', 'if', 'else', 'for', 'lambda', 'await', 'yield', 'None', 'True', 'False',
]);

/** Call sites `name(` in an expression, excluding method calls `.name(` and
 * keywords that merely precede a parenthesized group. */
function callNamesInExpression(expression: string): string[] {
  const out = new Set<string>();
  const re = /(^|[^\w.])([A-Za-z_]\w*)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(expression))) {
    const name = m[2];
    if (EXPRESSION_KEYWORDS.has(name)) continue;
    out.add(name);
  }
  // `vars`/`value` are bindings, not callables — calling them is caught by
  // the unknown-call rule below when they are not in the allowlist.
  return Array.from(out);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isNonEmptyObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length > 0);
}

function inputConnected(edges: Edge[], nodeId: string, handleId: string): boolean {
  return edges.some((e) => e.target === nodeId && e.targetHandle === handleId);
}

function configValue(node: Node<FlowNodeData>, key: string): unknown {
  const effect = node.data.effectConfig as Record<string, unknown> | undefined;
  const defaults = node.data.pinDefaults as Record<string, unknown> | undefined;
  return effect?.[key] ?? defaults?.[key];
}

/** An inline pin expression SATISFIES an input (tier 1, 2026-07-25): the
 * runtime computes the pin at resolution time. Every readiness rule must
 * count it as resolved or preflight regenerates the unsatisfiable-check
 * loop the 2026-06-10 incident documented (the authoring model grinding
 * against "Missing required input" it already satisfied). */
function pinExpressionPresent(node: Node<FlowNodeData>, handleId: string): boolean {
  const exprs = node.data.pinExpressions;
  return Boolean(exprs && typeof exprs[handleId] === 'string' && exprs[handleId].trim());
}

function stringInputPresent(edges: Edge[], node: Node<FlowNodeData>, ...handles: string[]): boolean {
  for (const handle of handles) {
    if (inputConnected(edges, node.id, handle)) return true;
    if (pinExpressionPresent(node, handle)) return true;
    if (isNonEmptyString(configValue(node, handle))) return true;
  }
  return false;
}

function artifactInputPresent(edges: Edge[], node: Node<FlowNodeData>, ...handles: string[]): boolean {
  for (const handle of handles) {
    if (inputConnected(edges, node.id, handle)) return true;
    if (pinExpressionPresent(node, handle)) return true;
    const value = configValue(node, handle);
    if (isNonEmptyString(value)) return true;
    if (isNonEmptyObject(value)) {
      if (isNonEmptyString(value.$artifact) || isNonEmptyString(value.artifact_id) || isNonEmptyString(value.id)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Provider/model pairing rule for LLM Call and Agent nodes.
 *
 * The runtime treats provider and model as independently optional (each falls
 * back to Gateway/client defaults when blank), and a CONNECTED pin is resolved
 * at runtime — e.g. a model pool feeding `llm_call.model` per loop iteration
 * with provider left on Gateway defaults is a valid, intended pattern. The old
 * "set both or leave both blank" rule fired on that pattern and was impossible
 * to satisfy without deleting a wire the design required (observed: an
 * authoring run burned 10 cycles trying to clear it). It also read only the
 * effect config, so typed pin defaults could never satisfy it.
 *
 * The rule now fires only for half-typed DEFAULTS (one side typed, the other
 * blank and unconnected) — an actionable state — and the message names the
 * current values so both users and the authoring model can see what to fix.
 *
 * Runtime contract note (2026-07-12): the visual llm_call executor used to
 * DROP both provider and model from the effect when only one resolved — the
 * model-pool pattern silently ran on gateway defaults. Fixed runtime-side to
 * forward independently (abstractruntime commit 5578779, pinned by
 * tests/test_visual_llm_call_partial_override.py). This rule's
 * connected-pins-are-resolved stance is the ruled contract on both sides.
 */
function providerModelPairingIssue(
  edges: Edge[],
  node: Node<FlowNodeData>,
  agentConfig?: Record<string, unknown>
): string | null {
  if (inputConnected(edges, node.id, 'provider') || inputConnected(edges, node.id, 'model')) return null;
  const configured = (key: string): string => {
    const fromAgent = agentConfig?.[key];
    if (isNonEmptyString(fromAgent)) return fromAgent.trim();
    const value = configValue(node, key);
    return isNonEmptyString(value) ? value.trim() : '';
  };
  const provider = configured('provider');
  const model = configured('model');
  if (Boolean(provider) === Boolean(model)) return null;
  return provider
    ? `Provider is "${provider}" but model is blank — set a model too, or clear provider to use Gateway defaults`
    : `Model is "${model}" but provider is blank — set its provider too, or clear model to use Gateway defaults`;
}

function pinTypeOf(node: Node<FlowNodeData>, handleId: string, isInput: boolean): string | null {
  const pins = isInput ? node.data.inputs : node.data.outputs;
  const p = pins?.find((x) => x.id === handleId);
  return p ? String(p.type || '') : null;
}

function isExecutionEdge(nodesById: Map<string, Node<FlowNodeData>>, edge: Edge): boolean {
  const src = nodesById.get(edge.source);
  const tgt = nodesById.get(edge.target);
  if (!src || !tgt) return false;
  const st = pinTypeOf(src, edge.sourceHandle || '', false);
  const tt = pinTypeOf(tgt, edge.targetHandle || '', true);
  return st === 'execution' || tt === 'execution';
}

function inputPin(node: Node<FlowNodeData>, handleId: string | null | undefined): Pin | null {
  if (!handleId) return null;
  return node.data.inputs?.find((p) => p.id === handleId) || null;
}

function outputPin(node: Node<FlowNodeData>, handleId: string | null | undefined): Pin | null {
  if (!handleId) return null;
  return node.data.outputs?.find((p) => p.id === handleId) || null;
}

function reachableExecNodes(nodes: Node<FlowNodeData>[], edges: Edge[]): Set<string> {
  if (!nodes.length) return new Set<string>();
  const nodesById = new Map(nodes.map((n) => [n.id, n]));
  const entry =
    nodes.find((n) => isEntryNodeType(n.data.nodeType)) ||
    nodesById.get(nodes[0].id) ||
    null;
  if (!entry) return new Set<string>();

  const reachable = new Set<string>([entry.id]);
  const q: string[] = [entry.id];
  while (q.length) {
    const cur = q.shift() as string;
    for (const e of edges) {
      if (e.source !== cur) continue;
      if (!isExecutionEdge(nodesById, e)) continue;
      const nxt = e.target;
      if (!nxt || reachable.has(nxt)) continue;
      reachable.add(nxt);
      q.push(nxt);
    }
  }
  return reachable;
}

/** Collect the run-var names the graph itself declares (set_var/get_var
 * `name` defaults + flow-start pins). Best effort: vars can also be born at
 * run time (input_data, subflow outputs), so unknown-name findings are
 * WARNING-grade and the check abstains entirely when nothing was collected —
 * the conservative-detector rule (abstain when unsure). Exported so the pin
 * expression editor's vars hint reads the SAME collection (one definition of
 * "declared var"; a second copy would drift). */
export function collectDeclaredVarNames(nodes: Node<FlowNodeData>[]): Set<string> {
  const names = new Set<string>();
  for (const n of nodes) {
    const d = n.data;
    if (d.nodeType === 'set_var' || d.nodeType === 'get_var') {
      const nm = d.pinDefaults?.name;
      if (typeof nm === 'string' && nm.trim()) names.add(nm.trim());
    }
    if (d.nodeType === 'on_flow_start') {
      for (const p of d.outputs || []) {
        if (p.type !== 'execution' && p.id) names.add(p.id);
      }
    }
  }
  return names;
}

/** vars.<name> and vars["name"] references inside an expression. A regex is
 * honest enough here: preflight is advisory and the runtime resolves the
 * truth; false negatives cost nothing, false positives are avoided by the
 * two literal forms only. */
function varReadsInExpression(expression: string): string[] {
  const out = new Set<string>();
  const attr = /\bvars\.([A-Za-z_][A-Za-z0-9_]*)/g;
  const subs = /\bvars\[\s*["']([^"']+)["']\s*\]/g;
  let m: RegExpExecArray | null;
  while ((m = attr.exec(expression))) out.add(m[1]);
  while ((m = subs.exec(expression))) out.add(m[1]);
  return Array.from(out);
}

export function computeRunPreflightIssues(
  nodes: Node<FlowNodeData>[],
  edges: Edge[],
  options: RunPreflightOptions = {},
): RunPreflightIssue[] {
  const reachable = reachableExecNodes(nodes, edges);
  const nodesById = new Map(nodes.map((n) => [n.id, n]));
  const issues: RunPreflightIssue[] = [];
  const declaredVars = collectDeclaredVarNames(nodes);
  const flowFunctions = Array.isArray(options.flowFunctions) ? options.flowFunctions : [];
  const functionNames = new Set(flowFunctions.map((f) => f.name));

  const push = (node: Node<FlowNodeData>, message: string, severity?: 'warning') => {
    const label = isNonEmptyString(node.data.label) ? node.data.label.trim() : node.id;
    issues.push({
      id: `${node.id}:${message}`,
      nodeId: node.id,
      nodeLabel: label,
      message,
      ...(severity ? { severity } : {}),
    });
  };

  // Flow function library checks (tier 2): the runtime refuses these at
  // build — catching them pre-run turns a failed start into an editable
  // panel row. Attributed to the entry node (library errors are flow-level).
  if (flowFunctions.length > 0) {
    const entry = nodes.find((n) => isEntryNodeType(n.data.nodeType)) || nodes[0];
    const seen = new Set<string>();
    for (const fn of flowFunctions) {
      const name = (fn?.name || '').trim();
      if (!name) continue;
      if (seen.has(name) && entry) {
        push(entry, `Duplicate function name '${name}' in the flow library`);
      }
      seen.add(name);
      const defRe = new RegExp(`(^|\\n)\\s*def\\s+${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\(`);
      if (entry && (!fn.code || !defRe.test(fn.code))) {
        push(entry, `Function '${name}' has no matching 'def ${name}(...)' in its code`);
      }
    }
  }

  for (const edge of edges) {
    const target = nodesById.get(edge.target);
    if (!target || !reachable.has(target.id)) continue;
    const source = nodesById.get(edge.source);
    if (!source) continue;
    const sourcePin = outputPin(source, edge.sourceHandle);
    const targetPin = inputPin(target, edge.targetHandle);
    if (!sourcePin || !targetPin) continue;
    if (sourcePin.type === 'execution' || targetPin.type === 'execution') continue;
    const artifactError = getArtifactConnectionError(source.data, sourcePin, target.data, targetPin);
    if (artifactError) push(target, `${targetPin.label || targetPin.id}: ${artifactError}`);
  }

  for (const n of nodes) {
    if (!reachable.has(n.id)) continue;

    const capabilityStatus = gatewayAuthoringCapabilityStatus(
      options.gatewayReadiness,
      gatewayCapabilityForNodeType(n.data.nodeType),
      {
        loading: options.gatewayCapabilitiesLoading,
        known: options.gatewayCapabilitiesKnown,
      }
    );
    if (capabilityStatus && !capabilityStatus.checking && !capabilityStatus.available) {
      push(n, capabilityStatus.reason);
    }

    // Inline pin expression checks (tier 1): catch the typo BEFORE any run.
    const nodeExprs = n.data.pinExpressions;
    if (nodeExprs && typeof nodeExprs === 'object') {
      // The node's current data-input pin ids: an expression key that is not
      // among them is STALE (a dynamic pin was renamed or deleted out from
      // under it). At runtime the evaluator still runs and writes a dead key
      // (harmless), but the author almost certainly meant a live pin — warn.
      const inputPinIds = new Set(
        (n.data.inputs || []).filter((p) => p.type !== 'execution').map((p) => p.id)
      );
      for (const [pinId, expr] of Object.entries(nodeExprs)) {
        if (typeof expr !== 'string' || !expr.trim()) {
          push(n, `Expression on '${pinId}' is empty — remove it or write one`);
          continue;
        }
        if (!inputPinIds.has(pinId)) {
          push(n, `Expression on unknown pin '${pinId}' — no such input pin (renamed or deleted?); it will not feed any pin`);
          continue;
        }
        // `value` without a wire resolves to the pin default (or None): legal
        // when a default exists, almost certainly a mistake when neither does.
        if (/\bvalue\b/.test(expr) && !inputConnected(edges, n.id, pinId)) {
          const hasDefault = n.data.pinDefaults ? n.data.pinDefaults[pinId] !== undefined : false;
          if (!hasDefault) {
            push(n, `Expression on '${pinId}' reads 'value' but the pin has no wire and no default`);
          }
        }
        if (declaredVars.size > 0) {
          for (const name of varReadsInExpression(expr)) {
            if (!declaredVars.has(name)) {
              // ADVISORY, not a blocker: the message itself admits the var
              // may legitimately arrive at run time (input_data, a parent
              // run, _runtime seeding) — an uncertain heuristic must never
              // hard-block the Run button (persistence adversary P2-b; the
              // 2026-06-10 unsatisfiable-preflight class).
              push(n, `Expression on '${pinId}' reads vars.${name} — no set_var/start pin declares it (it may still arrive at run time)`, 'warning');
            }
          }
        }
        // Unknown call check (tier 2): a call to a name that is neither a
        // flow function nor a sandbox builtin dies at run time with a
        // NameError — the exact class of failure preflight exists to move
        // before the run.
        for (const callName of callNamesInExpression(expr)) {
          if (functionNames.has(callName)) continue;
          if (EXPRESSION_BUILTIN_CALLABLES.has(callName)) continue;
          push(
            n,
            `Expression on '${pinId}' calls ${callName}(…) — not a flow function or sandbox builtin (typo, or create it in the Functions panel)`
          );
        }
      }
    }

    for (const pin of n.data.inputs || []) {
      if (inputConnected(edges, n.id, pin.id)) continue;
      const value = configValue(n, pin.id);
      const artifactError = getConfiguredArtifactInputError(n.data, pin, value);
      if (artifactError) push(n, `${pin.label || pin.id}: ${artifactError}`);
    }

    const t = n.data.nodeType;
    if (t === 'llm_call' || t === 'agent') {
      const pairingIssue = providerModelPairingIssue(edges, n, t === 'agent' ? (n.data.agentConfig as Record<string, unknown> | undefined) : undefined);
      if (pairingIssue) push(n, pairingIssue);
    }

    if (t === 'generate_image') {
      if (!stringInputPresent(edges, n, 'prompt')) push(n, 'Missing required input: prompt');
    }

    if (t === 'generate_video' || t === 'text_to_video') {
      if (!stringInputPresent(edges, n, 'prompt')) push(n, 'Missing required input: prompt');
    }

    if (t === 'image_to_video') {
      if (!stringInputPresent(edges, n, 'prompt')) push(n, 'Missing required input: prompt');
      if (!artifactInputPresent(edges, n, 'source_image', 'image_artifact')) {
        push(n, 'Missing required input: source_image');
      }
    }

    if (t === 'edit_image' || t === 'image_to_image') {
      if (!stringInputPresent(edges, n, 'prompt')) push(n, 'Missing required input: prompt');
      if (!artifactInputPresent(edges, n, 'image_artifact', 'source_image')) {
        push(n, 'Missing required input: image_artifact');
      }
    }

    if (t === 'upscale_image') {
      if (!artifactInputPresent(edges, n, 'image_artifact', 'source_image')) {
        push(n, 'Missing required input: image_artifact');
      }
    }

    if (t === 'generate_voice') {
      if (!stringInputPresent(edges, n, 'text')) push(n, 'Missing required input: text');
    }

    if (t === 'generate_music') {
      if (!stringInputPresent(edges, n, 'prompt')) push(n, 'Missing required input: prompt');
    }

    if (t === 'transcribe_audio') {
      if (!artifactInputPresent(edges, n, 'audio_artifact')) push(n, 'Missing required input: audio_artifact');
    }
  }

  // Stable ordering: node label then message (keeps UX consistent).
  issues.sort((a, b) => {
    const la = a.nodeLabel.toLowerCase();
    const lb = b.nodeLabel.toLowerCase();
    if (la !== lb) return la.localeCompare(lb);
    return a.message.localeCompare(b.message);
  });
  return issues;
}
