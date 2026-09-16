import { useCallback, useEffect, useState } from 'react';
import { reportCommandFailure } from '../api/reportCommandFailure';

const COPIED_RESET_MS = 1400;

/**
 * The copy-to-clipboard-plus-flash pattern every "click to copy" affordance in the sidebar and
 * pane header shares: write to the clipboard, then flash `copied` for COPIED_RESET_MS. Two
 * independent copy targets on one row (e.g. an id and an attach command) each get their own
 * hook instance so one flash cannot reset the other's.
 */
export function useCopyFlash(): { copied: boolean; copy: (text: string) => void } {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_RESET_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  const copy = useCallback((text: string) => {
    navigator.clipboard
      .writeText(text)
      .then(() => setCopied(true))
      .catch(reportCommandFailure);
  }, []);

  return { copied, copy };
}
