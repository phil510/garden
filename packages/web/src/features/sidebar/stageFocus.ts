/** The session currently focused on stage, or `null` when the focused slot is empty
 *  or out of range. */
export function focusedSessionId(
  slots: readonly (string | null)[],
  focusedSlot: number,
): string | null {
  return slots[focusedSlot] ?? null;
}
