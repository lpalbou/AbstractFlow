// Framework ADR-0039: a read is tried 3 times (1 s, then 3 s apart) while it
// fails transiently, in ONE place (gatewayFetch); writes are sent once.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GatewayHttpError, gatewayFetch, gatewayJson } from './gatewayClient';
import { READ_RETRY_DELAYS_MS, RequestTimeoutError, isTransientReadFailure, retryRead } from './readRetry';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const http = (status: number) => new GatewayHttpError(`HTTP ${status}`, status, null);

function ladder(answers: Array<unknown>) {
  const sleeps: number[] = [];
  let calls = 0;
  const attempt = async () => {
    const answer = answers[Math.min(calls, answers.length - 1)];
    calls += 1;
    if (answer instanceof Error) throw answer;
    return answer;
  };
  const sleep = async (ms: number) => {
    sleeps.push(ms);
  };
  return { attempt, sleep, sleeps, calls: () => calls };
}

describe('retryRead: the ladder', () => {
  it('a 503 and a dropped connection, then an answer: 3 tries, 1 s then 3 s apart', async () => {
    const l = ladder([http(503), new TypeError('Failed to fetch'), { ok: 1 }]);
    await expect(retryRead(l.attempt, { sleep: l.sleep })).resolves.toEqual({ ok: 1 });
    expect(l.calls()).toBe(3);
    expect(l.sleeps).toEqual([1000, 3000]);
    expect(READ_RETRY_DELAYS_MS).toEqual([1000, 3000]);
  });

  it('three transient failures: the last one is thrown, after the third try only', async () => {
    const l = ladder([http(502), http(429), http(504)]);
    await expect(retryRead(l.attempt, { sleep: l.sleep })).rejects.toMatchObject({ status: 504 });
    expect(l.calls()).toBe(3);
  });

  it('a refusal (401, 403, 404, 422) or an unreadable answer is final at once', async () => {
    for (const status of [401, 403, 404, 422]) {
      const l = ladder([http(status), { ok: 1 }]);
      await expect(retryRead(l.attempt, { sleep: l.sleep })).rejects.toMatchObject({ status });
      expect(l.calls()).toBe(1);
    }
    const unreadable = ladder([new SyntaxError('Unexpected token <'), { ok: 1 }]);
    await expect(retryRead(unreadable.attempt, { sleep: unreadable.sleep })).rejects.toThrow(SyntaxError);
    expect(unreadable.calls()).toBe(1);
  });

  it('what counts as transient', () => {
    expect(isTransientReadFailure(new RequestTimeoutError(30_000))).toBe(true);
    expect(isTransientReadFailure(new TypeError('Failed to fetch'))).toBe(true);
    for (const status of [500, 502, 503, 504, 408, 429]) expect(isTransientReadFailure(http(status))).toBe(true);
    for (const status of [400, 401, 403, 404, 409, 422]) expect(isTransientReadFailure(http(status))).toBe(false);
    const abort = new Error('aborted');
    abort.name = 'AbortError';
    expect(isTransientReadFailure(abort)).toBe(false);
  });

  it('a read the caller cancelled is not tried again', async () => {
    const controller = new AbortController();
    const l = ladder([http(503), { ok: 1 }]);
    controller.abort();
    await expect(retryRead(l.attempt, { sleep: l.sleep, signal: controller.signal })).rejects.toMatchObject({ status: 503 });
    expect(l.calls()).toBe(1);
  });
});

