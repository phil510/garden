import { beforeEach, describe, expect, it } from 'vitest';
import { useToastStore } from './toastStore';

beforeEach(() => {
  useToastStore.setState({ message: null });
});

describe('toastStore', () => {
  it('starts with no toast', () => {
    expect(useToastStore.getState().message).toBeNull();
  });

  it('shows a toast with the given message', () => {
    useToastStore.getState().showToast('create failed: duplicate session');
    expect(useToastStore.getState().message).toBe('create failed: duplicate session');
  });

  it('replaces a shown toast with the latest one', () => {
    useToastStore.getState().showToast('first');
    useToastStore.getState().showToast('second');
    expect(useToastStore.getState().message).toBe('second');
  });

  it('clears a shown toast', () => {
    useToastStore.getState().showToast('create failed');
    useToastStore.getState().clearToast();
    expect(useToastStore.getState().message).toBeNull();
  });
});
