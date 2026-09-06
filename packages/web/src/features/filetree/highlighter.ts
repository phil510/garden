import { codeToTokens, type ThemedToken } from 'shiki';
import { languageGuess } from './language';

/** VS Code's Dark+ theme — the palette the mock's `--syn-*` tokens imitate. */
const THEME = 'dark-plus';

/**
 * Tokenises `text` for syntax colouring, one array of tokens per line. `path`'s extension
 * guesses the language; an extension shiki doesn't recognise as a language id or alias
 * rejects, and falls back to plain, uncoloured text rather than throwing.
 */
export async function tokenizeFile(path: string, text: string): Promise<ThemedToken[][]> {
  const lang = languageGuess(path);
  try {
    const result = await codeToTokens(text, { lang: lang as never, theme: THEME });
    return result.tokens;
  } catch {
    const result = await codeToTokens(text, { lang: 'text', theme: THEME });
    return result.tokens;
  }
}
