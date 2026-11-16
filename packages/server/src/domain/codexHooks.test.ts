import { describe, expect, it } from 'vitest';
import { codexHook, codexSignal } from './codexHooks.js';
const hook = {
  session_id: '01999999-aaaa-7777-bbbb-0123456789ab',
  cwd: '/repo',
  transcript_path: null,
  hook_event_name: 'SessionStart',
  source: 'startup',
};

describe('Codex hook translation', () => {
  it('does not overwrite a working turn when its first SessionStart arrives', () => {
    const start = codexSignal(hook, 'garden');
    expect(start.reported).toBeUndefined();
    expect(start.ended).toBe(false);
    expect(
      codexSignal({ ...hook, hook_event_name: 'UserPromptSubmit' }, 'garden').reported?.status,
    ).toBe('working');
  });
  it('distinguishes approvals, stopped turns, and ended processes', () => {
    expect(
      codexSignal({ ...hook, hook_event_name: 'PermissionRequest' }, 'garden').reported?.status,
    ).toBe('needs-approval');
    expect(codexSignal({ ...hook, hook_event_name: 'Interrupt' }, 'garden').reported?.status).toBe(
      'waiting',
    );
    expect(codexSignal({ ...hook, hook_event_name: 'SessionEnd' }, 'garden').ended).toBe(true);
  });
  it('accepts nullable native paths and rejects malformed native ids and ordering metadata', () => {
    expect(codexHook(hook)).toEqual(hook);
    expect(codexHook({ ...hook, session_id: '--flag' })).toBeNull();
    expect(codexHook({ ...hook, _garden_order: '-1' })).toBeNull();
    expect(codexHook({ ...hook, transcript_path: 23 })).toBeNull();
  });
});
