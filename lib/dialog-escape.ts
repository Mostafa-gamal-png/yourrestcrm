/**
 * Radix dismisses a dialog on Escape during the capture phase, before a nested widget's own
 * key handler runs. When Escape is pressed inside a combobox whose list is open, that key press
 * belongs to the list: the dialog (and any unsaved form in it) must stay open.
 */
export function escapeBelongsToOpenPopup(event: Pick<KeyboardEvent, 'target'>): boolean {
  const target = event.target as {closest?: (selector: string) => unknown} | null;
  return typeof target?.closest === 'function' && !!target.closest('[role="combobox"][aria-expanded="true"]');
}
