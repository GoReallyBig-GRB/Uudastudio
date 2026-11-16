import { describe, expect, it } from 'vitest';
import { defaultCountry, displayNumber, isValidWhatsapp, joinNumber, splitNumber } from './phone';

describe('WhatsApp numbers', () => {
  it('drops the trunk zero when joining with the country code', () => {
    expect(joinNumber('NG', '0803 123 4567')).toBe('2348031234567');
    expect(joinNumber('GB', '7911 123456')).toBe('447911123456');
    expect(joinNumber('NG', '')).toBe('');
  });
  it('splits a stored number back into country and number', () => {
    expect(splitNumber('2348031234567', 'GB')).toEqual({ iso: 'NG', national: '8031234567' });
    expect(splitNumber('+44 7911 123456', 'NG')).toEqual({ iso: 'GB', national: '7911123456' });
    expect(splitNumber('', 'KE')).toEqual({ iso: 'KE', national: '' });
  });
  it('prefers the longer code (Jamaica 1876 over the US 1)', () => {
    expect(splitNumber('18765551234', 'US').iso).toBe('JM');
  });
  it('picks a default country from the browser language', () => {
    expect(defaultCountry('en-GB')).toBe('GB');
    expect(defaultCountry('en')).toBe('NG');
  });
  it('accepts empty or 8 to 15 digits only', () => {
    expect(isValidWhatsapp('')).toBe(true);
    expect(isValidWhatsapp('2348031234567')).toBe(true);
    expect(isValidWhatsapp('12345')).toBe(false);
    expect(displayNumber('2348031234567')).toBe('+2348031234567');
  });
});
