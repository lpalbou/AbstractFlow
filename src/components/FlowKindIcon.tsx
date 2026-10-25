import type { FlowKind } from '../utils/flowKinds';

/**
 * The kind of a flow as a small tile (Flow Library rows, headings, filters
 * and the detail pane): a speech bubble for chat, a clock for scheduled, a
 * bolt for triggered (the editor's automation bolt), four blocks for the
 * rest. The colour comes from the `flow-kind--<kind>` class (index.css).
 */
export function FlowKindGlyph({ kind }: { kind: FlowKind }) {
  return (
    <svg
      className="flow-kind-glyph"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {kind === 'chat' ? <path d="M20.5 11.5a8 8 0 0 1-11.7 7.1L4 19.8l1.2-4.4a8 8 0 1 1 15.3-3.9z" /> : null}
      {kind === 'scheduled' ? (
        <>
          <circle cx="12" cy="12" r="8.5" />
          <path d="M12 7.5V12l3 2" />
        </>
      ) : null}
      {kind === 'triggered' ? <path d="M13 2.5L5 13.2h6.2L10.4 21.5 18.5 10.8h-6.2z" /> : null}
      {kind === 'other' ? (
        <>
          <rect x="4" y="4" width="6.5" height="6.5" rx="1.6" />
          <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.6" />
          <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.6" />
          <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.6" />
        </>
      ) : null}
    </svg>
  );
}

export function FlowKindIcon({ kind, size = 'md', title }: { kind: FlowKind; size?: 'sm' | 'md' | 'lg'; title?: string }) {
  return (
    <span className={`flow-kind-icon flow-kind-icon--${size} flow-kind--${kind}`} title={title} aria-hidden={title ? undefined : true}>
      <FlowKindGlyph kind={kind} />
    </span>
  );
}
