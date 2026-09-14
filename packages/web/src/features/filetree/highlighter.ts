import { createHighlighterCore, type HighlighterCore, type ThemedToken } from 'shiki/core';
import { createOnigurumaEngine } from 'shiki/engine/oniguruma';
import { languageGuess } from './language';

/** VS Code's Dark+ theme — the palette the mock's `--syn-*` tokens imitate. */
const THEME = 'dark-plus';

/**
 * The grammars garden bundles, imported individually rather than through shiki's full bundle
 * so the build ships these as lazily-loaded chunks instead of all ~300. Each entry's own
 * aliases register alongside it, so `ts`, `yml`, `py`, `sh` and the rest resolve without
 * being listed. The set covers the languages a developer is likely to open in a repo garden
 * is pointed at; anything outside it renders uncoloured via the `text` fallback below.
 */
const LANGS = [
  () => import('shiki/langs/typescript.mjs'),
  () => import('shiki/langs/tsx.mjs'),
  () => import('shiki/langs/javascript.mjs'),
  () => import('shiki/langs/jsx.mjs'),
  () => import('shiki/langs/json.mjs'),
  () => import('shiki/langs/jsonc.mjs'),
  () => import('shiki/langs/yaml.mjs'),
  () => import('shiki/langs/toml.mjs'),
  () => import('shiki/langs/ini.mjs'),
  () => import('shiki/langs/css.mjs'),
  () => import('shiki/langs/scss.mjs'),
  () => import('shiki/langs/less.mjs'),
  () => import('shiki/langs/html.mjs'),
  () => import('shiki/langs/xml.mjs'),
  () => import('shiki/langs/markdown.mjs'),
  () => import('shiki/langs/shellscript.mjs'),
  () => import('shiki/langs/python.mjs'),
  () => import('shiki/langs/go.mjs'),
  () => import('shiki/langs/rust.mjs'),
  () => import('shiki/langs/sql.mjs'),
  () => import('shiki/langs/java.mjs'),
  () => import('shiki/langs/kotlin.mjs'),
  () => import('shiki/langs/swift.mjs'),
  () => import('shiki/langs/ruby.mjs'),
  () => import('shiki/langs/php.mjs'),
  () => import('shiki/langs/c.mjs'),
  () => import('shiki/langs/cpp.mjs'),
  () => import('shiki/langs/csharp.mjs'),
  () => import('shiki/langs/lua.mjs'),
  () => import('shiki/langs/dockerfile.mjs'),
  () => import('shiki/langs/make.mjs'),
  () => import('shiki/langs/terraform.mjs'),
  () => import('shiki/langs/proto.mjs'),
  () => import('shiki/langs/graphql.mjs'),
  () => import('shiki/langs/vue.mjs'),
  () => import('shiki/langs/svelte.mjs'),
  () => import('shiki/langs/powershell.mjs'),
  () => import('shiki/langs/diff.mjs'),
];

let highlighter: Promise<HighlighterCore> | undefined;

function getHighlighter(): Promise<HighlighterCore> {
  highlighter ??= createHighlighterCore({
    themes: [() => import('shiki/themes/dark-plus.mjs')],
    langs: LANGS,
    engine: createOnigurumaEngine(() => import('shiki/wasm')),
  });
  return highlighter;
}

/**
 * Tokenises `text` for syntax colouring under `lang`, one array of tokens per line. A `lang`
 * that isn't a loaded grammar (either not a shiki language at all, or one this file doesn't
 * bundle) falls back to plain, uncoloured text rather than throwing.
 */
export async function tokenizeText(text: string, lang: string): Promise<ThemedToken[][]> {
  const shiki = await getHighlighter();
  try {
    return shiki.codeToTokens(text, { lang, theme: THEME }).tokens;
  } catch {
    return shiki.codeToTokens(text, { lang: 'text', theme: THEME }).tokens;
  }
}

/** Tokenises a whole file's `text`, guessing its language from `path`'s extension. */
export function tokenizeFile(path: string, text: string): Promise<ThemedToken[][]> {
  return tokenizeText(text, languageGuess(path));
}
