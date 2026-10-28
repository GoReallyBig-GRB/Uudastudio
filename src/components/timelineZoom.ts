export interface ZoomScrollInput {
  scrollLeft: number;
  viewportWidth: number;
  headerWidth: number;
  previousZoom: number;
  nextZoom: number;
  maxScrollLeft: number;
  playheadSeconds?: number;
}

/**
 * Anchor zoom to the playhead when active so the track moves dynamically
 * to stay in sync with the playhead, or anchor to the left edge when at time zero.
 */
export function calculateZoomScrollLeft(input: ZoomScrollInput): number {
  const finite = (value: number, fallback: number) => (Number.isFinite(value) ? value : fallback);
  const scrollLeft = Math.max(0, finite(input.scrollLeft, 0));
  const previousZoom = Math.max(MIN_PIXELS_PER_SECOND, finite(input.previousZoom, 1));
  const nextZoom = Math.max(MIN_PIXELS_PER_SECOND, finite(input.nextZoom, previousZoom));
  const maxScrollLeft = Math.max(0, finite(input.maxScrollLeft, 0));

  if (
    typeof input.playheadSeconds === 'number' &&
    Number.isFinite(input.playheadSeconds) &&
    input.playheadSeconds > 0
  ) {
    const playhead = input.playheadSeconds;
    const playheadXOld = playhead * previousZoom;
    const offsetInViewport = playheadXOld - scrollLeft;
    const usableViewportWidth = Math.max(
      100,
      finite(input.viewportWidth, 1000) - finite(input.headerWidth, 0)
    );

    // Keep playhead at the same relative position in the viewport if visible, or center it
    let targetOffset = offsetInViewport;
    if (offsetInViewport < 0 || offsetInViewport > usableViewportWidth) {
      targetOffset = usableViewportWidth / 2;
    }
    const targetScrollLeft = playhead * nextZoom - targetOffset;
    return Math.min(maxScrollLeft, Math.max(0, targetScrollLeft));
  }

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
  return Math.min(1000, Math.max(MIN_PIXELS_PER_SECOND, width / Math.max(1, duration + margin)));
}
