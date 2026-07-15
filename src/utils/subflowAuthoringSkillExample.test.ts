import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { VisualFlow } from '../types/flow';
import { applyFlowAuthoringCommands } from './flowAuthoringCommands';
import { diffAuthoringDocument } from './flowAuthoringDocument';
import { buildSubflowFlow, parseSubflowDefinitions, resolveSubflowHandles } from './subflowAuthoring';

/**
 * TEACHING FIDELITY PIN: the skill document's own `subflows` example must
 * apply cleanly through the real pipeline. An instruction-following model
 * must never be taught something the validators refuse (the 2026-06-10
 * unsatisfiable-readiness incident class). The example is EXTRACTED from the
 * doc, not copied here — doc drift fails this test.
 */
function skillExampleJson(): Record<string, unknown> {
  const doc = readFileSync(resolve(__dirname, '../../docs/workflow-authoring-skill.md'), 'utf8');
  const section = doc.slice(doc.indexOf('### Creating Subflows'));
  const fence = section.match(/```json\n([\s\S]*?)```/);
  if (!fence) throw new Error('skill doc lost its Creating Subflows JSON example');
  return JSON.parse(fence[1]) as Record<string, unknown>;
}

describe('workflow-authoring-skill.md subflows example', () => {
  it('applies end to end with zero errors (parse -> build -> resolve -> diff -> apply)', () => {
    const example = skillExampleJson();

    // 1. Parse the definitions exactly as the drawer does.
    const parsed = parseSubflowDefinitions(example, { savedFlows: [], refMap: {} });
    expect(parsed.errors).toEqual([]);
    expect(parsed.definitions).toHaveLength(1);
    const def = parsed.definitions[0];
    expect(def.ref).toBe('extract-claims');

    // 2. Build the helper through the validated lane.
    const built = buildSubflowFlow(def, {
      baseFlow: null,
      savedFlows: [],
      resolvedSubflows: new Map<string, VisualFlow>(),
    });
    expect(built.errors).toEqual([]);
    expect(built.flow).not.toBeNull();

    // 3. Simulate the gateway create minting an id.
    const createdId = 'a1b2c3d4';
    const createdFlow: VisualFlow = {
      id: createdId,
      name: built.flow!.name,
      description: built.flow!.description,
      interfaces: built.flow!.interfaces,
      nodes: built.flow!.nodes,
      edges: built.flow!.edges,
      entryNode: built.flow!.entryNode,
    };

    // 4. Substitute the handle in the main document.
    const resolved = resolveSubflowHandles(example, { 'extract-claims': createdId }) as Record<string, unknown>;
    const refs = (resolved.nodes as { subflow_ref?: string }[]).map((node) => node.subflow_ref).filter(Boolean);
    expect(refs).toEqual([createdId]);

    // 5. Diff the main document against an empty canvas with the created
    //    helper resolvable, then apply — zero errors end to end.
    const emptyFlow: VisualFlow = { id: 'main-draft', name: 'Untitled Flow', nodes: [], edges: [] };
    const context = {
      savedFlows: [{ id: createdId, name: createdFlow.name }],
      resolvedSubflows: new Map([[createdId, createdFlow]]),
      currentFlowId: null,
    };
    const diff = diffAuthoringDocument(emptyFlow, resolved, context);
    expect(diff.errors).toEqual([]);
    expect(diff.commands.length).toBeGreaterThan(0);

    const result = applyFlowAuthoringCommands({
      flowName: 'Untitled Flow',
      flowInterfaces: [],
      nodes: [],
      edges: [],
      commands: diff.commands,
      allowDestructive: true,
      resolvedSubflows: context.resolvedSubflows,
    });
    expect(result.errors).toEqual([]);

    // The subflow node's pins were patched from the created helper and the
    // taught edges exist against those patched pins.
    const subflowNode = result.nodes.find((node) => node.data.nodeType === 'subflow');
    expect(subflowNode).toBeTruthy();
    expect(subflowNode?.data.subflowId).toBe(createdId);
    expect(subflowNode?.data.inputs?.some((pin) => pin.id === 'text')).toBe(true);
    expect(subflowNode?.data.outputs?.some((pin) => pin.id === 'claims')).toBe(true);
    const edgeKeys = result.edges.map(
      (edge) => `${edge.source}.${edge.sourceHandle}->${edge.target}.${edge.targetHandle}`
    );
    expect(edgeKeys).toContain(`start.topic->${subflowNode!.id}.text`);
    expect(edgeKeys).toContain(`${subflowNode!.id}.claims->end.claims`);
  });
});
