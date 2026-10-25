export interface ZoomScrollInput {
  scrollLeft: number;
  viewportWidth: number;
  headerWidth: number;
  previousZoom: number;
  nextZoom: number;
  maxScrollLeft: number;
}

/**
 * Anchor zoom to the timeline's left edge instead of its center.
 *
 * Scaling the existing scroll offset by the zoom ratio preserves the time
 * already at the left edge. In particular, scrollLeft=0 stays at zero, so
 * zooming in expands the timeline only to the right and cannot pull time zero
 * underneath the sticky track controllers.
 */
export function calculateZoomScrollLeft(input: ZoomScrollInput): number {
  const finite = (value: number, fallback: number) => Number.isFinite(value) ? value : fallback;
  const scrollLeft = Math.max(0, finite(input.scrollLeft, 0));
  const previousZoom = Math.max(0.1, finite(input.previousZoom, 1));
  const nextZoom = Math.max(0.1, finite(input.nextZoom, previousZoom));
  const maxScrollLeft = Math.max(0, finite(input.maxScrollLeft, 0));
  const targetScrollLeft = scrollLeft * (nextZoom / previousZoom);
  return Math.min(maxScrollLeft, Math.max(0, targetScrollLeft));
}
