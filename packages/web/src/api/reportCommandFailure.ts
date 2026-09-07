/**
 * A command the user issued did not reach the server. The console renders degraded state
 * rather than error dialogs, so a rejected command is logged and the UI stays on the state the
 * server last broadcast — the click simply had no effect.
 */
export function reportCommandFailure(error: unknown): void {
  console.error('garden command failed', error);
}
