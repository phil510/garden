import type { OkResponse, SettingsRequest, SettingsResponse } from '@garden/shared';
import { commandFailureMessage, reportCommandFailure } from '../../api/reportCommandFailure';
import { useToastStore } from '../../state/toastStore';

interface SettingsApi {
  update: (request: SettingsRequest) => Promise<OkResponse>;
  reread: () => Promise<SettingsResponse>;
}

/** Resolves to the settings the caller should show, or `null` when there is nothing to apply.
 *
 *  No optimistic update: the server is the writer, so the input is reset from a fresh re-read
 *  rather than trusting the value just typed to have stuck. The re-read's failure is handled
 *  separately from the write's: a failed PUT means the save failed, but a PUT that succeeds
 *  followed by a GET that fails is a stale display, not a failed save, and must not tell the
 *  user their change didn't land when it did. */
export async function saveSettings(
  request: SettingsRequest,
  { update, reread }: SettingsApi,
): Promise<SettingsResponse | null> {
  try {
    await update(request);
  } catch (error: unknown) {
    reportCommandFailure(error);
    useToastStore.getState().showToast(commandFailureMessage(error), 'error');
    return null;
  }
  useToastStore.getState().showToast('Settings saved', 'success');
  try {
    return await reread();
  } catch (error: unknown) {
    reportCommandFailure(error);
    return null;
  }
}
