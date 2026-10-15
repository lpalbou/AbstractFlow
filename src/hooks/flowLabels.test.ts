// Operator 2026-10-11: "Answer User" also shows messages that answer nothing;
// the node (type answer_user, unchanged) is "Show Message".
import { describe, expect, it } from 'vitest';
import { useFlowStore } from './useFlow';
import { getNodeTemplate } from '../types/nodes';

describe('Show Message (answer_user)', () => {
  it('is the label of new nodes, and of saved nodes that kept the old default; a custom label stays', () => {
    expect(getNodeTemplate('answer_user')?.label).toBe('Show Message');
    const node = (id: string, label: string) => ({
      id, type: 'custom', position: { x: 0, y: 0 },
      data: { nodeType: 'answer_user', label, icon: '', headerColor: '', inputs: [], outputs: [] },
    });
    useFlowStore.getState().loadFlow({ id: 'f', name: 'f', nodes: [node('a', 'Answer User'), node('b', 'Tell the team')], edges: [] } as never);
    const labels = useFlowStore.getState().nodes.map((n) => n.data.label);
    expect(labels).toEqual(['Show Message', 'Tell the team']);
  });
});
