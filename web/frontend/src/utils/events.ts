import type { Node } from 'reactflow';
import type { FlowNodeData } from '../types/flow';

export function collectCustomEventNames(nodes: Array<Node<FlowNodeData>>): string[] {
  const out = new Set<string>();

  for (const n of nodes) {
    const t = n.data.nodeType;
    if (t === 'emit_event') {
      const pinned = n.data.pinDefaults?.name;
      const configured = n.data.effectConfig?.name;

      if (typeof pinned === 'string' && pinned.trim()) out.add(pinned.trim());
      if (typeof configured === 'string' && configured.trim()) out.add(configured.trim());
      continue;
    }

    if (t === 'on_event') {
      const configured = n.data.eventConfig?.name;
      if (typeof configured === 'string' && configured.trim()) out.add(configured.trim());
    }
  }

  return Array.from(out).sort((a, b) => a.localeCompare(b));
}

