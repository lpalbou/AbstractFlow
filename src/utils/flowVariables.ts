import type { Node } from 'reactflow';
import type { FlowNodeData, PinType } from '../types/flow';
import { isVarDeclPinType } from './pinTypeOptions';
import { setVariableRows } from './setVariables';

/**
 * The flow's variables, for the variable pickers (Get/Set Variable, Add to List, Get Variables):
 * every name a node declares, reads or writes, with the type a declaration gives it. Best effort:
 * people can still type a new name.
 */
export function flowVariableMeta(allNodes: Node<FlowNodeData>[]): {
  options: Array<{ value: string; label: string }>;
  declaredTypes: Map<string, Exclude<PinType, 'execution'>>;
} {
  const vars = new Set<string>();
  const declaredTypes = new Map<string, Exclude<PinType, 'execution'>>();

  for (const n of allNodes) {
    const d = n.data;
    if (!d) continue;

    // Get Variables rows name variables it reads (their types come from where they are set).
    if (d.nodeType === 'get_vars') {
      for (const p of d.outputs || []) if (p.type !== 'execution' && p.id) vars.add(p.id);
    }

    // On Flow Start parameters are initial vars.
    if (d.nodeType === 'on_flow_start') {
      for (const p of d.outputs || []) {
        if (p.type === 'execution') continue;
        const pid = typeof p.id === 'string' ? p.id.trim() : '';
        if (!pid) continue;
        vars.add(pid);
        // Prefer explicit declarations (var_decl/bool_var) over entrypoint pins.
        if (!declaredTypes.has(pid)) declaredTypes.set(pid, p.type as Exclude<PinType, 'execution'>);
      }
    }

    const ok = typeof d.outputKey === 'string' ? d.outputKey.trim() : '';
    if (ok) vars.add(ok);

    const ik = typeof d.inputKey === 'string' ? d.inputKey.trim() : '';
    if (ik) vars.add(ik);

    if ((d.nodeType === 'get_var' || d.nodeType === 'set_var') && typeof d.pinDefaults?.name === 'string') {
      const vn = d.pinDefaults.name.trim();
      if (vn) vars.add(vn);
    }
    if (d.nodeType === 'add_to_list' && typeof d.pinDefaults?.name === 'string') {
      const vn = d.pinDefaults.name.trim();
      if (vn) {
        vars.add(vn);
        if (!declaredTypes.has(vn)) declaredTypes.set(vn, 'array');
      }
    }

    // Set Variables rows declare their names and types (utils/setVariables.ts).
    if (d.nodeType === 'set_vars') {
      for (const pin of setVariableRows(d.inputs || [])) {
        vars.add(pin.id);
        if (!declaredTypes.has(pin.id) && pin.type !== 'any') declaredTypes.set(pin.id, pin.type as Exclude<PinType, 'execution'>);
      }
    }

    if (d.nodeType === 'bool_var') {
      const raw = d.literalValue;
      let vn = '';
      if (typeof raw === 'string') vn = raw.trim();
      else if (raw && typeof raw === 'object' && typeof (raw as any).name === 'string') vn = String((raw as any).name).trim();
      if (vn) {
        vars.add(vn);
        declaredTypes.set(vn, 'boolean');
      }
    }

    if (d.nodeType === 'var_decl') {
      const raw = d.literalValue;
      if (raw && typeof raw === 'object') {
        const vn = typeof (raw as any).name === 'string' ? String((raw as any).name).trim() : '';
        const t = typeof (raw as any).type === 'string' ? String((raw as any).type).trim() : '';
        const vt = isVarDeclPinType(t) ? t : 'any';
        if (vn) {
          vars.add(vn);
          declaredTypes.set(vn, vt);
        }
      }
    }
  }

  const options = Array.from(vars)
    .filter((v) => v.length > 0)
    .sort((a, b) => a.localeCompare(b))
    .map((v) => {
      const t = declaredTypes.get(v);
      return { value: v, label: t ? `${v} (${t})` : v };
    });

  return { options, declaredTypes };
}
