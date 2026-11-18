import { audioRecorder, type RecordedTake } from '../../audio/recorder';
import { DEFAULT_EQ_SETTINGS, loadRecordingDeviceSettings } from '../../storage/presets';

export interface RoomRecording {
  takeId: string;
  name: string;
  startAt: number;
  /** Room time at which this device's recording really began */
  roomStartMs: number;
  take: RecordedTake;
}

/**
 * Records this device's own microphone, raw and straight to disk, for one take in a live room.
 * The call uses its own processed microphone; this one never has echo cancellation, noise suppression or gain control.
 * Recording begins when the room announces the take (during the count-in) and the exact room time is noted,
 * so the files from all devices can be lined up on `startAt` afterwards.
 */
export class RoomRecorder {
  private cur: { takeId: string; name: string; startAt: number; roomStartMs: number } | null = null;

  get running(): boolean { return this.cur !== null; }
  get takeId(): string | null { return this.cur?.takeId ?? null; }

  async begin(takeId: string, startAt: number, name: string, roomNow: () => number): Promise<void> {
    if (this.cur) return;
    if (audioRecorder.getIsRecording()) throw new Error('This device is already recording something else. Stop that first.');
    await audioRecorder.setupStream({ ...loadRecordingDeviceSettings(), echoCancellation: false, noiseSuppression: false, autoGainControl: false }, { ...DEFAULT_EQ_SETTINGS, bypassed: true });
    try {
      await audioRecorder.startRecording(undefined, name);
    } catch (e) {
      audioRecorder.teardownStream();
      throw e;
    }
    this.cur = { takeId, name, startAt, roomStartMs: roomNow() };
  }

  /** Stop and keep the audio on disk (the caller decides where it goes). Returns null when nothing was recording. */
  async finish(): Promise<RoomRecording | null> {
    const c = this.cur;
    if (!c) return null;
    this.cur = null;
    try {
      const take = await audioRecorder.stopRecordingTake(true);
      return { ...c, take };
    } finally {
      audioRecorder.teardownStream();
    }
  }
}
