import { afterEach, describe, expect, it, vi } from 'vitest';

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('react-hot-toast', () => ({ default: toastMock }));

import { makeGatewayRequestId } from '../utils/gatewayClient';
import { copyWithFeedback } from './copy_feedback';
import { COPY_FAILED, MEDIA_NEEDS_HTTPS, mediaAvailable } from './secure-context';

// Plain http from another machine (LAN, Tailscale) is not a secure context:
// the browser withholds crypto.randomUUID, navigator.clipboard and
// getUserMedia. These tests run the id and copy paths with those removed.

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const realCrypto = globalThis.crypto;

afterEach(() => {
  Object.defineProperty(globalThis, 'crypto', { value: realCrypto, configurable: true, writable: true });
  vi.unstubAllGlobals();
  toastMock.success.mockClear();
  toastMock.error.mockClear();
});

describe('non-secure context (plain http)', () => {
  it('request ids are distinct v4 UUIDs without crypto.randomUUID', () => {
    Object.defineProperty(globalThis, 'crypto', {
      value: { getRandomValues: (a: Uint8Array) => realCrypto.getRandomValues(a) },
      configurable: true,
      writable: true,
    });
    expect((globalThis.crypto as { randomUUID?: unknown }).randomUUID).toBeUndefined();
    const ids = Array.from({ length: 10000 }, () => makeGatewayRequestId());
    expect(ids.every((x) => V4.test(x))).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('copyWithFeedback falls back to execCommand and says whether it worked', async () => {
    const textarea = { value: '', style: {}, setAttribute() {}, select() {}, setSelectionRange() {} };
    const execCommand = vi.fn(() => true);
    vi.stubGlobal('navigator', {});
    vi.stubGlobal('document', { body: { appendChild() {}, removeChild() {} }, activeElement: null, createElement: () => textarea, execCommand });
    expect(await copyWithFeedback('run-1', 'Run id copied')).toBe(true);
    expect(textarea.value).toBe('run-1');
    expect(toastMock.success).toHaveBeenCalledWith('Run id copied');
    execCommand.mockReturnValue(false);
    expect(await copyWithFeedback('run-1')).toBe(false);
    expect(toastMock.error).toHaveBeenCalledWith(COPY_FAILED);
  });

  it('mediaAvailable is false without getUserMedia and the sentence names the fix', () => {
    vi.stubGlobal('navigator', {});
    expect(mediaAvailable()).toBe(false);
    expect(MEDIA_NEEDS_HTTPS).toContain('https address');
  });
});
