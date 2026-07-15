/**
 * Subflow AUTHORING for the assistant lane: the model can declare new helper
 * workflows inside one emission (`graph.subflows`) and reference them from the
 * main document by handle. This module is PURE — parsing, validation, handle
 * resolution, and building store-shaped flow bodies; all gateway I/O stays in
 * the drawer.
 *
 * Ownership semantics (deliberate, reviewed):
 * - `subflows` is CREATE/UPDATE-only. The document owns the OPEN flow, never
 *   the library: omitting a previously emitted subflow definition leaves the
 *   saved workflow alone. Deleting saved workflows stays a human act.
 * - Updates are allowed only for workflows this conversation CREATED (the
 *   ref→id map is conversation state). Library flows are reference-only; the
 *   assistant must tell the user to open them to edit them.
 * - Handles resolve within the emission (and across cycles via the persisted
 *   ref map); they never leak into the saved graph — the drawer substitutes
 *   real ids before the main diff runs.
 */

import type { VisualFlow } from '../types/flow';
import { diffAuthoringDocument } from './flowAuthoringDocument';
import { applyFlowAuthoringCommands } from './flowAuthoringCommands';
import { fromVisualFlow, toVisualFlow } from './serialization';

/** Budget: a runaway emission must not flood the library. */
export const MAX_SUBFLOW_DEFINITIONS_PER_EMISSION = 5;

/** Handle spelling: kebab/snake identifier, never id-shaped ambiguity. */
const HANDLE_PATTERN = /^[a-z][a-z0-9_-]{1,63}$/;

export interface SubflowDefinition {
  /** Stable conversation-local handle ("ref"). */
  ref: string;
  flowName: string;
  description: string;
  /** The definition's own authoring document (nodes/edges…), untouched. */
  rawDocument: Record<string, unknown>;
}

export interface ParsedSubflowDefinitions {
  definitions: SubflowDefinition[];
  errors: string[];
}

/** Store-shaped body ready for the gateway visualflows create/update calls. */
export interface BuiltSubflowFlow {
  name: string;
  description: string;
  interfaces: string[];
  nodes: VisualFlow['nodes'];
  edges: VisualFlow['edges'];
  entryNode?: string;
  warnings: string[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function textField(record: Record<string, unknown>, keys: string[], maxLen: number): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim().slice(0, maxLen);
  }
  return '';
}

/**
 * Extract and validate `graph.subflows`. Errors are model-repairable text
 * (they ride the same document-issue channel as diff errors).
 */
export function parseSubflowDefinitions(
  rawGraph: unknown,
  context: {
    savedFlows: { id: string; name: string }[];
    /** Conversation ref→saved-id map (defs whose ref is mapped become updates). */
    refMap: Record<string, string>;
  }
): ParsedSubflowDefinitions {
  const errors: string[] = [];
  const definitions: SubflowDefinition[] = [];
  const graph = asRecord(rawGraph);
  if (!graph) return { definitions, errors };
  const rawList = graph.subflows;
  if (rawList === undefined) return { definitions, errors };
  if (!Array.isArray(rawList)) {
    errors.push('"subflows" must be an array of workflow definitions ({ref, flow_name, description, nodes, edges}).');
    return { definitions, errors };
  }
  if (rawList.length > MAX_SUBFLOW_DEFINITIONS_PER_EMISSION) {
    errors.push(
      `"subflows" carries ${rawList.length} definitions; the per-emission budget is ${MAX_SUBFLOW_DEFINITIONS_PER_EMISSION}. ` +
        'Create the most load-bearing helpers first; later cycles can add the rest.'
    );
    return { definitions, errors };
  }

  const savedIds = new Set(context.savedFlows.map((flow) => flow.id));
  const savedNames = new Map(context.savedFlows.map((flow) => [flow.name.toLowerCase(), flow.id]));
  const seenRefs = new Set<string>();

  for (const [index, rawDef] of rawList.entries()) {
    const def = asRecord(rawDef);
    if (!def) {
      errors.push(`subflows[${index}] is not an object.`);
      continue;
    }
    const ref = textField(def, ['ref', 'handle'], 64);
    if (!ref) {
      errors.push(`subflows[${index}] is missing "ref" — a stable handle like "extract-claims" used by subflow_ref.`);
      continue;
    }
    if (!HANDLE_PATTERN.test(ref)) {
      errors.push(
        `subflows[${index}].ref "${ref}" is not a valid handle (lowercase letters/digits/dashes/underscores, 2-64 chars, starting with a letter).`
      );
      continue;
    }
    if (seenRefs.has(ref)) {
      errors.push(`subflows contains duplicate ref "${ref}" — each definition needs a unique handle.`);
      continue;
    }
    seenRefs.add(ref);
    // A handle that collides with a REAL saved id would make subflow_ref
    // ambiguous. Refs already mapped by THIS conversation are fine (that is
    // the update path); anything else is refused.
    if (savedIds.has(ref) && context.refMap[ref] !== ref) {
      errors.push(
        `subflows[${index}].ref "${ref}" collides with an existing saved workflow id. Pick a different handle; ` +
          'to REFERENCE that workflow, use its id in subflow_ref without a definition.'
      );
      continue;
    }
    const flowName = textField(def, ['flow_name', 'name'], 120);
    if (!flowName) {
      errors.push(`subflows[${index}] ("${ref}") is missing "flow_name".`);
      continue;
    }
    const mappedId = context.refMap[ref];
    // Name collisions with OTHER library flows breed the three-dp-research
    // confusion class; refuse at birth (updates keeping their own name pass).
    const nameOwner = savedNames.get(flowName.toLowerCase());
    if (nameOwner && nameOwner !== mappedId) {
      errors.push(
        `subflows[${index}] ("${ref}") names the workflow "${flowName}", but a saved workflow with that name already exists (${nameOwner}). ` +
          'Pick a distinct name, or reference the existing workflow instead of redefining it.'
      );
      continue;
    }
    const description = textField(def, ['description'], 600);
    if (!description) {
      errors.push(
        `subflows[${index}] ("${ref}") is missing "description" — created workflows enter the shared library and must say what they do.`
      );
      continue;
    }
    if (!Array.isArray(def.nodes) || def.nodes.length === 0) {
      errors.push(`subflows[${index}] ("${ref}") has no nodes.`);
      continue;
    }
    definitions.push({ ref, flowName, description, rawDocument: def });
  }
  return { definitions, errors };
}

