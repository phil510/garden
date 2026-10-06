import { memo } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { MarkdownCodeBlock } from './MarkdownCodeBlock';

/** Every link renders as inert text — the viewer has no route to resolve a relative link's
 *  target, and the brief scopes navigation and absolute-vs-relative treatment out alike. */
const MarkdownLink: NonNullable<Components['a']> = ({ children }) => (
  <span className="fp-md-link">{children}</span>
);

/** Images never fetch — same reasoning as links, plus no appetite for a markdown file to
 *  reach out to an arbitrary URL from inside the console. */
const MarkdownImage: NonNullable<Components['img']> = ({ alt }) => (
  <span className="fp-md-image">{alt || 'image'}</span>
);

/** Overrides `pre` rather than `code` so a fenced block (wrapped in `pre`) and an inline code
 *  span (bare `code`, never reaching this component) are told apart structurally instead of by
 *  guessing from a `language-*` class that a fence without an info string never gets. Reads the
 *  fence's language and text straight off the raw hast node rather than `props.children`, since
 *  `children` here is already-rendered output from the default (unoverridden) `code` element. */
const MarkdownPre: NonNullable<Components['pre']> = ({ node }) => {
  let language: string | undefined;
  let value = '';
  for (const child of node?.children ?? []) {
    if (child.type !== 'element' || child.tagName !== 'code') continue;
    const classNameProp = child.properties?.className;
    const classNames = Array.isArray(classNameProp) ? classNameProp.map(String) : [];
    language = classNames.find((name) => name.startsWith('language-'))?.slice('language-'.length);
    value = child.children
      .map((grandchild) => (grandchild.type === 'text' ? grandchild.value : ''))
      .join('')
      .replace(/\n$/, '');
  }
  return <MarkdownCodeBlock language={language} value={value} />;
};

const markdownComponents: Components = {
  pre: MarkdownPre,
  a: MarkdownLink,
  img: MarkdownImage,
};

const remarkPlugins = [remarkGfm];

/** The parse is the expensive part of the viewer, and the viewer re-renders on every `ui-state`
 *  echo. `text` is the only prop, so memo's shallow compare is the whole cache — a callback or
 *  object prop would defeat it. */
export const MarkdownBody = memo(function MarkdownBody({ text }: { text: string }) {
  return (
    <div className="fp-markdown">
      <ReactMarkdown remarkPlugins={remarkPlugins} components={markdownComponents}>
        {text}
      </ReactMarkdown>
    </div>
  );
});
