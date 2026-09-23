import { beforeEach, describe, expect, it } from 'vitest';
import { useToastStore } from './toastStore';

beforeEach(() => {
  useToastStore.setState({ message: null, token: 0 });
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

  it('bumps the token on a repeat of the same message, so a consumer keyed on it can tell two calls apart', () => {
    useToastStore.getState().showToast('create failed');
    const firstToken = useToastStore.getState().token;
    useToastStore.getState().showToast('create failed');
    expect(useToastStore.getState().token).toBe(firstToken + 1);
  });
});
