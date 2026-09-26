import type { Edge, Node } from 'reactflow';
import type { FlowFunction, FlowNodeData, Pin } from '../types/flow';
import { isEntryNodeType } from '../types/flow';
import type { GatewayFlowEditorReadiness } from './gatewayClient';
import { gatewayAuthoringCapabilityStatus } from './gatewayClient';
import { interfaceBoundaryPins, interfacePinTypeMatches, missingInterfacePins } from './flowFamilies';
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
  /** The flow's declared interfaces: enables the required boundary-pin check. */
  flowInterfaces?: string[];
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
    // `set_vars` writes N top-level vars from ONE `updates` object, so its
    // names are only static when the node carries a seed default — which is
    // exactly how a flow declares its run-var inventory on the canvas (the
    // flat-vars replacement for a single `state` blob). Collect those keys so
    // the unknown-var check and the expression editor's hint know them; a
    // computed-only `updates` contributes nothing and the check abstains as
    // before.
    if (d.nodeType === 'set_vars') {
      const seed = d.pinDefaults?.updates;
      if (seed && typeof seed === 'object' && !Array.isArray(seed)) {
        for (const key of Object.keys(seed as Record<string, unknown>)) {
          if (key.trim()) names.add(key.trim());
        }
      }
    }
    if (d.nodeType === 'on_flow_start') {
      for (const p of d.outputs || []) {
        if (p.type !== 'execution' && p.id) names.add(p.id);
      }
    }
  }
  return names;
}

/**
 * A literal permitted as the second argument of `.get(key, default)`.
 * Kept narrow so `x.get("k", compute())` is never mistaken for a plain read.
 */
const GET_DEFAULT_LITERAL = String.raw`(True|False|None|-?\d+(\.\d+)?|"[^"]*"|'[^']*'|\[\]|\{\})`;

/** The whole expression is a read of a run var, optionally dotted, optionally
 * with a default — `get_var{name:"<dotted.path>", default:<d>}` expresses it
 * exactly (the runtime handler walks dotted paths and honours `default`). */
const TRIVIAL_VAR_READ = new RegExp(
  String.raw`^\s*vars(\.[A-Za-z_]\w*|\[\s*["'][^"']+["']\s*\])+` +
    String.raw`(\s*\.\s*get\(\s*["'][^"']*["']\s*(,\s*${GET_DEFAULT_LITERAL}\s*)?\))?\s*$`
);

/** The whole expression is a field read off the pin's OWN wired value. A
 * Get Variable node cannot express this — the honest fixes are a declared
 * output pin upstream, or Break Object when several fields come off one wire. */
const TRIVIAL_FIELD_EXTRACT = new RegExp(
  String.raw`^\s*(` +
    String.raw`\(\s*value\s+or\s+(\{\}|\[\]|"")\s*\)\s*\.\s*get\(\s*["'][^"']*["']\s*(,\s*${GET_DEFAULT_LITERAL}\s*)?\)` +
    String.raw`|value(\[\s*["'][^"']+["']\s*\]|\s*\.\s*get\(\s*["'][^"']*["']\s*(,\s*${GET_DEFAULT_LITERAL}\s*)?\))+` +
    String.raw`)\s*$`
);

/** Classify an expression that carries no derivation. Exported so the audit
 * script's Python twin and this can be diffed against the same corpus. */
export function trivialExpressionKind(expression: string): 'var-read' | 'field-extract' | null {
  const one = expression.trim().replace(/\s+/g, ' ');
  if (TRIVIAL_VAR_READ.test(one)) return 'var-read';
  if (TRIVIAL_FIELD_EXTRACT.test(one)) return 'field-extract';
  return null;
}

/**
 * Subflow input pins that carry a whole object instead of a named field. The
 * runtime spreads DECLARED input pins into the child's run vars and only falls
 * back to these when nothing else is declared (`_create_subflow_handler`), so
 * per-field pins cost nothing at run time — the blob only buys invisibility.
 */
