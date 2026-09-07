/** Whether a pane already tracked under a session id can be reused as-is, or must be rebuilt.
 *  The server tracks pane attaches independently of the event socket, so a pane held over from
 *  an earlier connection epoch has already lost its socket server-side — it is scrap, never
 *  trusted, regardless of what it looks like locally. */
export function shouldReusePane(existingEpoch: number, requestedEpoch: number): boolean {
  return existingEpoch === requestedEpoch;
}
