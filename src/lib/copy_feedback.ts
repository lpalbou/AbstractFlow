import toast from 'react-hot-toast';

import { clipboardWrite, COPY_FAILED } from './secure-context';

/** Copy text and say whether it worked: a success toast, or COPY_FAILED (plain http without a clipboard). */
export async function copyWithFeedback(text: string, copiedLabel = 'Copied'): Promise<boolean> {
  const ok = await clipboardWrite(text);
  if (ok) toast.success(copiedLabel);
  else toast.error(COPY_FAILED);
  return ok;
}

/** clipboardWrite for call sites that already handle a rejection with their own message. */
export async function clipboardWriteOrThrow(text: string): Promise<void> {
  if (!(await clipboardWrite(text))) throw new Error(COPY_FAILED);
}
