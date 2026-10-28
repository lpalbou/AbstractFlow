/**
 * A node's help in a dialog (QA 2026-10-28: real help, not one-line
 * tooltips or prose on the canvas): what it is for, how it behaves, each
 * input and output, examples. The words come from utils/nodeHelp.ts; the
 * dialog is the kit's AfModal.
 */
import { AfModal } from '@abstractframework/ui-kit';
import type { FlowNodeData } from '../types/flow';
import { nodeHelp, type PinHelp } from '../utils/nodeHelp';

function PinList({ title, pins }: { title: string; pins: PinHelp[] }) {
  if (!pins.length) return null;
  return (
    <section className="node-help-section" data-help-section={title.toLowerCase()}>
      <h4>{title}</h4>
      <dl className="node-help-pins">
        {pins.map((p) => (
          <div key={p.id} className="node-help-pin" data-help-pin={p.id}>
            <dt>
              <span className="node-help-pin-name">{p.label}</span>
              <span className="node-help-pin-type">{p.type}</span>
            </dt>
            <dd>{p.text}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function NodeHelpBody({ data }: { data: Pick<FlowNodeData, 'nodeType' | 'label' | 'inputs' | 'outputs'> }) {
  const help = nodeHelp(data);
  return (
    <div className="node-help">
      <p className="node-help-purpose">{help.purpose}</p>
      {help.details.length ? (
        <ul className="node-help-details">
          {help.details.map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
      ) : null}
      <PinList title="Inputs" pins={help.inputs} />
      <PinList title="Outputs" pins={help.outputs} />
      {help.examples.length ? (
        <section className="node-help-section" data-help-section="examples">
          <h4>Examples</h4>
          <ul className="node-help-examples">
            {help.examples.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

export function NodeHelpModal({
  open,
  onClose,
  data,
}: {
  open: boolean;
  onClose: () => void;
  data: Pick<FlowNodeData, 'nodeType' | 'label' | 'inputs' | 'outputs'>;
}) {
  return (
    <AfModal open={open} onClose={onClose} title={`${nodeHelp(data).title}: help`} size="narrow" className="node-help-modal">
      <NodeHelpBody data={data} />
    </AfModal>
  );
}
