import { describe, expect, it } from 'vitest';
import { readFreesoundReturn } from './oauthReturn';

describe('readFreesoundReturn', () => {
  it('ignores addresses that are not a Freesound return', () => {
    expect(readFreesoundReturn('', 's1')).toEqual({ kind: 'none' });
    expect(readFreesoundReturn('?uigallery=1', 's1')).toEqual({ kind: 'none' });
    // A code without our state is not ours (for example the old copy-and-paste flow)
    expect(readFreesoundReturn('?code=abc', 's1')).toEqual({ kind: 'none' });
    expect(readFreesoundReturn('?state=s1', 's1')).toEqual({ kind: 'none' });
  });
  it('accepts an approval that carries our state back', () => {
    expect(readFreesoundReturn('?code=abc123&state=s1&original_path=%2Fapiv2%2F', 's1')).toEqual({ kind: 'code', code: 'abc123' });
  });
  it('recognises a refusal', () => {
    expect(readFreesoundReturn('?error=access_denied&state=s1', 's1')).toEqual({ kind: 'denied' });
  });
  it('refuses a return whose state is wrong or was never made by this browser', () => {
    expect(readFreesoundReturn('?code=abc&state=other', 's1')).toEqual({ kind: 'mismatch' });
    expect(readFreesoundReturn('?code=abc&state=s1', null)).toEqual({ kind: 'mismatch' });
    expect(readFreesoundReturn('?error=access_denied&state=bad', 's1')).toEqual({ kind: 'mismatch' });
  });
});
