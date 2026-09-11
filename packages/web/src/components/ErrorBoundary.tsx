import { Component, type ErrorInfo, type ReactNode } from 'react';
import './error-boundary.css';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/** Turns a non-Error thrown value into fallback text a reader can make sense of. `String()`
 *  alone renders a thrown object as "[object Object]"; JSON.stringify gives its shape instead. */
function describeNonError(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    const json = JSON.stringify(value);
    if (json !== undefined) return json;
  } catch {
    // circular or otherwise unserializable — fall through to String()
  }
  return String(value);
}

/** Catches a render throw anywhere in its children and swaps to a fallback panel instead of
 *  leaving the whole shell blank. Terminals live outside React (`terminals/registry.ts`), so
 *  the socket a live pane holds survives this boundary catching and unmounting its children;
 *  "Try again" remounts them, and the pane's attach effect reparents the still-live terminal. */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    if (error instanceof Error) return { error };
    return { error: new Error(describeNonError(error)) };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('garden render error', error, info.componentStack);
  }

  reset = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    const { error } = this.state;
    if (error === null) return this.props.children;

    return (
      <div className="error-boundary">
        <div className="error-boundary-body">
          <div className="eb-line1">Something went wrong</div>
          <div className="eb-line2">{error.message}</div>
          <button className="primary" onClick={this.reset}>
            Try again
          </button>
          <div className="eb-line3">
            If the console stays stuck after that, reload the page — any live session keeps running
            underneath and picks back up.
          </div>
        </div>
      </div>
    );
  }
}
