import { beforeEach, describe, expect, it } from 'vitest';
import type { VisualFlow } from '../types/flow';
import { useFlowStore } from './useFlow';
import { interfacesFromPutResponse, updateOpenFlowMetadata } from './openFlowMetadata';

// Toolbar's interface/name handlers PUT to the gateway, then update the open
// document. The PUT is async: these tests switch documents WHILE it is in
// flight and prove the answer never lands in another document.

function flow(id: string, interfaces: string[] = []): VisualFlow {
  return {
    id,
    name: `Flow ${id}`,
    interfaces,
    nodes: [
      {
        id: 'start',
        type: 'on_flow_start',
        position: { x: 0, y: 0 },
        data: {
          nodeType: 'on_flow_start',
          label: 'On Flow Start',
          icon: '',
          headerColor: '',
          inputs: [],
          outputs: [{ id: 'exec-out', label: '', type: 'execution' }],
        },
      },
      {
        id: 'end',
        type: 'on_flow_end',
        position: { x: 400, y: 0 },
        data: {
          nodeType: 'on_flow_end',
          label: 'On Flow End',
          icon: '',
          headerColor: '',
          inputs: [{ id: 'exec-in', label: '', type: 'execution' }],
          outputs: [],
        },
      },
    ],
    edges: [],
  } as VisualFlow;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const endInputs = () =>
  (useFlowStore.getState().nodes.find((n) => n.id === 'end')?.data.inputs || []).map((p) => p.id);

describe('updateOpenFlowMetadata', () => {
  beforeEach(() => useFlowStore.getState().clearFlow());

  it('applies the PUT answer to the flow that is still open (pins + clean baseline)', async () => {
    useFlowStore.getState().loadFlow(flow('A'));
    const put = deferred<VisualFlow>();
    const pending = updateOpenFlowMetadata({
      id: 'A',
      hasUnsavedChanges: false,
      request: () => put.promise,
      patchFrom: (updated) => ({ interfaces: interfacesFromPutResponse(updated) }),
    });
    put.resolve({ ...flow('A'), interfaces: ['abstractcode.agent.v1'] });
    const result = await pending;
    expect(result.applied).toBe(true);
    expect(useFlowStore.getState().flowInterfaces).toEqual(['abstractcode.agent.v1']);
    expect(endInputs()).toEqual(['exec-in', 'response', 'success', 'meta']);
    // Baseline = what the gateway now holds: pre-request document + interfaces, WITHOUT the pins.
    expect(result.baseline?.interfaces).toEqual(['abstractcode.agent.v1']);
    expect(result.baseline?.nodes.find((n) => n.id === 'end')?.data.inputs.map((p) => p.id)).toEqual(['exec-in']);
  });

  it('opening ANOTHER flow while the PUT is in flight: the answer never touches it', async () => {
    useFlowStore.getState().loadFlow(flow('A'));
    const put = deferred<VisualFlow>();
    const pending = updateOpenFlowMetadata({
      id: 'A',
      hasUnsavedChanges: false,
      request: () => put.promise,
      patchFrom: (updated) => ({ interfaces: interfacesFromPutResponse(updated), name: updated.name }),
    });
    useFlowStore.getState().loadFlow(flow('B')); // user switches documents mid-request
    put.resolve({ ...flow('A'), name: 'Renamed A', interfaces: ['abstractcode.agent.v1'] });
    const result = await pending;

    expect(result.applied).toBe(false);
    expect(result.baseline).toBeNull();
    const s = useFlowStore.getState();
    expect(s.flowId).toBe('B');
    expect(s.flowName).toBe('Flow B');
    expect(s.flowInterfaces).toEqual([]);
    expect(endInputs()).toEqual(['exec-in']);
    expect(s.past).toEqual([]);
  });

  it('re-opening the SAME flow mid-request is a different document instance: not applied', async () => {
    useFlowStore.getState().loadFlow(flow('A'));
    const put = deferred<VisualFlow>();
    const pending = updateOpenFlowMetadata({
      id: 'A',
      hasUnsavedChanges: true,
      request: () => put.promise,
      patchFrom: (updated) => ({ name: updated.name }),
    });
    useFlowStore.getState().loadFlow(flow('A'));
    put.resolve({ ...flow('A'), name: 'Late name' });
    expect((await pending).applied).toBe(false);
    expect(useFlowStore.getState().flowName).toBe('Flow A');
  });

  it('a flow that was not open is never applied; a malformed interfaces answer fails loudly', async () => {
    useFlowStore.getState().loadFlow(flow('B'));
    const other = await updateOpenFlowMetadata({
      id: 'A',
      hasUnsavedChanges: false,
      request: async () => ({ ...flow('A'), interfaces: ['abstractcode.agent.v1'] }),
      patchFrom: (updated) => ({ interfaces: interfacesFromPutResponse(updated) }),
    });
    expect(other.applied).toBe(false);
    expect(useFlowStore.getState().flowInterfaces).toEqual([]);

    await expect(
      updateOpenFlowMetadata({
        id: 'B',
        hasUnsavedChanges: false,
        request: async () => ({ ...flow('B'), interfaces: undefined }),
        patchFrom: (updated) => ({ interfaces: interfacesFromPutResponse(updated) }),
      })
    ).rejects.toThrow(/without an interfaces list/);
    expect(useFlowStore.getState().flowInterfaces).toEqual([]);
  });
});
