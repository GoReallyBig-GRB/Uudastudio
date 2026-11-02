/** Voice presets for Change Pitch. Semitones are within the tool's ±12 range; the slider can still fine-tune from there. */
export interface PitchPreset {
  id: string;
  label: string;
  semitones: number;
  hint: string;
}

export const PITCH_PRESETS: readonly PitchPreset[] = [
  { id: 'chipmunk', label: 'Chipmunk', semitones: 12, hint: 'Extreme high: one octave up' },
  { id: 'baby', label: 'Baby', semitones: 7, hint: 'High: a fifth up' },
  { id: 'angelic', label: 'Angelic', semitones: 4, hint: 'Mid: a bright, lifted voice' },
  { id: 'megatron', label: 'Megatron', semitones: -5, hint: 'Deep: a fourth down' },
  { id: 'monster', label: 'Monster', semitones: -12, hint: 'Extreme deep: one octave down' },
];

/** The preset a pitch setting matches exactly, if any */
export const presetFor = (semitones: number): PitchPreset | undefined => PITCH_PRESETS.find((p) => p.semitones === semitones);
