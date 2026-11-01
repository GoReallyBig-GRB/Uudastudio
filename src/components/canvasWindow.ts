/**
 * The waveform canvas of a lane is wider than what is on screen: it covers the visible stretch plus a margin on both sides,
 * and sits in the scrolling lane, so the browser scrolls it smoothly by itself. It only needs redrawing when the view gets
 * near its edge (or on zoom and edits), not on every scroll event.
 */
export interface CanvasWindow {
  /** Timeline x (px) of the canvas's left edge */
  origin: number;
  /** Canvas width in CSS px */
  width: number;
}

/** Widest canvas we ask for in device pixels (browsers refuse around 16384 and slow down well before). */
export const MAX_CANVAS_DEVICE_PX = 12000;

/** Window around `scrollLeft`: the view in the middle, with as much margin each side as the size limit allows (up to one view). */
export const canvasWindowFor = (scrollLeft: number, viewportWidth: number, dpr: number, laneWidth = Infinity): CanvasWindow => {
  const view = Math.max(100, Math.ceil(viewportWidth));
  const maxCss = Math.max(view, Math.floor(MAX_CANVAS_DEVICE_PX / Math.max(1, dpr)));
  const margin = Math.max(0, Math.min(view, Math.floor((maxCss - view) / 2)));
  const origin = Math.max(0, Math.floor(scrollLeft) - margin);
  const width = Math.min(view + 2 * margin, Math.max(view, Math.ceil(laneWidth - origin)));
  return { origin, width: Math.max(view, width) };
};

/** True when the view has come close enough to an edge of the canvas that it should be re-centred (and redrawn). */
export const needsRecentre = (current: CanvasWindow, scrollLeft: number, viewportWidth: number): boolean => {
  const view = Math.max(100, Math.ceil(viewportWidth));
  const slack = Math.max(0, (current.width - view) / 2);
  const leftGap = scrollLeft - current.origin;
  const rightGap = current.origin + current.width - (scrollLeft + view);
  const edge = Math.min(120, slack / 2);
  if (scrollLeft < current.origin || rightGap < 0) return true;
  // Near the left edge only matters when there is canvas to the left to gain (origin 0 cannot move further left)
  if (current.origin > 0 && leftGap < edge) return true;
  return rightGap < edge && slack > 0;
};
