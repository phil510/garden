import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from './ErrorBoundary';

// No DOM renderer here (docs/testing.md puts mounting feature components out of scope, and
// this isn't one of its two named exceptions) — the class is exercised directly, the same way
// its static/instance methods are exercised at runtime by React itself.

function findByClassName(node: ReactNode, className: string): ReactElement | undefined {
  if (!isValidElement(node)) return undefined;
  const props = node.props as { className?: unknown; children?: ReactNode };
  if (props.className === className) return node;
  const children = props.children;
  if (Array.isArray(children)) {
    for (const child of children as ReactNode[]) {
      const found = findByClassName(child, className);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  return findByClassName(children ?? null, className);
}

describe('ErrorBoundary.getDerivedStateFromError', () => {
  it('stores a thrown Error as-is', () => {
    const error = new Error('boom');
    expect(ErrorBoundary.getDerivedStateFromError(error)).toEqual({ error });
  });

  it('wraps a non-Error thrown value into an Error', () => {
    const state = ErrorBoundary.getDerivedStateFromError('boom');
    expect(state.error).toBeInstanceOf(Error);
    expect(state.error?.message).toBe('boom');
  });

  it('wraps a thrown non-Error object into a legible message, not "[object Object]"', () => {
    const state = ErrorBoundary.getDerivedStateFromError({ code: 'ECONNRESET' });
    expect(state.error).toBeInstanceOf(Error);
    expect(state.error?.message).toBe('{"code":"ECONNRESET"}');
  });
});

describe('ErrorBoundary#componentDidCatch', () => {
  it('logs the error and component stack so a developer can see it', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const boundary = new ErrorBoundary({ children: null });
    const error = new Error('boom');

    boundary.componentDidCatch(error, { componentStack: 'in <Stage>' });

    expect(spy).toHaveBeenCalledWith('garden render error', error, 'in <Stage>');
    spy.mockRestore();
  });
});

describe('ErrorBoundary#render', () => {
  it('returns children unchanged when there is no error', () => {
    const children = 'the app shell';
    const boundary = new ErrorBoundary({ children });
    expect(boundary.render()).toBe(children);
  });

  it('returns a fallback surfacing the error message when there is an error', () => {
    const boundary = new ErrorBoundary({ children: null });
    boundary.state = { error: new Error('boom') };

    const fallback = boundary.render();
    const line = findByClassName(fallback, 'eb-line2');
    expect(line).toBeDefined();
    expect((line?.props as { children?: ReactNode }).children).toBe('boom');
  });

  it('wires the "Try again" button to the instance reset handler', () => {
    const boundary = new ErrorBoundary({ children: null });
    boundary.state = { error: new Error('boom') };

    const fallback = boundary.render();
    const button = findFallbackButton(fallback);
    expect(button).toBeDefined();
    expect((button?.props as { onClick?: unknown }).onClick).toBe(boundary.reset);
  });
});

function findFallbackButton(node: ReactNode): ReactElement | undefined {
  if (!isValidElement(node)) return undefined;
  if (node.type === 'button') return node;
  const children = (node.props as { children?: ReactNode }).children;
  if (Array.isArray(children)) {
    for (const child of children as ReactNode[]) {
      const found = findFallbackButton(child);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  return findFallbackButton(children ?? null);
}

describe('ErrorBoundary#reset', () => {
  it('clears the error via setState', () => {
    const boundary = new ErrorBoundary({ children: null });
    const spy = vi.spyOn(boundary, 'setState').mockImplementation(() => {});

    boundary.reset();

    expect(spy).toHaveBeenCalledWith({ error: null });
  });
});
