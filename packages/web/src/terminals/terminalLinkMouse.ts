import { normalizeLinkUrl, openExternalLink } from './hyperlinks.js'

const SGR_MOUSE_PREFIX = '\x1b[<'

// SGR primary button reports use button code 0 plus the Shift, Alt and Ctrl bits.
const PRIMARY_MOUSE_REPORT = /^(?:0|4|8|12|16|20|24|28);(\d+;\d+)([Mm])$/

interface HeldPress {
  data: string
  position: string
  url: string
  activated: boolean
}

/** Xterm activates links on the terminal element before reporting mouseup on the document.
 *  Hold the press until both agree this was a link click, so Codex sees neither mouse report. */
export function createTerminalLinkMouse(write: (data: string) => void, isCodex: () => boolean) {
  let hoveredUrl: string | undefined
  let pressEvent: MouseEvent | undefined
  let heldPress: HeldPress | undefined
  let terminalOwnsGesture = false
  let releaseTimer: number | undefined

  function clearPress(): void {
    heldPress = undefined
    window.clearTimeout(releaseTimer)
    releaseTimer = undefined
  }

  function forwardPress(): void {
    if (heldPress === undefined) return
    const { data } = heldPress
    clearPress()
    terminalOwnsGesture = true
    write(data)
  }

  return {
    hover: (_event: MouseEvent, url: string): void => {
      hoveredUrl = normalizeLinkUrl(url) === undefined ? undefined : url
    },
    leave: (): void => {
      hoveredUrl = undefined
    },
    startGesture: (event: MouseEvent): void => {
      if (event.button !== 0) return
      forwardPress()
      terminalOwnsGesture = false
      pressEvent = event
    },
    finishGesture: (event: MouseEvent): void => {
      if (event.button !== 0) return
      pressEvent = undefined
      if (heldPress === undefined) return
      // Flush after dispatch if xterm has no release report, for example after a mode change.
      window.clearTimeout(releaseTimer)
      releaseTimer = window.setTimeout(forwardPress, 0)
    },
    activate: (event: MouseEvent, url: string): void => {
      if (heldPress !== undefined) {
        if (event.button === 0 && heldPress.url === url) heldPress.activated = true
      } else if (event.button !== 0 || !terminalOwnsGesture) {
        openExternalLink(url)
      }
    },
    input: (data: string): void => {
      const report = data.startsWith(SGR_MOUSE_PREFIX)
        ? PRIMARY_MOUSE_REPORT.exec(data.slice(SGR_MOUSE_PREFIX.length))
        : null
      const position = report?.[1]
      const action = report?.[2]
      if (heldPress !== undefined) {
        if (action === 'm' && position === heldPress.position && heldPress.activated) {
          const { url } = heldPress
          clearPress()
          openExternalLink(url)
          return
        }
        forwardPress()
      }
      // xterm emits the report synchronously from mousedown. Paste can produce the same bytes.
      if (
        action === 'M' &&
        position &&
        hoveredUrl &&
        pressEvent !== undefined &&
        pressEvent.eventPhase !== Event.NONE &&
        !terminalOwnsGesture &&
        isCodex()
      ) {
        const { shiftKey, altKey, ctrlKey, metaKey } = pressEvent
        // Codex uses Shift-click to extend an existing selection.
        if (!shiftKey || altKey || ctrlKey || metaKey) {
          heldPress = { data, position, url: hoveredUrl, activated: false }
          return
        }
        terminalOwnsGesture = true
      }
      write(data)
    },
    dispose: clearPress,
  }
}