describe('gatewayFetch: the one place reads are retried', () => {
  function stubFetch(statuses: Array<number | 'drop' | 'hang'>) {
    const calls: Array<{ url: string; method: string }> = [];
    vi.stubGlobal('document', { cookie: '' });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const step = statuses[Math.min(calls.length, statuses.length - 1)];
        calls.push({ url, method: String(init?.method || 'GET') });
        if (step === 'drop') throw new TypeError('Failed to fetch');
        if (step === 'hang') {
          return new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
              const error = new Error('The operation was aborted.');
              error.name = 'AbortError';
              reject(error);
            });
          });
        }
        return new Response(JSON.stringify({ step }), { status: step });
      })
    );
    return calls;
  }

  it('a GET that fails twice then answers resolves, with the spinner time of 1 s + 3 s', async () => {
    vi.useFakeTimers();
    const calls = stubFetch([503, 'drop', 200]);
    const out = gatewayJson<{ step: number }>('api/gateway/triggers/connections');
    await vi.advanceTimersByTimeAsync(999);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(3000);
    await expect(out).resolves.toEqual({ step: 200 });
    expect(calls.map((c) => c.url)).toEqual(Array(3).fill('api/gateway/triggers/connections'));
  });

  it('a GET that keeps failing is reported after the third try, with the gateway reason', async () => {
    vi.useFakeTimers();
    const calls = stubFetch([503]);
    const out = gatewayFetch('api/gateway/me/email');
    const settled = expect(out).rejects.toMatchObject({ status: 503 });
    await vi.advanceTimersByTimeAsync(4000);
    await settled;
    expect(calls).toHaveLength(3);
  });

  it('a try that does not answer in time times out and is tried again', async () => {
    vi.useFakeTimers();
    const calls = stubFetch(['hang', 200]);
    const out = gatewayFetch('api/gateway/triggers/connections', { timeoutMs: 45_000 });
    await vi.advanceTimersByTimeAsync(45_000);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1000);
    await expect(out).resolves.toBeInstanceOf(Response);
    expect(calls).toHaveLength(2);
  });

  it('a timeout on every try says so in words', async () => {
    vi.useFakeTimers();
    stubFetch(['hang']);
    const out = gatewayFetch('api/gateway/triggers/connections', { timeoutMs: 1000 });
    const settled = expect(out).rejects.toThrow('The gateway did not answer within 1 s.');
    await vi.advanceTimersByTimeAsync(1000 + 1000 + 1000 + 3000 + 1000);
    await settled;
  });

  it('a 404 is final at once; a write is sent once; a POST marked as a read is retried', async () => {
    let calls = stubFetch([404, 200]);
    await expect(gatewayFetch('api/gateway/nope')).rejects.toMatchObject({ status: 404 });
    expect(calls).toHaveLength(1);

    calls = stubFetch([503, 200]);
    await expect(gatewayFetch('api/gateway/automations', { method: 'POST', body: '{}' })).rejects.toMatchObject({ status: 503 });
    expect(calls).toHaveLength(1);

    vi.useFakeTimers();
    calls = stubFetch([503, 200]);
    const sample = gatewayFetch('api/gateway/triggers/sample', { method: 'POST', body: '{}', read: true });
    await vi.advanceTimersByTimeAsync(1000);
    await expect(sample).resolves.toBeInstanceOf(Response);
    expect(calls.map((c) => c.method)).toEqual(['POST', 'POST']);
  });

  it('the sign-in probe and the trigger sample go through the same ladder; React Query does not retry on top', async () => {
    const { readFileSync } = await import('node:fs');
    const modal = readFileSync(new URL('../components/GatewayConnectionModal.tsx', import.meta.url), 'utf8');
    expect(modal).toMatch(/export async function fetchGatewayConnection\(\)[^{]*\{\s*return retryRead\(/);
    const sample = readFileSync(new URL('./triggerSample.ts', import.meta.url), 'utf8');
    expect(sample).toContain("read: true, timeoutMs: TRIGGER_SAMPLE_TIMEOUT_MS");
    const main = readFileSync(new URL('../main.tsx', import.meta.url), 'utf8');
    expect(main).toContain('retry: false,');
    // No screen adds its own query retry.
    const { execSync } = await import('node:child_process');
    const own = execSync("grep -rlnE 'retry: [1-9]' src --include=*.ts --include=*.tsx || true", { cwd: new URL('../..', import.meta.url).pathname })
      .toString()
      .split('\n')
      .filter((path) => path && !path.endsWith('.test.ts') && !path.endsWith('.test.tsx'));
    expect(own).toEqual([]);
  });
});
