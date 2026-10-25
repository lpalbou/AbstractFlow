/**
 * What a list shows while its read is out, and once it has failed (framework
 * ADR-0039): a spinner and an animated "Loading…" where the list will be,
 * never an empty state; an error with the reason and a Retry only after every
 * try failed (the tries happen in gatewayFetch, utils/readRetry.ts).
 */
import type { ReactNode } from 'react';

/** A spinner and "<text>…" with animated dots, in the place of the content. */
export function LoadingLine({ text = 'Loading', className = '', inline = false }: { text?: string; className?: string; inline?: boolean }) {
  const Tag = inline ? 'span' : 'div';
  return (
    <Tag className={`read-loading${inline ? ' read-loading--inline' : ''}${className ? ` ${className}` : ''}`} role="status" aria-live="polite">
      <span className="read-loading__spinner" aria-hidden="true" />
      <span className="read-loading__text">
        {text}
        <span className="read-loading__dots" aria-hidden="true" />
        <span className="read-loading__sr">…</span>
      </span>
    </Tag>
  );
}

/** A read that failed after every try: what could not be read, why, and Retry. */
export function ReadFailed({
  children,
  onRetry,
  retryLabel = 'Retry',
  className = '',
}: {
  children: ReactNode;
  onRetry?: () => void;
  retryLabel?: string;
  className?: string;
}) {
  return (
    <div className={`read-failed${className ? ` ${className}` : ''}`} role="alert">
      <span className="read-failed__text">{children}</span>
      {onRetry ? (
        <button type="button" className="read-failed__retry" onClick={onRetry}>
          {retryLabel}
        </button>
      ) : null}
    </div>
  );
}
