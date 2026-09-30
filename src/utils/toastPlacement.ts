/**
 * Where toasts go. Below 768 px wide or 500 px tall dialogs are bottom sheets
 * with their primary action at the bottom; a bottom toast covered it
 * ("Signed in" over the library's Load, "Workflow failed" over the run
 * footer), so toasts move to the top there. Desktop keeps bottom-right.
 */
export const TOAST_TOP_QUERY = '(max-width: 767.98px), (max-height: 500px)';

export function toastPosition(matchesTopQuery: boolean): 'top-center' | 'bottom-right' {
  return matchesTopQuery ? 'top-center' : 'bottom-right';
}
