/**
 * Uuda Studio - Normalize and Enhance dialogs.
 * Both run on the clip or range that was selected, through the same block-by-block pipeline as Denoise and Compress, so any
 * length works and the result is one clip. Built on the shared dialog frame: tokens, pills, rounded corners.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { PresetBar } from './PresetBar';
import { ENHANCE_PRESETS } from './dspPresets';
import { loadCustomPresets, removeCustomPreset, saveCustomPreset } from './customPresets';
import { Activity, AudioWaveform, Play, Square, X } from 'lucide-react';
import { Button, ModalShell, ProgressIndicator, SegmentedControl, Slider } from './ui';
import type { ChunkTool } from '../audio/chunkedJob';
import { DEFAULT_ENHANCE, LoudnessMeter, buildEnhanceChain, buildEvenOutChain, planNormalize, type NormalizeTarget } from '../audio/dsp/leveling';

export type LevelModalType = 'normalize' | 'enhance' | null;

interface LevelModalsProps {
  active: LevelModalType;
  /** Up to 20 seconds of the target, for hearing the result before applying (null when not available) */
  previewBuffer: AudioBuffer | null;
  /** The preview is a piece of a longer clip */
  previewIsExcerpt: boolean;
  progress?: { fraction: number; label: string } | null;
  onStopProcessing?: () => void;
  onClose: () => void;
  onApply: (tool: Extract<ChunkTool, { kind: 'normalize' | 'enhance' }>) => Promise<void>;
}

const LOUDNESS_PRESETS = [
  { value: '-23', label: 'Broadcast  -23' },
  { value: '-16', label: 'Podcast  -16' },
  { value: '-14', label: 'Streaming  -14' },
] as const;

/** Plays a buffer, one at a time; stops when the dialog closes */
const useAudition = () => {
  const ctxRef = useRef<AudioContext | null>(null);
  const srcRef = useRef<AudioBufferSourceNode | null>(null);
  const [playing, setPlaying] = useState<'a' | 'b' | null>(null);
  const stop = () => {
    try { srcRef.current?.stop(); } catch { /* already stopped */ }
    srcRef.current = null;
    setPlaying(null);
  };
  const play = (which: 'a' | 'b', buffer: AudioBuffer) => {
    stop();
    const ctx = (ctxRef.current ??= new AudioContext());
    void ctx.resume();
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(ctx.destination);
    src.onended = () => { if (srcRef.current === src) { srcRef.current = null; setPlaying(null); } };
    src.start();
    srcRef.current = src;
    setPlaying(which);
  };
  useEffect(() => () => { try { srcRef.current?.stop(); } catch { /* gone */ } void ctxRef.current?.close().catch(() => undefined); }, []);
  return { playing, play, stop };
};

const toPlanar = (b: AudioBuffer) => Array.from({ length: b.numberOfChannels }, (_, c) => b.getChannelData(c).slice());
const fromPlanar = (ch: Float32Array[], sampleRate: number) => {
  const out = new AudioBuffer({ length: Math.max(1, ch[0]?.length ?? 1), numberOfChannels: ch.length, sampleRate });
  ch.forEach((c, i) => out.copyToChannel(c as Float32Array<ArrayBuffer>, i));
  return out;
};

