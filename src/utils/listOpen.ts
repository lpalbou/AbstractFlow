/**
 * Collapsible list panels (DESIGN §12, "Space on phones and tablets").
 *
 * A list that sits above its detail on a phone or tablet (the flow library's
 * list above the preview, the run window's steps above the step details) has
 * a disclosure header. The list is open by default; the viewer's choice is
 * remembered per list in localStorage. Every storage access is inside
 * try/catch: a private window or blocked storage keeps the default and never
 * throws.
 */
import { useCallback, useState } from 'react';

/**
 * When the flow library stacks its list above the preview (space.css uses the
 * same query): phones, and tablets below 1024 px — but not phone landscape
 * (>= 768 px wide, <= 500 px tall), where list | preview both get >= 360 px.
 */
export const LIBRARY_STACKED_QUERY = '(max-width: 767.98px), (max-width: 1023.98px) and (min-height: 500.02px)';

/** The lists that can collapse, and their storage keys (own `abstractflow_` prefix: one origin under the gateway). */
export const LIST_OPEN_KEYS = {
  library: 'abstractflow_list_open_library',
  runSteps: 'abstractflow_list_open_run_steps',
} as const;

export type CollapsibleList = keyof typeof LIST_OPEN_KEYS;

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

function defaultStorage(): StorageLike | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** The remembered state of `list`: open unless the viewer closed it. */
export function readListOpen(list: CollapsibleList, storage: StorageLike | null = defaultStorage()): boolean {
  try {
    return storage?.getItem(LIST_OPEN_KEYS[list]) !== '0';
  } catch {
    return true;
  }
}

/** Remembers the state of `list`; a storage failure keeps it for this page view only. */
export function writeListOpen(list: CollapsibleList, open: boolean, storage: StorageLike | null = defaultStorage()): void {
  try {
    storage?.setItem(LIST_OPEN_KEYS[list], open ? '1' : '0');
  } catch {
    // Blocked or full storage: in-memory only.
  }
}

/** One list's open state, remembered per viewer. */
export function useListOpen(list: CollapsibleList): [boolean, () => void] {
  const [open, setOpen] = useState(() => readListOpen(list));
  const toggle = useCallback(() => {
    setOpen((cur) => {
      const next = !cur;
      writeListOpen(list, next);
      return next;
    });
  }, [list]);
  return [open, toggle];
}
