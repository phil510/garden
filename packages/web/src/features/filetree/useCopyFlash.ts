import { useCallback, useEffect, useState } from 'react';
import { reportCommandFailure } from '../../api/reportCommandFailure';

const COPIED_RESET_MS = 1400;

/** Writes to the clipboard, then flashes `copied` for COPIED_RESET_MS. */
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
