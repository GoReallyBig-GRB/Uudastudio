/** Every keyboard shortcut Uuda answers to, as the Shortcuts tab shows them. Keep in step with the key handlers in App.tsx and Timeline.tsx. */

export interface Shortcut { keys: string[]; does: string }
export interface ShortcutGroup { title: string; items: Shortcut[] }

export const isMac = (): boolean => typeof navigator !== 'undefined' && /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent || '');

/** "Ctrl" on Windows and Linux, "Cmd" on a Mac */
export const modKey = (mac: boolean = isMac()): string => (mac ? 'Cmd' : 'Ctrl');

export const shortcutGroups = (mac: boolean = isMac()): ShortcutGroup[] => {
  const mod = modKey(mac);
  return [
    { title: 'Playback and recording', items: [
      { keys: ['Space'], does: 'Play or pause' },
      { keys: ['End'], does: 'Jump to the end of the audio' },
      { keys: ['R'], does: 'Open the recording studio' },
    ] },
    { title: 'Tools and view', items: [
      { keys: ['Z'], does: 'Select tool' },
      { keys: ['X'], does: 'Range tool' },
      { keys: ['F'], does: 'Single-track view on or off' },
      { keys: [mod, 'Scroll'], does: 'Zoom the timeline' },
    ] },
    { title: 'Editing clips', items: [
      { keys: ['S'], does: 'Split the selected clip at the playhead' },
      { keys: ['Q'], does: 'Quick actions for the selected clip or range' },
      { keys: ['Delete'], does: 'Delete the selected clip, or the highlighted range' },
      { keys: ['L'], does: 'Lock or unlock the selected clip or group' },
      { keys: [mod, 'M'], does: 'Mute or unmute the selected clip' },
      { keys: ['Up / Down'], does: 'Move the selected clip to the track above or below' },
      { keys: ['Esc'], does: 'Clear the selection or highlighted range' },
    ] },
    { title: 'Clipboard and history', items: [
      { keys: [mod, 'C'], does: 'Copy' },
      { keys: [mod, 'X'], does: 'Cut' },
      { keys: [mod, 'V'], does: 'Paste at the playhead' },
      { keys: [mod, 'D'], does: 'Duplicate' },
      { keys: [mod, 'A'], does: 'Select all' },
      { keys: [mod, 'Z'], does: 'Undo' },
      { keys: [mod, 'Y'], does: 'Redo' },
      { keys: [mod, 'Shift', 'Z'], does: 'Redo' },
    ] },
    { title: 'Markers', items: [
      { keys: ['M'], does: 'Add a marker at the playhead' },
      { keys: ['[ / ]'], does: 'Jump to the previous or next marker' },
    ] },
  ];
};
