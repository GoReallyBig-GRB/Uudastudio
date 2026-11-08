/**
 * Helpers for the browser's File System Access API (folder picker, save picker).
 *
 * These pickers are refused inside a cross-origin frame (for example a preview pane such as AI Studio's) with a
 * SecurityError, and some sandboxes also block window.prompt. Code must treat that as "use the fallback and say why",
 * never as a failed save.
 */

/** True when the app runs inside another page (an iframe). Cross-origin access to window.top throws, which also means embedded. */
export function isEmbeddedFrame(win: { self: unknown; top: unknown } = window): boolean {
  try {
    return win.self !== win.top;
  } catch {
    return true;
  }
}

/** True for errors that mean "the browser will not show this picker here", as opposed to the user cancelling. */
export function isPickerBlockedError(err: unknown): boolean {
  const name = (err as { name?: string } | null)?.name;
  return name === 'SecurityError' || name === 'NotAllowedError';
}

export function isPickerCancelled(err: unknown): boolean {
  return (err as { name?: string } | null)?.name === 'AbortError';
}

/** Plain-language reason shown to the user when a folder or save picker cannot open. */
export function blockedPickerMessage(embedded: boolean): string {
  return embedded
    ? 'The browser does not allow folder access inside an embedded preview. Open Uuda Studio in its own browser tab (Chrome or Edge) and try again. Until then, Save downloads the project file.'
    : 'This browser did not allow folder access. Use Chrome or Edge on a computer, or use Save to download the project file.';
}
