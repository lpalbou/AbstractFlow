import { useState } from 'react';
import { clsx } from 'clsx';
import type { JsonValue } from '../../types/flow';
import { type LiteralKind, LITERAL_KIND_LABEL, literalText, parseLiteralText } from '../../utils/pinLiterals';

/**
 * The box a value is typed in on an unwired input whose type the graph
 * decides (root ADR 0049, utils/pinLiterals.ts): what is typed is parsed as
 * `kind` and committed as that JSON type; text that is not a value of the
 * kind is committed as typed and the card flags it (`problem`). The text
 * being typed is kept while the box has focus, so "-" or "1." on the way to
 * "-1.5" is not rewritten under the cursor. Empty text is no value.
 */
export function TypedLiteralInput({
  value,
  kind,
  problem,
  ariaLabel,
  onCommit,
}: {
  value: JsonValue | undefined;
  kind: LiteralKind;
  problem: string | null;
  ariaLabel: string;
  onCommit: (value: JsonValue | undefined) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const invalid = draft === null && Boolean(problem);
  return (
    <input
      className={clsx('af-pin-input nodrag', invalid && 'af-pin-input--invalid')}
      type="text"
      inputMode={kind === 'number' ? 'decimal' : undefined}
      aria-label={ariaLabel}
      aria-invalid={invalid || undefined}
      title={invalid ? problem || undefined : undefined}
      value={draft ?? literalText(value)}
      placeholder=""
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onFocus={() => setDraft(literalText(value))}
      onBlur={() => setDraft(null)}
      onChange={(e) => {
        const text = e.target.value;
        setDraft(text);
        if (text === '') {
          onCommit(undefined);
          return;
        }
        const parsed = parseLiteralText(text, kind);
        // Text that is not a value of the kind is kept as typed: the card says why it is wrong.
        onCommit(parsed.ok ? parsed.value : text);
      }}
    />
  );
}

/** The small tag beside a typed box that says what the typed value is. */
export function LiteralKindTag({ kind, title, invalid }: { kind: LiteralKind; title: string; invalid?: boolean }) {
  return (
    <span className={clsx('af-pin-type-tag', invalid && 'af-pin-type-tag--invalid')} data-kind={kind} title={title}>
      {LITERAL_KIND_LABEL[kind]}
    </span>
  );
}
