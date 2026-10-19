import type { SettingsResponse } from '@garden/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/client';
import { useToastStore } from '../../state/toastStore';
import { saveSettings } from './saveSettings';

const request = {
  claudeCommand: 'claude',
  ignoreAuthors: [],
  quietWindowMinutes: 3,
  pollIntervalMinutes: 5,
};
const reread: SettingsResponse = { deadSessionCap: 10, ...request };

beforeEach(() => {
  useToastStore.setState({ message: null, kind: 'error', token: 0 });
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('saveSettings', () => {
  it('confirms the save and resolves the re-read settings', async () => {
    const result = await saveSettings(request, {
      update: () => Promise.resolve({ ok: true }),
      reread: () => Promise.resolve(reread),
    });
    expect(result).toBe(reread);
    expect(useToastStore.getState()).toMatchObject({ message: 'Settings saved', kind: 'success' });
  });

  it('shows the failure as an error toast when the write is rejected', async () => {
    const result = await saveSettings(request, {
      update: () => Promise.reject(new ApiError('quietWindowMinutes must be positive', 400)),
      reread: () => Promise.resolve(reread),
    });
    expect(result).toBeNull();
    expect(useToastStore.getState()).toMatchObject({
      message: 'quietWindowMinutes must be positive',
      kind: 'error',
    });
  });

  it('still reports a saved change when only the re-read fails', async () => {
    const result = await saveSettings(request, {
      update: () => Promise.resolve({ ok: true }),
      reread: () => Promise.reject(new Error('network down')),
    });
    expect(result).toBeNull();
    expect(useToastStore.getState()).toMatchObject({ message: 'Settings saved', kind: 'success' });
  });
});
