export interface ZoomScrollInput {
  scrollLeft: number;
  viewportWidth: number;
  headerWidth: number;
  previousZoom: number;
  nextZoom: number;
  maxScrollLeft: number;
}

/** Keep the same timeline time near the viewport center while zooming, with defensive clamps. */
export function calculateZoomScrollLeft(input: ZoomScrollInput): number {
  const finite = (value: number, fallback: number) => Number.isFinite(value) ? value : fallback;
  const scrollLeft = Math.max(0, finite(input.scrollLeft, 0));
  const viewportWidth = Math.max(0, finite(input.viewportWidth, 0));
  const headerWidth = Math.max(0, finite(input.headerWidth, 0));
  const previousZoom = Math.max(0.1, finite(input.previousZoom, 1));
  const nextZoom = Math.max(0.1, finite(input.nextZoom, previousZoom));
  const maxScrollLeft = Math.max(0, finite(input.maxScrollLeft, 0));
  const centerTime = Math.max(0, (scrollLeft + viewportWidth / 2 - headerWidth) / previousZoom);
  const targetScrollLeft = headerWidth + centerTime * nextZoom - viewportWidth / 2;
  return Math.min(maxScrollLeft, Math.max(0, targetScrollLeft));
}
