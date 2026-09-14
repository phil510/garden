import { languageGuess } from './language';

/** Whether `path` should open in the viewer's rendered-prose markdown path rather than the
 *  plain shiki source path. */
export function isMarkdownFile(path: string): boolean {
  const lang = languageGuess(path);
  return lang === 'md' || lang === 'markdown';
}
