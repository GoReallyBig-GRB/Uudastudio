import { describe, expect, it } from 'vitest';
import { modKey, shortcutGroups } from './shortcuts';

describe('shortcut list', () => {
  it('uses Cmd on a Mac and Ctrl everywhere else', () => {
    expect(modKey(true)).toBe('Cmd');
    expect(modKey(false)).toBe('Ctrl');
    const flat = (mac: boolean) => shortcutGroups(mac).flatMap((g) => g.items.flatMap((i) => i.keys));
    expect(flat(true)).toContain('Cmd');
    expect(flat(true)).not.toContain('Ctrl');
    expect(flat(false)).toContain('Ctrl');
  });
  it('lists every shortcut once, with a description', () => {
    const items = shortcutGroups(false).flatMap((g) => g.items);
    expect(items.every((i) => i.keys.length > 0 && i.does.length >= 3)).toBe(true);
    const labels = items.map((i) => i.keys.join('+'));
    expect(new Set(labels).size).toBe(labels.length);
  });
});
