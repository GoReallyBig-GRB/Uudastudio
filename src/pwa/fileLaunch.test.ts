import { describe, expect, it } from 'vitest';
import { launchedKind } from './fileLaunch';
describe('launched files', () => {
  it('tells projects from templates by extension', () => {
    expect(launchedKind('Show.uuda')).toBe('project');
    expect(launchedKind('Show.UUDA')).toBe('project');
    expect(launchedKind('Show.uuda-template')).toBe('template');
    expect(launchedKind('Show.wav')).toBeNull();
  });
});
