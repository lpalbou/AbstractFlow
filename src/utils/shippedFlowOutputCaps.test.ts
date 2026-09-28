import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

// ADR-0026 §2 (operator ruling 2026-09-28): no shipped workflow caps a
// model's output by default. The verify/judge agents of the coding families
// (coding, multiagent, spec, spec-std) carried `max_output_tokens: 4000` on
// their structured verdict call; the model default applies now, and the pin
// remains for an author who wants an explicit budget.
const FLOWS_DIR = join(__dirname, '..', '..', 'examples', 'flows');
const MODEL_NODE_TYPES = new Set(['agent', 'llm_call']);

function outputCapDefaults(): string[] {
  const found: string[] = [];
  for (const file of readdirSync(FLOWS_DIR).filter((name) => name.endsWith('.json')).sort()) {
    const flow = JSON.parse(readFileSync(join(FLOWS_DIR, file), 'utf8')) as {
      nodes?: Array<{ id: string; data?: { nodeType?: string; pinDefaults?: Record<string, unknown> } }>;
    };
    for (const node of flow.nodes || []) {
      const nodeType = String(node.data?.nodeType || '');
      const value = node.data?.pinDefaults?.max_output_tokens;
      if (MODEL_NODE_TYPES.has(nodeType) && value !== undefined && value !== null && value !== '') {
        found.push(`${file}:${node.id} max_output_tokens=${String(value)}`);
      }
    }
  }
  return found;
}

describe('shipped workflows carry no default output-token cap (ADR-0026)', () => {
  it('scans real model nodes (the check is not vacuous)', () => {
    const verifier = JSON.parse(readFileSync(join(FLOWS_DIR, 'coding-verify-gates.json'), 'utf8')) as {
      nodes: Array<{ id: string; data: { nodeType: string } }>;
    };
    expect(verifier.nodes.find((node) => node.id === 'verifier')?.data.nodeType).toBe('agent');
  });

  it('no agent or llm_call node in examples/flows sets a max_output_tokens default', () => {
    expect(outputCapDefaults()).toEqual([]);
  });
});
