/**
 * Join's delimiter (QA 2026-10-28): a choice of the usual ones, New line
 * among them, or any text typed. Stored as the pin default with escapes
 * (`\n` = new line, `\t` = tab), which AbstractRuntime's `string_join`
 * turns into the characters; nothing set = a comma (the runtime default).
 */
export const JOIN_DEFAULT_DELIMITER = ',';
export const JOIN_CUSTOM = 'custom';

export const JOIN_DELIMITER_CHOICES: ReadonlyArray<{ value: string; label: string }> = [
  { value: ',', label: 'Comma' },
  { value: ', ', label: 'Comma and space' },
  { value: '\\n', label: 'New line' },
  { value: '\\n\\n', label: 'Blank line' },
  { value: ' ', label: 'Space' },
  { value: '\\t', label: 'Tab' },
];

/** The choice a saved delimiter is (a real newline or tab counts as its escape), or "custom". */
export function joinDelimiterChoice(raw: unknown): string {
  if (raw === undefined || raw === null) return JOIN_DEFAULT_DELIMITER;
  if (typeof raw !== 'string') return JOIN_CUSTOM;
  const escaped = escapeDelimiter(raw);
  return JOIN_DELIMITER_CHOICES.some((c) => c.value === escaped) ? escaped : JOIN_CUSTOM;
}

/** A newline, tab or carriage return written as its escape, so it shows in one line. */
export function escapeDelimiter(raw: string): string {
  return raw.replace(/\r/g, '\\r').replace(/\n/g, '\\n').replace(/\t/g, '\\t');
}

/** The characters the runtime puts between items (its own rule: `\n`, `\t`, `\r` escapes). */
export function joinDelimiterText(raw: unknown): string {
  const text = raw === undefined || raw === null ? JOIN_DEFAULT_DELIMITER : String(raw);
  return text.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\r/g, '\r');
}