const SUBFLOW_BLOB_PINS: ReadonlySet<string> = new Set(['input', 'vars']);
const SUBFLOW_CONTROL_PINS: ReadonlySet<string> = new Set(['inherit_context', 'inheritContext']);
/** Node types that BUILD an object — feeding one into a blob pin is the smell. */
const OBJECT_BUILDER_TYPES: ReadonlySet<string> = new Set(['make_object', 'code', 'merge', 'parse_json']);

/**
 * P6 HIDDEN CONTRACT (advisory). The editor cannot see the child's graph, so
 * the conservative signal is the pairing: the subflow node declares ONE object
 * pin and something upstream hand-BUILDS the object fed into it. That pair is
 * always a boundary the canvas is refusing to draw. A node that simply has one
 * `input` pin with a plain wire is left alone — the child's contract may
 * genuinely be one value.
 */
function hiddenSubflowContract(
  node: Node<FlowNodeData>,
  edges: Edge[],
  nodesById: Map<string, Node<FlowNodeData>>
): string | null {
  if (node.data.nodeType !== 'subflow') return null;
  const declared = (node.data.inputs || [])
    .filter((p) => p.type !== 'execution' && !SUBFLOW_CONTROL_PINS.has(p.id))
    .map((p) => p.id);
  if (declared.length !== 1 || !SUBFLOW_BLOB_PINS.has(declared[0])) return null;
  const feeder = edges.find((e) => e.target === node.id && e.targetHandle === declared[0]);
  if (!feeder) return null;
  const source = nodesById.get(feeder.source);
  if (!source || !OBJECT_BUILDER_TYPES.has(String(source.data.nodeType))) return null;
  return `This subflow takes one '${declared[0]}' object built by "${source.data.label || source.id}" — declare an input pin per child field instead, so the canvas shows what crosses the boundary`;
}

/**
 * P7 CODE-FOR-ORCHESTRATION (advisory). Prompt and system text must stay
 * editable by users and agents without opening a Python body. Dominance is
 * measured in CHARACTERS: a prompt is one long literal on ONE line, so a line
 * ratio scores the worst offenders lowest.
 */
