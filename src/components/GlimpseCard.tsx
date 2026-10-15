import type { CSSProperties } from 'react';
import type { Glimpse } from '../utils/execGlimpse';
import { parseTemplate, slotKind } from '../utils/textTemplate';

/**
 * The hover card of the canvas (utils/execGlimpse.ts): what a node, a wire badge or a Loop Limit
 * does, in a glimpse. One look for all of them (operator 2026-10-15).
 */
export function GlimpseCard({
  glimpse,
  hue,
  placement = 'below',
  chips,
}: {
  glimpse: Glimpse;
  /** The card's colour (a CSS colour or var()). */
  hue?: string;
  placement?: 'below' | 'below-centred';
  /** For a String Template's text: which names are inputs and which are variables (chips). */
  chips?: { inputs: ReadonlySet<string>; variables: ReadonlySet<string> };
}) {
  const value = (row: { value: string; kind: string }) => {
    if (row.kind === 'variable') return <span className="tpl-chip tpl-chip--variable">{row.value}</span>;
    if (row.kind === 'expression') return <code className="exec-glimpse-code">{row.value}</code>;
    return row.value;
  };
  return (
    <div className={`exec-glimpse exec-glimpse--${placement}`} role="tooltip" style={hue ? ({ '--exec-header-color': hue } as CSSProperties) : undefined}>
      <div className="exec-glimpse-head">
        <span className="exec-glimpse-title">{glimpse.title}</span>
        {glimpse.subtitle ? <span className="exec-glimpse-type">{glimpse.subtitle}</span> : null}
      </div>
      {glimpse.sections.map((section) => (
        <div key={section.title} className="exec-glimpse-section">
          <div className="exec-glimpse-section-title">{section.title}</div>
          <dl className="exec-glimpse-rows">
            {section.rows.map((row) => (
              <div key={`${section.title}:${row.label}`} className={`exec-glimpse-row is-${row.kind}`}>
                <dt>{row.label}</dt>
                <dd>{value(row)}</dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
      {glimpse.text ? (
        <div className="exec-glimpse-section">
          <div className="exec-glimpse-section-title">{glimpse.text.label}</div>
          <div className="exec-glimpse-text">
            {chips
              ? parseTemplate(glimpse.text.value).map((seg, i) =>
                  seg.kind === 'text' ? <span key={i}>{seg.text}</span> : <span key={i} className={`tpl-chip tpl-chip--${slotKind(seg.name, chips.inputs, chips.variables)}`}>{seg.name}</span>
                )
              : glimpse.text.value}
          </div>
        </div>
      ) : null}
    </div>
  );
}