export const LevelModals: React.FC<LevelModalsProps> = ({ active, previewBuffer, previewIsExcerpt, progress = null, onStopProcessing, onClose, onApply }) => {
  // Hooks first: this component is rendered closed and then opened, so none may sit after a conditional return
  const [mode, setMode] = useState<'peak' | 'loudness'>('loudness');
  const [peakDb, setPeakDb] = useState(-1);
  const [loudness, setLoudness] = useState<'-23' | '-16' | '-14'>('-16');
  const [evenOut, setEvenOut] = useState(0);
  const [strength, setStrength] = useState(Math.round(DEFAULT_ENHANCE.strength * 100));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [heard, setHeard] = useState<{ a: AudioBuffer; b: AudioBuffer } | null>(null);
  const audition = useAudition();

  const [customEnhance, setCustomEnhance] = useState(() => loadCustomPresets<{ strength: number }>('enhance'));
  useEffect(() => {
    if (!active) { audition.stop(); setBusy(false); setError(null); setHeard(null); return; }
    // Every opening starts from the defaults, so the last job's settings never carry over to a new track
    setMode('loudness'); setPeakDb(-1); setLoudness('-16'); setEvenOut(0); setStrength(Math.round(DEFAULT_ENHANCE.strength * 100));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
  useEffect(() => { setHeard(null); audition.stop(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [mode, peakDb, loudness, evenOut, strength]);

  const target: NormalizeTarget = useMemo(
    () => (mode === 'peak' ? { mode: 'peak', peakDb } : { mode: 'loudness', loudnessDb: Number(loudness), ceilingDb: -1 }),
    [mode, peakDb, loudness],
  );
  const evenTargetDb = mode === 'peak' ? -20 : Number(loudness);

  const tool = (): Extract<ChunkTool, { kind: 'normalize' | 'enhance' }> =>
    active === 'enhance'
      ? { kind: 'enhance', settings: { strength: strength / 100, targetDb: DEFAULT_ENHANCE.targetDb } }
      : { kind: 'normalize', target, evenOut: evenOut / 100, evenTargetDb };

  /** Render the preview excerpt the way the real job will (the whole-clip measurement is replaced by the excerpt's) */
  const render = (buf: AudioBuffer): AudioBuffer => {
    const sr = buf.sampleRate;
    const input = toPlanar(buf);
    if (active === 'enhance') {
      const chain = buildEnhanceChain(sr, { strength: strength / 100, targetDb: DEFAULT_ENHANCE.targetDb });
      const a = chain.push(input); const b = chain.finish();
      return fromPlanar(a.map((x, c) => { const o = new Float32Array(x.length + (b[c]?.length ?? 0)); o.set(x); o.set(b[c] ?? [], x.length); return o; }), sr);
    }
    if (evenOut > 0) {
      const chain = buildEvenOutChain(sr, { amount: evenOut / 100, targetDb: evenTargetDb, ceilingDb: target.mode === 'peak' ? target.peakDb : target.ceilingDb });
      const a = chain.push(input); const b = chain.finish();
      return fromPlanar(a.map((x, c) => { const o = new Float32Array(x.length + (b[c]?.length ?? 0)); o.set(x); o.set(b[c] ?? [], x.length); return o; }), sr);
    }
    const meter = new LoudnessMeter(sr);
    meter.push(input);
    const plan = planNormalize(meter.result(), target);
    const g = Math.pow(10, plan.gainDb / 20);
    return fromPlanar(input.map((c) => c.map((v) => v * g)), sr);
  };

  const hear = (which: 'a' | 'b') => {
    if (!previewBuffer) return;
    if (audition.playing === which) { audition.stop(); return; }
    let h = heard;
    if (!h) { h = { a: previewBuffer, b: render(previewBuffer) }; setHeard(h); }
    audition.play(which, which === 'a' ? h.a : h.b);
  };

  const apply = async () => {
    audition.stop();
    setBusy(true);
    setError(null);
    try {
      await onApply(tool());
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Processing failed.');
    } finally {
      setBusy(false);
    }
  };

  const isNormalize = active === 'normalize';
  const title = isNormalize ? 'Normalize' : 'Enhance';
  const Icon = isNormalize ? Activity : AudioWaveform;

  return (
    <ModalShell
      open={active !== null}
      onClose={() => { if (!busy) onClose(); }}
      dismissible={!busy}
      title={title}
      description={isNormalize
        ? 'Brings the whole selection to one steady level. The loudness is measured first, then one gain is applied, never pushing peaks past the ceiling.'
        : 'One step for any recording: removes rumble, clears muddiness, adds clarity, tames loud parts and evens out the level.'}
      size="sm"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" size="sm" onClick={apply} disabled={busy} loading={busy} leftIcon={<Icon className="h-3.5 w-3.5" aria-hidden="true" />}>
            {isNormalize ? 'Normalize' : 'Enhance'}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {isNormalize ? (
          <>
            <SegmentedControl
              label="Normalize to"
              value={mode}
              onChange={setMode}
              size="sm"
              options={[{ value: 'loudness', label: 'Loudness' }, { value: 'peak', label: 'Peak' }]}
            />
            {mode === 'loudness' ? (
              <div className="space-y-2">
                <SegmentedControl label="Loudness target" value={loudness} onChange={setLoudness} size="sm" options={LOUDNESS_PRESETS} />
                <p className="text-xs text-ink-faint">Integrated loudness in LUFS-style dB. Peaks are held under -1 dBFS; if that stops the target being reached, you are told.</p>
              </div>
            ) : (
              <Slider label="Highest peak" value={peakDb} min={-12} max={0} step={0.5} display={peakDb.toFixed(1)} unit="dBFS" onChange={setPeakDb} />
            )}
            <div className="border-t border-line pt-4">
              <Slider label="Even out highs and lows" value={evenOut} min={0} max={100} step={5} display={evenOut === 0 ? 'Off' : `${evenOut}%`} onChange={setEvenOut} />
              <p className="mt-1.5 text-xs text-ink-faint">
                {evenOut === 0
                  ? 'Off: the track keeps its own dynamics and only its overall level changes.'
                  : 'Slowly raises quiet stretches and lowers loud ones toward the target. Silence is left alone.'}
              </p>
            </div>
          </>
        ) : (
          <>
            <PresetBar
              presets={ENHANCE_PRESETS}
              activeIndex={ENHANCE_PRESETS.findIndex((p) => p.strength === strength)}
              onPick={(i) => setStrength(ENHANCE_PRESETS[i].strength)}
              custom={customEnhance}
              activeCustomIndex={customEnhance.findIndex((p) => p.value.strength === strength)}
              onPickCustom={(i) => setStrength(customEnhance[i].value.strength)}
              onRemoveCustom={(n) => setCustomEnhance(removeCustomPreset<{ strength: number }>('enhance', n))}
              onSave={(n) => setCustomEnhance(saveCustomPreset('enhance', n, { strength }))}
            />
            <Slider label="Strength" value={strength} min={0} max={100} step={5} display={`${strength}%`} onChange={setStrength} />
            <ul className="space-y-1 text-xs text-ink-faint">
              <li>Removes rumble and thumps below 80 Hz</li>
              <li>Eases boxy low-mids, adds presence and a little air</li>
              <li>Gentle compression, then slow level evening</li>
              <li>Stops peaks at -1 dBFS</li>
            </ul>
            <p className="text-xs text-ink-faint">Hiss is not removed here. For steady background noise take a Noise sample and use Denoise.</p>
          </>
        )}

        {previewBuffer && (
          <div className="space-y-2 border-t border-line pt-4">
            <div className="flex items-center gap-2">
              <Button variant="secondary" size="sm" disabled={busy} onClick={() => hear('a')} leftIcon={audition.playing === 'a' ? <Square className="h-3 w-3" aria-hidden="true" /> : <Play className="h-3 w-3" aria-hidden="true" />}>Original</Button>
              <Button variant="secondary" size="sm" disabled={busy} onClick={() => hear('b')} leftIcon={audition.playing === 'b' ? <Square className="h-3 w-3" aria-hidden="true" /> : <Play className="h-3 w-3" aria-hidden="true" />}>Result</Button>
            </div>
            <p className="text-xs text-ink-faint">
              {previewIsExcerpt ? 'Plays about 20 seconds from the playhead. ' : ''}
              {isNormalize && evenOut === 0 ? 'The preview measures only this piece, so the final gain can differ slightly.' : ''}
            </p>
          </div>
        )}

        {busy && progress && (
          <ProgressIndicator
            fraction={progress.fraction}
            label={progress.fraction < 0.3 && isNormalize && evenOut === 0 ? 'Measuring' : 'Processing'}
            onCancel={onStopProcessing}
            cancelLabel="Stop"
          />
        )}
        {error && <p className="rounded-control border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger" role="alert">{error}</p>}
      </div>
    </ModalShell>
  );
};
