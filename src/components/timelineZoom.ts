export interface ZoomScrollInput {
  scrollLeft: number;
  viewportWidth: number;
  headerWidth: number;
  previousZoom: number;
  nextZoom: number;
  maxScrollLeft: number;
}

/**
 * Keep the visible timeline area's center time fixed when zoom changes.
 *
 * scrollLeft belongs to the full scroll container, while the sticky controller
 * occupies headerWidth pixels and is not part of the timeline viewport. Compute
 * the center from the remaining timeline width; subtracting headerWidth from the
 * viewport center itself shifts the zoom anchor and compounds drift on each zoom.
 */
export function calculateZoomScrollLeft(input: ZoomScrollInput): number {
  const finite = (value: number, fallback: number) => Number.isFinite(value) ? value : fallback;
  const scrollLeft = Math.max(0, finite(input.scrollLeft, 0));
  const viewportWidth = Math.max(0, finite(input.viewportWidth, 0));
  const headerWidth = Math.min(viewportWidth, Math.max(0, finite(input.headerWidth, 0)));
  const previousZoom = Math.max(0.1, finite(input.previousZoom, 1));
  const nextZoom = Math.max(0.1, finite(input.nextZoom, previousZoom));
  const maxScrollLeft = Math.max(0, finite(input.maxScrollLeft, 0));
  const timelineViewportWidth = Math.max(0, viewportWidth - headerWidth);
  const centerTime = (scrollLeft + timelineViewportWidth / 2) / previousZoom;
  const targetScrollLeft = centerTime * nextZoom - timelineViewportWidth / 2;
  return Math.min(maxScrollLeft, Math.max(0, targetScrollLeft));
}
