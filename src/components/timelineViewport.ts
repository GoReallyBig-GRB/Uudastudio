export interface VisibleClipPixelRange {
  startPx: number;
  endPx: number;
}

/**
 * Return the clip-local pixel interval visible in a viewport-local canvas.
 * clipViewportX is the clip's left edge after subtracting scrollLeft exactly once.
 */
export function getVisibleClipPixelRange(
  clipViewportX: number,
  clipWidth: number,
  viewportWidth: number
): VisibleClipPixelRange {
  const finite = (value: number, fallback = 0) => Number.isFinite(value) ? value : fallback;
  const x = finite(clipViewportX);
  const clipW = Math.max(0, finite(clipWidth));
  const viewportW = Math.max(0, finite(viewportWidth));
  const startPx = Math.min(clipW, Math.max(0, Math.floor(-x)));
  const endPx = Math.min(clipW, Math.max(startPx, Math.ceil(viewportW - x)));
  return { startPx, endPx };
}
