/**
 * Shared ruler coordinate transforms.
 *
 * Timeline content coordinates start at time zero; viewport coordinates are
 * offset by the horizontal scroll position. Keep drawing and pointer seeking
 * on inverse transforms so zooming and scrolling cannot drift apart.
 */
export function timeToViewportX(
  timeSeconds: number,
  pixelsPerSecond: number,
  scrollLeft: number,
): number {
  return timeSeconds * pixelsPerSecond - scrollLeft;
}

export function viewportXToTime(
  viewportX: number,
  pixelsPerSecond: number,
  scrollLeft: number,
): number {
  if (!Number.isFinite(pixelsPerSecond) || pixelsPerSecond <= 0) return 0;
  return Math.max(0, (viewportX + scrollLeft) / pixelsPerSecond);
}
