import { useEffect, useState } from 'react';
import type { ThemedToken } from 'shiki';
import { tokenizeText } from './highlighter';
import { tokenStyle } from './tokenStyle';

interface MarkdownCodeBlockProps {
  /** The fence's info string, e.g. `ts` from ```` ```ts ````. Undefined for a fence with no
   *  info string, which renders as plain preformatted text instead of tokenizing. */
  language: string | undefined;
  value: string;
}

/**
 * A fenced code block inside rendered markdown, tokenised through the same shiki path and
 * `.code-line`/`.lc`/`tokenStyle` shape `Viewer.tsx`'s source view uses, so highlighted code
 * inside markdown looks identical to opening the same file in source mode.
 */
export function MarkdownCodeBlock({ language, value }: MarkdownCodeBlockProps) {
  const [tokens, setTokens] = useState<ThemedToken[][] | null>(null);

  useEffect(() => {
    if (language === undefined) {
      setTokens(null);
      return;
    }
    let cancelled = false;
    tokenizeText(value, language)
      .then((result) => {
        if (!cancelled) setTokens(result);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [language, value]);

  if (tokens === null) {
    return (
      <pre className="fp-md-code">
        <code>{value}</code>
      </pre>
    );
  }

  return (
    <pre className="fp-md-code">
      <code>
        {tokens.map((line, index) => (
          <div className="code-line" key={index}>
            <span className="lc">
              {line.map((token, tokenIndex) => (
                <span key={tokenIndex} style={tokenStyle(token)}>
                  {token.content}
                </span>
              ))}
            </span>
          </div>
        ))}
      </code>
    </pre>
  );
}
