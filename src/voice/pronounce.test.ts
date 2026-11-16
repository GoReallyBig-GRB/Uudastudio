import { describe, expect, it } from 'vitest';
import { asSpoken } from './pronounce';

describe('how words are said', () => {
  it('respells Uuda wherever it appears, in any case, and leaves other words alone', () => {
    expect(asSpoken('Welcome to Uuda Studio. UUDA is ready, uuda!')).toBe('Welcome to Oo-dah Studio. Oo-dah is ready, Oo-dah!');
    expect(asSpoken('Prelude to a Studio')).toBe('Prelude to a Studio');
  });
});
