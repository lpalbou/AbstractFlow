import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TOAST_TOP_QUERY, toastPosition } from './toastPlacement';

describe('toastPlacement', () => {
  it('moves toasts to the top where dialogs are bottom sheets', () => {
    expect(TOAST_TOP_QUERY).toBe('(max-width: 767.98px), (max-height: 500px)');
    expect(toastPosition(true)).toBe('top-center');
    expect(toastPosition(false)).toBe('bottom-right');
  });

  it('the app Toaster uses it', () => {
    const main = readFileSync(resolve(__dirname, '..', 'main.tsx'), 'utf-8');
    expect(main).toMatch(/useAfMedia\(TOAST_TOP_QUERY\)/);
    expect(main).toMatch(/<ResponsiveToaster \/>/);
  });
});