/**
 * Rewrite subflow_ref HANDLES in the main document to real saved ids (pure;
 * returns a new object). Accepts both "ref:handle" and bare "handle" spellings.
 * Unresolvable handle-shaped refs are left for the reference validator to
 * refuse with its own actionable error.
 */
export function resolveSubflowHandles(rawGraph: unknown, refToId: Record<string, string>): unknown {
  const graph = asRecord(rawGraph);
  if (!graph || !Array.isArray(graph.nodes)) return rawGraph;
  const resolveRef = (value: unknown): unknown => {
    if (typeof value !== 'string' || !value.trim()) return value;
    const raw = value.trim();
    const handle = raw.startsWith('ref:') ? raw.slice(4).trim() : raw;
    const id = refToId[handle];
    return id || value;
  };
  const nodes = graph.nodes.map((rawNode) => {
    const node = asRecord(rawNode);
    if (!node) return rawNode;
    const next: Record<string, unknown> = { ...node };
    let changed = false;
    for (const key of ['subflow_ref', 'subflowRef', 'subflow_id', 'subflowId', 'workflow_id', 'workflowId']) {
      if (key in next) {
        const resolved = resolveRef(next[key]);
        if (resolved !== next[key]) {
          next[key] = resolved;
          changed = true;
        }
      }
    }
    return changed ? next : rawNode;
  });
  return { ...graph, nodes };
}

/** Handles referenced by the main document that have no definition and no map entry. */
export function danglingSubflowHandles(
  rawGraph: unknown,
  definitionRefs: Set<string>,
  refMap: Record<string, string>
): string[] {
  const graph = asRecord(rawGraph);
  if (!graph || !Array.isArray(graph.nodes)) return [];
  const dangling = new Set<string>();
  for (const rawNode of graph.nodes) {
    const node = asRecord(rawNode);
    if (!node) continue;
    for (const key of ['subflow_ref', 'subflowRef', 'subflow_id', 'subflowId', 'workflow_id', 'workflowId']) {
      const value = node[key];
      if (typeof value !== 'string' || !value.trim()) continue;
      const raw = value.trim();
      if (!raw.startsWith('ref:')) continue;
      const handle = raw.slice(4).trim();
      if (!definitionRefs.has(handle) && !refMap[handle]) dangling.add(handle);
    }
  }
  return Array.from(dangling);
}

/**
 * Build a store-shaped flow from one definition by running it through the SAME
 * validated document lane as the open canvas: diff against the base graph
 * (empty for creates, the stored graph for updates), apply the compiled
 * commands, and serialize. Every canonicalization and guard the main lane has
 * applies to created subflows for free.
 */
