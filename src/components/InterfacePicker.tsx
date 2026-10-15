import { useState, type CSSProperties, type ReactNode } from 'react';
import { Icon } from '@abstractframework/ui-kit';
import { PinShape } from './pins/PinShape';
import { PIN_COLORS } from '../types/flow';
import { categoryColorVar, nodeColorSection } from '../utils/nodeCategoryColors';
import { nodeIconName } from '../utils/nodeIcons';
import {
  KNOWN_INTERFACES,
  knownInterface,
  normalizeInterfaces,
  type InterfaceClass,
  type InterfacePinSpec,
  type KnownInterface,
} from '../utils/flowFamilies';

const UNKNOWN_DESCRIPTION =
  'Not an interface this editor knows (no pins). It stays declared until you untick it.';

const CLASS_LABEL: Record<InterfaceClass, string> = {
  entrypoint: 'Entry point',
  contract: 'Contract',
  domain: 'Domain',
};

/** One boundary node as the canvas draws it: header, then its pins on the wired edge. */
type DiagramPin = InterfacePinSpec & { optional?: boolean };

function BoundaryNode({ type, label, side, pins }: { type: string; label: string; side: 'out' | 'in'; pins: DiagramPin[] }) {
  const hue = { '--node-hue': categoryColorVar(nodeColorSection(type, label)) } as CSSProperties;
  return (
    <div className={`contract-node contract-node--${side}`} style={hue}>
      <div className="contract-node-head">
        <Icon name={nodeIconName(type, label)} size={14} />
        <span>{label}</span>
      </div>
      <ul className="contract-node-pins">
        <li className="contract-pin contract-pin--exec">
          <span className="contract-pin-shape" style={{ color: PIN_COLORS.execution }}>
            <PinShape type="execution" size={10} />
          </span>
        </li>
        {pins.map((pin) => (
          <li
            key={pin.id}
            className={`contract-pin${pin.optional ? ' contract-pin--optional' : ''}`}
            title={[pin.optional ? `${pin.type} (optional)` : '', pin.description || ''].filter(Boolean).join(': ') || undefined}
          >
            <span className="contract-pin-shape" style={{ color: PIN_COLORS[pin.type] }}>
              <PinShape type={pin.type} size={10} filled />
            </span>
            <span className="contract-pin-label">{pin.label || pin.id}</span>
            {pin.optional ? <span className="contract-pin-optional">optional</span> : <span className="contract-pin-type">{pin.type}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** What an interface adds: On Flow Start's outputs (what hosts send) and On Flow End's inputs (what they read back). */
export function ContractDiagram({ iface }: { iface: KnownInterface }) {
  return (
    <div className="contract-diagram">
      <BoundaryNode
        type="on_flow_start"
        label="On Flow Start"
        side="out"
        pins={[...(iface.requiredStartPins || []), ...(iface.optionalStartPins || []).map((pin) => ({ ...pin, optional: true }))]}
      />
      <div className="contract-flow" aria-hidden="true">
        <span>your steps</span>
      </div>
      <BoundaryNode type="on_flow_end" label="On Flow End" side="in" pins={iface.requiredEndPins || []} />
    </div>
  );
}

/**
 * The interfaces a flow declares (domain interfaces only when already declared),
 * as a list and a details panel (operator 2026-10-11). The list is one line per
 * interface: a checkbox to declare it and the row to inspect it. The details
 * panel opens beside the list when an interface is ticked or inspected, with
 * its full description and the On Flow Start / On Flow End nodes drawn with
 * the pins it adds; it collapses back (on phones it covers the list, with a
 * back button). `leading` renders above the list (the New flow dialog puts its
 * title and description there); `pinNote` says when the pins reach the flow.
 */
export function InterfacePicker({
  value,
  onChange,
  title,
  pinNote,
  leading,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  title: ReactNode;
  pinNote: string;
  leading?: ReactNode;
}) {
  // Opened on the first declared interface: what the flow already follows is
  // shown, not hidden behind a click.
  const [inspectedId, setInspectedId] = useState<string | null>(() => normalizeInterfaces(value)[0] ?? null);
  // A declared id this editor does not know (one removed from the vocabulary)
  // is listed too, as itself: hiding it would leave a declaration nobody can
  // see or remove.
  const unknown: KnownInterface[] = normalizeInterfaces(value)
    .filter((id) => !knownInterface(id))
    .map((id) => ({ id, label: id, description: UNKNOWN_DESCRIPTION, class: 'domain' }));
  const options = [...KNOWN_INTERFACES.filter((iface) => iface.class !== 'domain' || value.includes(iface.id)), ...unknown];
  const selectedCount = normalizeInterfaces(value).length;
  const inspected = inspectedId ? options.find((iface) => iface.id === inspectedId) || null : null;
  const toggle = (id: string, on: boolean) => {
    const base = normalizeInterfaces(value);
    onChange(on ? (base.includes(id) ? base : [...base, id]) : base.filter((x) => x !== id));
  };
  return (
    <div className={`iface-picker${inspected ? ' has-detail' : ''}`}>
      <div className="iface-picker-main">
        {leading}
        <section className="iface-list-section" aria-labelledby="iface-list-title">
          <div className="iface-list-head">
            <div id="iface-list-title" className="iface-list-title">
              {title}
            </div>
            <span className="iface-list-count">{selectedCount ? `${selectedCount} selected` : 'none selected'}</span>
          </div>
          <p className="iface-list-hint">The contracts this workflow follows: the inputs it takes on On Flow Start and the outputs it gives on On Flow End.</p>
          <ul className="iface-list">
            {options.map((iface) => {
              const checked = value.includes(iface.id);
              const open = inspectedId === iface.id;
              return (
                <li key={iface.id} className={`iface-row${checked ? ' is-selected' : ''}${open ? ' is-open' : ''}`}>
                  <input
                    type="checkbox"
                    aria-label={`Declare ${iface.label}`}
                    checked={checked}
                    onChange={(e) => {
                      toggle(iface.id, e.target.checked);
                      if (e.target.checked) setInspectedId(iface.id);
                    }}
                  />
                  <button
                    type="button"
                    className="iface-row-main"
                    aria-expanded={open}
                    aria-controls="iface-detail"
                    onClick={() => setInspectedId(open ? null : iface.id)}
                  >
                    <span className="iface-row-name">{iface.label}</span>
                    <span className="iface-row-desc">{iface.description}</span>
                    <Icon name="chevronRight" size={14} className="iface-row-chevron" />
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      </div>
      {inspected ? (
        <aside id="iface-detail" className="iface-detail" aria-label={`${inspected.label} details`}>
          <div className="iface-detail-head">
            <button type="button" className="iface-detail-close" onClick={() => setInspectedId(null)} aria-label="Hide details">
              <Icon name="chevronRight" size={16} className="iface-detail-back-icon" />
              <Icon name="x" size={16} className="iface-detail-close-icon" />
            </button>
            <div className="iface-detail-title">
              <h4>{inspected.label}</h4>
              <span className="iface-detail-kind">{CLASS_LABEL[inspected.class]}</span>
            </div>
            <button
              type="button"
              className={`modal-button ${value.includes(inspected.id) ? 'cancel' : 'primary'}`}
              onClick={() => toggle(inspected.id, !value.includes(inspected.id))}
            >
              {value.includes(inspected.id) ? 'Remove' : 'Declare'}
            </button>
          </div>
          <p className="iface-detail-desc">{inspected.description}</p>
          {(inspected.requiredStartPins?.length || 0) + (inspected.requiredEndPins?.length || 0) + (inspected.optionalStartPins?.length || 0) > 0 ? (
            <>
              <div className="iface-detail-section">What the flow gets</div>
              <ContractDiagram iface={inspected} />
              <p className="iface-detail-note">{pinNote}</p>
            </>
          ) : null}
        </aside>
      ) : null}
    </div>
  );
}
