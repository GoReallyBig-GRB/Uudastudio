/**
 * True when a key press belongs to a text field or to a window that owns the keyboard, so the editor's
 * one-letter shortcuts (play, mute, split, markers...) must stay out of it. Covers inputs, text areas,
 * selects, rich text editors (contentEditable) and anything inside an element marked `data-no-shortcuts`.
 */
export const isTypingTarget = (target: EventTarget | null): boolean => {
  const el = target as HTMLElement | null;
  if (!el || typeof el.closest !== 'function') return false;
  if (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) return true;
  return el.closest('[contenteditable="true"],[data-no-shortcuts]') !== null;
};
