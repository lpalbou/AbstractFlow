/**
 * Reads a person waits on are tried again before they are reported
 * (framework ADR-0039, "Loading states: a spinner until the data is in, an
 * error only once the read has failed").
 *
 * This is the ONE place Flow retries: `gatewayFetch` (utils/gatewayClient.ts)
 * runs every GET (and a POST it is told is a read) through `retryRead`, and
 * the sign-in probe (`fetchGatewayConnection`) does the same. Screens never
 * add their own retry or error-on-first-failure path around it, and React
 * Query's own retry is off (main.tsx) so the tries are not multiplied.
 *
 *   - 3 tries in all, 1 s then 3 s apart; the spinner stays up through them;
 *   - transient (tried again): a timeout, a lost or refused connection, a
 *     server error (5xx), 408 and 429;
 *   - final at once: any other 4xx (401, 403, 404, 422…), an unreadable
 *     answer, and a read the caller cancelled;
 *   - writes are never retried (a second POST could repeat its effect).
 */

export const READ_TRIES = 3;
export const READ_RETRY_DELAYS_MS: readonly number[] = [1_000, 3_000];

/** A request that did not answer within its timeout (each try of a read has its own). */
export class RequestTimeoutError extends Error {
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super(`The gateway did not answer within ${Math.round(timeoutMs / 1000)} s.`);
    this.name = 'RequestTimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

function statusOf(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null;
  const status = (error as { status?: unknown }).status;
  return typeof status === 'number' && Number.isFinite(status) ? status : null;
}

function isAbort(error: unknown): boolean {
  return Boolean(error) && typeof error === 'object' && (error as { name?: unknown }).name === 'AbortError';
}

/** Whether another try may meet a different answer (ADR-0039 rule 2). */
export function isTransientReadFailure(error: unknown): boolean {
  if (error instanceof RequestTimeoutError) return true;
  // The caller cancelled (the dialog closed, a newer read replaced it): final.
  if (isAbort(error)) return false;
  const status = statusOf(error);
  if (status !== null) return status >= 500 || status === 408 || status === 429;
  // fetch() rejects with a TypeError when the connection is lost or refused.
  return error instanceof TypeError;
}

export interface RetryReadOptions {
  /** The caller's cancel: a cancelled read is not tried again, a back-off ends at once. */
  signal?: AbortSignal | null;
  /** Tests only: the waits between tries (default 1 s, 3 s). */
  delaysMs?: readonly number[];
  /** Tests only: how a wait is made. */
  sleep?: (ms: number, signal?: AbortSignal | null) => Promise<void>;
}

function abortError(): Error {
  const error = new Error('The read was cancelled.');
  error.name = 'AbortError';
  return error;
}

export function sleepUnlessAborted(ms: number, signal?: AbortSignal | null): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** `attempt` up to 3 times while it fails transiently; the last failure is thrown as is. */
export async function retryRead<T>(attempt: (tryNumber: number) => Promise<T>, options: RetryReadOptions = {}): Promise<T> {
  const delays = options.delaysMs ?? READ_RETRY_DELAYS_MS;
  const sleep = options.sleep ?? sleepUnlessAborted;
  for (let tryNumber = 1; ; tryNumber += 1) {
    try {
      return await attempt(tryNumber);
    } catch (error) {
      if (tryNumber >= READ_TRIES || options.signal?.aborted || !isTransientReadFailure(error)) throw error;
      await sleep(delays[Math.min(tryNumber - 1, delays.length - 1)] ?? 0, options.signal);
    }
  }
}
