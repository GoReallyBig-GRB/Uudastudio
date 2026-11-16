/**
 * Words the voices tend to misread, spelled the way they should be spoken. Only the text sent to the voice is changed;
 * the script on screen and in the saved project stays as written.
 */
const SPOKEN: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bUuda\b/gi, 'Ooda'],
];

export const asSpoken = (script: string): string => SPOKEN.reduce((text, [pattern, say]) => text.replace(pattern, say), script);
