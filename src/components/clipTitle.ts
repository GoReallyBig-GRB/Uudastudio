/**
 * Clip title rules for the timeline: fit a title inside its clip, keep "(Part 2)" from piling up, and format the
 * length shown in the hover popup. Pure and framework-free so they can be unit-tested without a browser.
 */

/** Horizontal padding between a clip's edge and its title, in pixels. */
export const TITLE_PAD_X = 6;
/** Below this much room, a title is not drawn at all (an ellipsis alone says nothing). */
export const TITLE_MIN_WIDTH = 24;

const PART_SUFFIX = /(\s*\(Part \d+\))+$/;

/** Collapses a run of trailing "(Part N)" tags, left by repeated splits, into a single one for display. */
export const displayTitle = (name: string | undefined | null): string => {
  const raw = (name ?? '').trim() || 'Audio Clip';
  const match = raw.match(PART_SUFFIX);
  if (!match) return raw;
  const base = raw.slice(0, raw.length - match[0].length).trimEnd();
  const lastTag = match[0].match(/\(Part \d+\)/g)!.pop()!;
  return base ? `${base} ${lastTag}` : lastTag;
};

/** Name for the second piece of a split clip. Never stacks tags: "Take (Part 2)" splits into "Take (Part 2)". */
export const nextPartName = (name: string): string => {
  const base = name.replace(PART_SUFFIX, '').trimEnd();
  return `${base || 'Audio Clip'} (Part 2)`;
};

/**
 * Longest start of `text` that fits `maxWidth`, ending in an ellipsis when it was shortened.
 * Returns '' when there is too little room to be useful. `measure` gives a string's width in pixels.
 */
export const fitTitle = (text: string, maxWidth: number, measure: (s: string) => number): string => {
  if (!text || !(maxWidth >= TITLE_MIN_WIDTH)) return '';
  if (measure(text) <= maxWidth) return text;
  let lo = 0;
  let hi = text.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (measure(`${text.slice(0, mid).trimEnd()}…`) <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  if (lo < 1) return '';
  return `${text.slice(0, lo).trimEnd()}…`;
};

/** Short length for the popup: "12.4s" under a minute, "3:05" above. */
export const formatClipLength = (seconds: number): string => {
  if (!Number.isFinite(seconds) || seconds < 0) return '';
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const whole = Math.round(seconds);
  const m = Math.floor(whole / 60);
  const s = whole % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
};
