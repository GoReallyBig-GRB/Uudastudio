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
  const previousZoom = Math.max(MIN_PIXELS_PER_SECOND, finite(input.previousZoom, 1));
  const nextZoom = Math.max(MIN_PIXELS_PER_SECOND, finite(input.nextZoom, previousZoom));
  const maxScrollLeft = Math.max(0, finite(input.maxScrollLeft, 0));
  const targetScrollLeft = scrollLeft * (nextZoom / previousZoom);
  return Math.min(maxScrollLeft, Math.max(0, targetScrollLeft));
}


const MIN_PIXELS_PER_SECOND = 0.001;
const RIGHT_MARGIN_SECONDS = 60;

/**
 * Calculate the zoom-out boundary so the complete mix fits in the usable
 * timeline width with no more than the requested seconds of trailing space.
 */
export function calculateMinimumTimelineZoom(
  usableWidth: number,
  mixDurationSeconds: number,
  rightMarginSeconds = RIGHT_MARGIN_SECONDS,
): number {
  const finite = (value: number, fallback: number) => Number.isFinite(value) ? value : fallback;
  const width = Math.max(1, finite(usableWidth, 1));
  const duration = Math.max(0, finite(mixDurationSeconds, 0));
  const margin = Math.max(0, finite(rightMarginSeconds, RIGHT_MARGIN_SECONDS));
  return Math.max(MIN_PIXELS_PER_SECOND, width / Math.max(1, duration + margin));
}
