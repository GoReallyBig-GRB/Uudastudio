/** WhatsApp numbers: a country code chosen from a list, then the number. Stored as digits with the country code first. */

export interface Country { iso: string; name: string; dial: string }

// Dial codes of the countries most producers and guests are in. Longest codes are matched first when splitting a stored number.
export const COUNTRIES: Country[] = [
  { iso: 'NG', name: 'Nigeria', dial: '234' }, { iso: 'GH', name: 'Ghana', dial: '233' }, { iso: 'KE', name: 'Kenya', dial: '254' },
  { iso: 'ZA', name: 'South Africa', dial: '27' }, { iso: 'UG', name: 'Uganda', dial: '256' }, { iso: 'TZ', name: 'Tanzania', dial: '255' },
  { iso: 'RW', name: 'Rwanda', dial: '250' }, { iso: 'ET', name: 'Ethiopia', dial: '251' }, { iso: 'EG', name: 'Egypt', dial: '20' },
  { iso: 'MA', name: 'Morocco', dial: '212' }, { iso: 'SN', name: 'Senegal', dial: '221' }, { iso: 'CI', name: "Cote d'Ivoire", dial: '225' },
  { iso: 'CM', name: 'Cameroon', dial: '237' }, { iso: 'ZM', name: 'Zambia', dial: '260' }, { iso: 'ZW', name: 'Zimbabwe', dial: '263' },
  { iso: 'US', name: 'United States', dial: '1' }, { iso: 'CA', name: 'Canada', dial: '1' }, { iso: 'GB', name: 'United Kingdom', dial: '44' },
  { iso: 'IE', name: 'Ireland', dial: '353' }, { iso: 'FR', name: 'France', dial: '33' }, { iso: 'DE', name: 'Germany', dial: '49' },
  { iso: 'ES', name: 'Spain', dial: '34' }, { iso: 'IT', name: 'Italy', dial: '39' }, { iso: 'PT', name: 'Portugal', dial: '351' },
  { iso: 'NL', name: 'Netherlands', dial: '31' }, { iso: 'BE', name: 'Belgium', dial: '32' }, { iso: 'CH', name: 'Switzerland', dial: '41' },
  { iso: 'SE', name: 'Sweden', dial: '46' }, { iso: 'NO', name: 'Norway', dial: '47' }, { iso: 'DK', name: 'Denmark', dial: '45' },
  { iso: 'PL', name: 'Poland', dial: '48' }, { iso: 'TR', name: 'Turkey', dial: '90' }, { iso: 'AE', name: 'United Arab Emirates', dial: '971' },
  { iso: 'SA', name: 'Saudi Arabia', dial: '966' }, { iso: 'IL', name: 'Israel', dial: '972' }, { iso: 'IN', name: 'India', dial: '91' },
  { iso: 'PK', name: 'Pakistan', dial: '92' }, { iso: 'BD', name: 'Bangladesh', dial: '880' }, { iso: 'PH', name: 'Philippines', dial: '63' },
  { iso: 'ID', name: 'Indonesia', dial: '62' }, { iso: 'MY', name: 'Malaysia', dial: '60' }, { iso: 'SG', name: 'Singapore', dial: '65' },
  { iso: 'CN', name: 'China', dial: '86' }, { iso: 'JP', name: 'Japan', dial: '81' }, { iso: 'KR', name: 'South Korea', dial: '82' },
  { iso: 'AU', name: 'Australia', dial: '61' }, { iso: 'NZ', name: 'New Zealand', dial: '64' }, { iso: 'BR', name: 'Brazil', dial: '55' },
  { iso: 'MX', name: 'Mexico', dial: '52' }, { iso: 'AR', name: 'Argentina', dial: '54' }, { iso: 'CO', name: 'Colombia', dial: '57' },
  { iso: 'JM', name: 'Jamaica', dial: '1876' }, { iso: 'TT', name: 'Trinidad and Tobago', dial: '1868' },
];

const byIso = (iso: string) => COUNTRIES.find((c) => c.iso === iso);

/** The country to preselect: from the browser language, then the time zone, then Nigeria */
export const defaultCountry = (lang = typeof navigator !== 'undefined' ? navigator.language : '', zone = ''): string => {
  const region = /-([A-Za-z]{2})\b/.exec(lang)?.[1]?.toUpperCase();
  if (region && byIso(region)) return region;
  if (/Lagos/.test(zone)) return 'NG';
  return 'NG';
};

const digits = (s: string) => s.replace(/\D/g, '');

/** "+234 803 123 4567" (or digits) into the country and the number without its country code */
export const splitNumber = (stored: string, fallbackIso: string): { iso: string; national: string } => {
  const d = digits(stored);
  if (!d) return { iso: fallbackIso, national: '' };
  const hit = [...COUNTRIES].sort((a, b) => b.dial.length - a.dial.length).find((c) => d.startsWith(c.dial));
  return hit ? { iso: hit.iso, national: d.slice(hit.dial.length) } : { iso: fallbackIso, national: d };
};

/** The number to store: country code plus the number, with the trunk 0 dropped (0803... becomes 803...) */
export const joinNumber = (iso: string, national: string): string => {
  const n = digits(national).replace(/^0+/, '');
  return n ? `${byIso(iso)?.dial ?? ''}${n}` : '';
};

export const isValidWhatsapp = (stored: string): boolean => stored === '' || (stored.length >= 8 && stored.length <= 15);

/** For showing: +234 803 123 4567 style grouping is left to the person; this keeps it readable and exact */
export const displayNumber = (stored: string): string => (stored ? `+${stored}` : '');
