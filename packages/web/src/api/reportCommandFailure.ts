import { ApiError } from './client.js';

/**
 * A command the user issued did not reach the server. The console renders degraded state
 * rather than error dialogs, so a rejected command is logged and the UI stays on the state the
 * server last broadcast — the click simply had no effect.
 */
export function reportCommandFailure(error: unknown): void {
  console.error('garden command failed', error);
}

const GENERIC_COMMAND_FAILURE_MESSAGE = 'Something went wrong. Please try again.';

/** The user-facing text for a failed command: the server's own error message when the
 *  failure reached it (an `ApiError`), a generic fallback otherwise (a network failure, for
 *  instance, carries no server text to show). */
export function commandFailureMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : GENERIC_COMMAND_FAILURE_MESSAGE;
}