const CODE_STRING_LITERAL = /("""[\s\S]*?"""|'''[\s\S]*?'''|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g;
const SHELL_MARKERS = ['&&', '||', '2>&1', '>/dev/null', '$(', '`'];
const PROSE_MIN_WORDS = 8;
const PROSE_CHAR_SHARE = 0.5;
const PROMPT_PIN_IDS: ReadonlySet<string> = new Set([
  'prompt', 'system', 'system_prompt', 'instructions', 'brief', 'task', 'question',
]);

/** Characters of natural language in a string literal, else 0. Shell/command
 * text is deterministic glue — the legitimate use of a code node — never prose. */
function proseLiteralLength(literal: string): number {
  const body = literal.replace(/^['"]+|['"]+$/g, '');
  if (SHELL_MARKERS.some((marker) => body.includes(marker))) return 0;
  const words = body.split(/\s+/).filter(Boolean);
  if (words.length < PROSE_MIN_WORDS) return 0;
  const wordy = words.filter((w) => /^[A-Za-z][A-Za-z'\-,.;:()]*$/.test(w)).length;
  if (wordy < words.length * 0.5) return 0;
  return body.length;
}

/** Share of a code body that is prose text. Exported so the audit script's
 * Python twin and this can be diffed against the same corpus. */
export function codeProseShare(body: string): number {
  const code = body
    .split('\n')
    .filter((line) => line.trim() && !line.trim().startsWith('#'))
    .join('\n');
  if (code.length < 80) return 0;
  let prose = 0;
  for (const match of code.matchAll(CODE_STRING_LITERAL)) prose += proseLiteralLength(match[0]);
  return prose / code.length;
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

  // Declared interfaces: a host binds its inputs to On Flow Start and reads
  // its results from On Flow End BY PIN ID. Advisory (the flow still runs),
  // but each of these is a value the host sends into nothing, reads as null,
  // or receives with the wrong type.
  const interfacePins = interfaceBoundaryPins(options.flowInterfaces);
  if (interfacePins.start.length > 0 || interfacePins.end.length > 0) {
    for (const n of nodes) {
      const isStart = n.data.nodeType === 'on_flow_start';
      if (!isStart && n.data.nodeType !== 'on_flow_end') continue;
      const nodeName = isStart ? 'On Flow Start' : 'On Flow End';
      for (const pin of missingInterfacePins(n.data, interfacePins)) {
        push(
          n,
          `'${pin.id}' (${pin.type}) is required by ${pin.interfaceId}: hosts ${isStart ? 'send' : 'read'} it. Add it to ${nodeName} or remove the interface`,
          'warning'
        );
      }
      const required = isStart ? interfacePins.start : interfacePins.end;
      const present = isStart ? n.data.outputs : n.data.inputs;
      const defaults = (n.data.pinDefaults || {}) as Record<string, unknown>;
      const expressions = (n.data.pinExpressions || {}) as Record<string, unknown>;
      for (const spec of required) {
        const pin = present.find((p) => p.id === spec.id);
        if (!pin) continue;
        if (!interfacePinTypeMatches(pin.type, spec.type)) {
          push(n, `'${pin.id}' is typed ${pin.type}, the interface expects ${spec.type} (${spec.interfaceId})`, 'warning');
        }
        if (
          !isStart &&
          !inputConnected(edges, n.id, pin.id) &&
          !Object.prototype.hasOwnProperty.call(defaults, pin.id) &&
          !Object.prototype.hasOwnProperty.call(expressions, pin.id)
        ) {
          push(n, `'${pin.id}' is not connected; hosts will read null (${spec.interfaceId})`, 'warning');
        }
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

        // Doctrine advisories (2026-07-30). An expression that only READS is
        // not an expression — it is a node the canvas is not drawing, and the
        // two lanes are behaviourally identical (every pure node is volatile
        // and re-pulled per resolution, so a wired Get Variable re-reads in a
        // loop condition exactly as the expression does). WARNING-grade on
        // purpose: this is style, and a style rule must never block Run.
        const trivial = trivialExpressionKind(expr);
        if (trivial === 'var-read') {
          push(
            n,
            `Expression on '${pinId}' only reads a variable — use a Get Variable node (it resolves dotted paths and takes a default) and wire it in`,
            'warning'
          );
        } else if (trivial === 'field-extract') {
          push(
            n,
            `Expression on '${pinId}' only reads a field off its own wire — declare that output pin upstream, or use Break Object`,
            'warning'
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

  // Visual-primacy advisories (2026-07-30, doctrine 0155): what the canvas is
  // failing to show. Their own pass because the prime offender — a prompt
  // composer — is a PURE node, and pure nodes never enter the exec-reachable
  // set the readiness rules walk. "Live" here means reachable, or one data hop
  // from something reachable (the pure-helper lane). Both are WARNING-grade for
  // the same reason the expression advisories are: they are style, and a style
  // rule that blocks Run gets the whole panel switched off.
  const live = new Set(reachable);
  for (const e of edges) {
    if (reachable.has(e.target) && !isExecutionEdge(nodesById, e)) live.add(e.source);
  }
  for (const n of nodes) {
    if (!live.has(n.id)) continue;

    const hiddenContract = hiddenSubflowContract(n, edges, nodesById);
    if (hiddenContract) push(n, hiddenContract, 'warning');

    if (n.data.nodeType === 'code') {
      const share = codeProseShare(String(n.data.codeBody || n.data.code || ''));
      if (share > PROSE_CHAR_SHARE) {
        const feeds = Array.from(
          new Set(
            edges
              .filter((e) => e.source === n.id && PROMPT_PIN_IDS.has(String(e.targetHandle || '')))
              .map((e) => String(e.targetHandle))
          )
        );
        push(
          n,
          `${Math.round(share * 100)}% of this code body is prose text${feeds.length ? ` feeding ${feeds.join('/')}` : ''} — prompt and system text belongs in an editable pin default or a String Template; keep the code node for selecting between texts that live on pins`,
          'warning'
        );
      }
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
