/**
 * Join's delimiter on the node (QA 2026-10-28): the usual ones by name (New
 * line among them) or any text typed, where `\n` is a new line and `\t` a
 * tab (utils/joinDelimiter.ts).
 */
import { useState } from 'react';
import { AfSelect } from '../inputs/AfSelect';
import { JOIN_CUSTOM, JOIN_DELIMITER_CHOICES, escapeDelimiter, joinDelimiterChoice } from '../../utils/joinDelimiter';

export function JoinDelimiterControl({ value, onChange }: { value: unknown; onChange: (next: string | undefined) => void }) {
  const choice = joinDelimiterChoice(value);
  const [typing, setTyping] = useState(choice === JOIN_CUSTOM);
  const custom = typing || choice === JOIN_CUSTOM;
  const text = typeof value === 'string' ? escapeDelimiter(value) : '';
  return (
    <>
      <AfSelect
        variant="pin"
        value={custom ? JOIN_CUSTOM : choice}
        placeholder="Comma"
        options={[...JOIN_DELIMITER_CHOICES, { value: JOIN_CUSTOM, label: 'Custom…' }]}
        searchable={false}
        minPopoverWidth={180}
        onChange={(v) => {
          if (v === JOIN_CUSTOM) {
            setTyping(true);
            return;
          }
          setTyping(false);
          onChange(v);
        }}
      />
      {custom ? (
        <input
          className="af-pin-input nodrag"
          type="text"
          value={text}
          placeholder="not set: a comma"
          aria-label="Delimiter (\n = new line, \t = tab)"
          title="\n = new line, \t = tab"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : null}
    </>
  );
}