export function buildSubflowFlow(
  definition: SubflowDefinition,
  options: {
    /** Existing stored graph when updating; null when creating. */
    baseFlow: VisualFlow | null;
    /** Saved workflows for nested REFERENCE validation (defs may reference saved ids, never other handles). */
    savedFlows: { id: string; name: string }[];
    resolvedSubflows: Map<string, VisualFlow>;
  }
): { flow: BuiltSubflowFlow | null; errors: string[]; unchanged?: boolean } {
  const errors: string[] = [];

  // Nested handle refs are refused: one level of new definitions per
  // emission. Deep nesting still composes ACROSS cycles (innermost first —
  // it appears in AVAILABLE WORKFLOWS on the next cycle).
  const defGraph = asRecord(definition.rawDocument);
  if (defGraph && Array.isArray(defGraph.nodes)) {
    for (const rawNode of defGraph.nodes) {
      const node = asRecord(rawNode);
      const ref = node && typeof node.subflow_ref === 'string' ? node.subflow_ref.trim() : '';
      if (ref.startsWith('ref:')) {
        errors.push(
          `subflow "${definition.ref}" references another definition ("${ref}") — definitions may reference SAVED workflows only. ` +
            'Create the inner helper first (it appears in AVAILABLE WORKFLOWS next cycle), then reference it by id.'
        );
      }
    }
  }
  if (errors.length > 0) return { flow: null, errors };

  const base: VisualFlow =
    options.baseFlow || { id: `subflow-draft-${definition.ref}`, name: definition.flowName, nodes: [], edges: [] };
  const document = { ...definition.rawDocument, flow_name: definition.flowName };
  const diff = diffAuthoringDocument(base, document, {
    savedFlows: options.savedFlows,
    resolvedSubflows: options.resolvedSubflows,
    currentFlowId: options.baseFlow?.id || null,
  });
  if (diff.errors.length > 0) {
    return { flow: null, errors: diff.errors.map((error) => `subflow "${definition.ref}": ${error}`) };
  }
  if (options.baseFlow && diff.commands.length === 0) {
    // Faithful re-emission of an already-created helper: a no-op, not an error.
    return {
      flow: {
        name: options.baseFlow.name,
        description: definition.description,
        interfaces: Array.isArray(options.baseFlow.interfaces) ? options.baseFlow.interfaces : [],
        nodes: options.baseFlow.nodes,
        edges: options.baseFlow.edges,
        entryNode: options.baseFlow.entryNode || undefined,
        warnings: [],
      },
      errors: [],
      unchanged: true,
    };
  }

  const baseState = fromVisualFlow(base);
  const result = applyFlowAuthoringCommands({
    flowName: definition.flowName,
    flowInterfaces: options.baseFlow && Array.isArray(options.baseFlow.interfaces) ? options.baseFlow.interfaces : [],
    nodes: baseState.nodes,
    edges: baseState.edges,
    commands: diff.commands,
    allowDestructive: true,
    resolvedSubflows: options.resolvedSubflows,
  });
  if (result.errors.length > 0) {
    return { flow: null, errors: result.errors.map((error) => `subflow "${definition.ref}": ${error}`) };
  }

  const visual = toVisualFlow('subflow-candidate', result.flowName || definition.flowName, result.nodes, result.edges);
  const warnings: string[] = [...result.warnings.map((warning) => `subflow "${definition.ref}": ${warning}`)];

  // Contract sanity: a composition target needs a boundary. Missing start is
  // an ERROR (the flow cannot run); missing end is a WARNING (legal, but the
  // subflow node will expose no outputs — usually a mistake).
  const hasStart = visual.nodes.some((node) => node.type === 'on_flow_start');
  const hasEnd = visual.nodes.some((node) => node.type === 'on_flow_end');
  if (!hasStart) {
    return {
      flow: null,
      errors: [
        `subflow "${definition.ref}" has no On Flow Start node — it cannot expose inputs or run as a composition target. Add on_flow_start with the inputs it needs.`,
      ],
    };
  }
  if (!hasEnd) {
    warnings.push(
      `subflow "${definition.ref}" has no On Flow End node — it will expose NO outputs when referenced. Add on_flow_end if callers need results.`
    );
  }

  return {
    flow: {
      name: visual.name,
      description: definition.description,
      interfaces: options.baseFlow && Array.isArray(options.baseFlow.interfaces) ? options.baseFlow.interfaces : [],
      nodes: visual.nodes,
      edges: visual.edges,
      entryNode: visual.entryNode || undefined,
      warnings,
    },
    errors: [],
  };
}
