import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ToastView } from './Toast';

function render(kind: 'success' | 'error', message: string | null) {
  return renderToStaticMarkup(
    createElement(ToastView, { message, kind, onDismiss: () => undefined }),
  );
}

describe('ToastView', () => {
  it('shows an error toast inside a polite status region', () => {
    const html = render('error', 'create failed');
    expect(html).toMatch(/^<div class="toast-region" role="status" aria-live="polite">/);
    expect(html).toContain('class="toast toast-error"');
    expect(html).toContain('create failed');
  });

  it('shows a success toast inside the same region', () => {
    const html = render('success', 'Settings saved');
    expect(html).toMatch(/^<div class="toast-region" role="status" aria-live="polite">/);
    expect(html).toContain('class="toast toast-success"');
    expect(html).toContain('Settings saved');
  });

  it('keeps the empty region in the DOM so a later toast is announced', () => {
    expect(render('error', null)).toBe(
      '<div class="toast-region" role="status" aria-live="polite"></div>',
    );
  });
});
