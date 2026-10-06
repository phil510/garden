// @vitest-environment happy-dom
import { createElement, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MarkdownBody } from './MarkdownBody';

// A render-cost contract: the viewer re-renders on every `ui-state` echo, and the parse behind
// `ReactMarkdown` is the expensive part. The parser is mocked so each call is countable.
const parsed = vi.hoisted(() => ({ calls: [] as unknown[] }));

vi.mock('react-markdown', () => ({
  default: ({ children }: { children: unknown }) => {
    parsed.calls.push(children);
    return null;
  },
}));
vi.mock('./MarkdownCodeBlock', () => ({ MarkdownCodeBlock: () => null }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('MarkdownBody', () => {
  let container: HTMLElement;
  let root: Root;

  const render = (text: string) =>
    act(() => {
      root.render(createElement(MarkdownBody, { text }));
    });

  beforeEach(() => {
    parsed.calls = [];
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('does not parse again when re-rendered with the same text', () => {
    render('# hello');
    render('# hello');
    expect(parsed.calls).toEqual(['# hello']);
  });

  it('parses once more, with the new text, when the text changes', () => {
    render('# hello');
    render('# changed');
    expect(parsed.calls).toEqual(['# hello', '# changed']);
  });
});
