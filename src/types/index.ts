/**
 * X-PRO AUDIO - Core Data Model
 * Strict TypeScript models for browser-based professional DAW
 */

export type FadeShape = 'linear' | 'exponential';

export interface Clip {
  id: string;
  trackId: string;
  assetId: string;
  name: string;
  startSeconds: number; // float, never rounded
  offsetSeconds: number;
  durationSeconds: number;
  gain: number; // linear multiplier (default 1.0)
  fadeInSeconds: number;
  fadeOutSeconds: number;
  fadeShape: FadeShape;
  muted?: boolean;
  effects?: TrackEffect[];
  versionHistory?: ClipVersion[];
}

export interface AmplifyParams {
  gainDb: number;
}

export interface CompressorParams {
  thresholdDb: number; // -60 to 0
  kneeDb: number; // 0 to 40
  ratio: number; // 1 to 20
  attackMs: number; // 1 to 500
  releaseMs: number; // 10 to 1000
  makeupGainDb: number; // 0 to 24
}

export interface DenoiseParams {
  highPassFreq: number; // 40 to 160 Hz
  noiseFloorThresholdDb: number; // -60 to -15 dB
  reductionDb: number; // 3 to 30 dB
  attackMs?: number; // 1 to 50 ms
  releaseMs?: number; // 20 to 300 ms
  speechPreserveRatio?: number; // 0 to 1
  learnedFloorDb?: number;
}

export interface PitchParams {
  semitones: number; // -12 to +12
}

export interface SpeedParams {
  speedRatio: number; // 0.5 to 2.0
}

export type EffectType = 'delay' | 'equalizer' | 'chorus' | 'flanger' | 'phaser' | 'reverb';

export interface DelayParams {
  timeMs: number; // 10 to 2000 ms
  feedback: number; // 0.0 to 0.95 (strictly < 1.0)
  lowCutHz: number; // 20 to 1000 Hz
  highCutHz: number; // 1000 to 20000 Hz
  pingPong: boolean;
  dryWet: number; // 0.0 to 1.0
}

export interface EqBand {
  id: string;
  type: 'highpass' | 'lowshelf' | 'peaking' | 'highshelf' | 'lowpass';
  frequency: number; // 20 to 20000 Hz
  gainDb: number; // -24 to +24 dB
  q: number; // 0.1 to 18
  enabled: boolean;
}

export interface EqualizerParams {
  bands: EqBand[];
  dryWet: number;
}

export interface ChorusParams {
  voices: number; // 2 to 6
  rateHz: number; // 0.1 to 8 Hz
  depthMs: number; // 1 to 20 ms
  stereoSpread: number; // 0 to 1
  feedback: number; // 0 to 0.7
  dryWet: number; // 0 to 1
}

export interface FlangerParams {
  delayMs: number; // 0.1 to 10 ms
  rateHz: number; // 0.05 to 5 Hz
  depthMs: number; // 0.1 to 5 ms
  feedback: number; // -0.9 to +0.9
  stereoPhaseDeg: number; // 0 to 180 deg
  dryWet: number; // 0 to 1
}

export interface PhaserParams {
  stages: number; // 4 to 12
  rateHz: number; // 0.05 to 6 Hz
  depth: number; // 0 to 1
  centerFreqHz: number; // 100 to 8000 Hz
  feedback: number; // 0 to 0.85
  stereoOffsetDeg: number; // 0 to 180 deg
  dryWet: number; // 0 to 1
}

export interface ReverbParams {
  type: 'algorithmic' | 'convolution';
  preset: 'room' | 'hall' | 'plate' | 'chamber';
  preDelayMs: number; // 0 to 200 ms
  decayTimeSec: number; // 0.2 to 10 s (RT60)
  damping: number; // 0 to 1
  diffusion: number; // 0 to 1
  size: number; // 0.1 to 2.0
  lowCutHz: number; // 20 to 500 Hz
  highCutHz: number; // 1000 to 20000 Hz
  dryWet: number; // 0 to 1
}

export interface TrackEffect {
  id: string;
  type: EffectType;
  name: string;
  enabled: boolean;
  params: DelayParams | EqualizerParams | ChorusParams | FlangerParams | PhaserParams | ReverbParams;
}

export interface ClipVersion {
  id: string;
  name: string;
  assetId: string;
  timestamp: number;
  operation: string;
}

export interface Track {
  id: string;
  name: string;
  clips: Clip[];
  volume: number; // 0.0 to 1.5, default 1.0
  pan: number; // -1.0 to 1.0, default 0.0
  muted: boolean;
  solo: boolean;
  effects?: TrackEffect[];
  plugins?: import('../plugins/types').StoredPluginState[];
}

export * from '../plugins/types';

