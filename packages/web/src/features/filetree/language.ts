/**
 * Shiki language id or alias guessed from a path's extension, lowercased. A file with no
 * extension, such as `Dockerfile`, falls back to its bare, lowercased name, which is itself
 * a valid alias for some files and simply an unrecognised id — falling back to plain text —
 * for everything else. A leading dot, as in `.gitignore`, is never mistaken for an extension
 * separator.
 */
export function languageGuess(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : name.toLowerCase();
}