export interface ProjectSettings {
  autoRefresh: boolean;
  sampleRate: number;
  timeFormat?: 'time' | 'samples' | 'timecode';
  duckPlayingTracks: boolean;
  duckingAmountDb: number; // default -12 dB
}

export interface Project {
  id: string;
  name: string;
  tracks: Track[];
  sampleRate: number;
  settings: ProjectSettings;
  updatedAt?: number;
}

export type AssetKind = 'recording' | 'voice' | 'music' | 'sfx' | 'import' | 'library';

export interface Asset {
  id: string;
  name: string;
  kind: AssetKind;
  buffer: AudioBuffer;
  sampleRate: number;
  durationSeconds: number;
  numberOfChannels: number;
  voiceMetadata?: VoiceMetadata;
}

export interface StoredAsset {
  id: string;
  name: string;
  kind: AssetKind;
  sampleRate: number;
  durationSeconds: number;
  numberOfChannels: number;
  channels: ArrayBuffer[] | Float32Array[]; // Supports legacy ArrayBuffers and typed-array IndexedDB records
  voiceMetadata?: VoiceMetadata;
}

export interface VoiceMetadata {
  script: string;
  voiceName: string;
  model: string;
  deliveryInstruction: string;
  createdAt?: number;
  precept?: string;
}

export interface VoiceGenerationRecord {
  id: string;
  scriptExcerpt: string;
  fullScript: string;
  voiceName: string;
  model: string;
  deliveryInstruction: string;
  durationSeconds: number;
  timestamp: number;
  status: 'succeeded' | 'failed';
  error?: string;
}

export interface FreesoundItem {
  id: number;
  name: string;
  username: string;
  duration: number;
  license: string;
  url: string;
  tags: string[];
  previews: {
    'preview-hq-mp3'?: string;
    'preview-hq-ogg'?: string;
    'preview-lq-mp3'?: string;
    'preview-lq-ogg'?: string;
  };
  images?: {
    waveform_m?: string;
    spectral_m?: string;
  };
  filesize?: number;
  type?: string;
  samplerate?: number;
}

export interface InputEQSettings {
  lowShelf80Hz: number; // -12 to +12 dB
  peak400Hz: number; // -12 to +12 dB, Q 1.2
  peak2500Hz: number; // -12 to +12 dB, Q 1.5
  highShelf8000Hz: number; // -12 to +12 dB
  bypassed: boolean;
}

export interface EQPreset {
  id: string;
  name: string;
  settings: InputEQSettings;
  isDefault: boolean;
}

export interface RecordingDeviceSettings {
  deviceId: string;
  echoCancellation: boolean;
  noiseSuppression: boolean;
  autoGainControl: boolean;
}

// ---------------------------------------------------------------------------
// Phase 6: Accounts, User Dashboard, Admin & Support Types
// ---------------------------------------------------------------------------

export interface UserPreferences {
  defaultVoice: string;
  defaultModel: string;
  defaultDelivery: string;
  autoRefresh: boolean;
}

export interface UserRecord {
  id: string; // Google User ID (stable)
  email: string; // Permanent email (lowercase)
  display_name: string;
  photo_url: string;
  role: 'user' | 'admin';
  created_at: string;
  last_active_at: string;
  blocked: boolean;
  preferences: UserPreferences;
}

export interface TicketMessage {
  id: string;
  sender: 'user' | 'admin';
  sender_name: string;
  content: string;
  created_at: string;
}

export interface SupportTicket {
  id: string;
  user_id: string;
  user_email: string;
  user_name: string;
  title: string;
  type: 'AI generation issue' | 'Account issue' | 'Workspace failure' | 'Technical issue' | 'Performance issue';
  status: 'Open' | 'Resolved' | 'Closed';
  created_at: string;
  updated_at: string;
  has_unread_admin_reply: boolean;
  messages: TicketMessage[];
}

export interface AdminOverviewStats {
  totalSignups: number;
  dailyActiveUsers: number;
  voiceGenerationsPerDay: number;
  charactersPerDay: number;
  totalVoiceGenerations: number;
  totalCharacters: number;
  quotaErrorsPerDay: number;
  totalQuotaErrors: number;
  blockedUsersCount: number;
}

export interface AdminUserRow {
  id: string;
  email: string;
  display_name: string;
  photo_url: string;
  role: 'user' | 'admin';
  created_at: string;
  last_active_at: string;
  blocked: boolean;
  voice_generations_count: number;
  characters_generated: number;
  projects_count: number;
}

export interface UserProjectItem {
  id: string;
  name: string;
  size_bytes: number;
  created_at: string;
  updated_at: string;
}

export interface UsageSummary {
  totalGenerations: number;
  totalCharacters: number;
  thisMonthGenerations: number;
  thisMonthCharacters: number;
}

