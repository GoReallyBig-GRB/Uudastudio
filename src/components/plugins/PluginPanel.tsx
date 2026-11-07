/**
 * Uuda Studio - shared plugin control panel.
 *
 * One panel for every plugin, used by the inline "eye" view in the rack and by the pop-out modal:
 *   - preset menu and the single Mix (dry/wet) control, when asked for
 *   - a curve where it helps (compressor transfer curve, EQ response)
 *   - one slider per parameter, labelled and formatted from the descriptor
 * Third-party WAM plugins that ship their own interface keep it; the panel only mounts it.
 */

import React, { useEffect, useRef, useState } from 'react';
import { PluginInstance } from '../../plugins/types';
import { pluginManager } from '../../plugins/pluginManager';
import { PluginPreset, formatParamValue, getPluginPresets, paramLabel } from '../../plugins/presets';
import { compressorTransfer, eqBands, eqResponseDb } from '../../plugins/visuals';
import { SharpCanvas } from './SharpCanvas';
import { Switch } from '../ui';

const MIX_KEY = 'dryWet';
// Canvas colours are the app tokens' values (surface-0, line, ink-faint, accent, ink)
const GRID = '#1b1b1e';
const AXIS = '#6b6b72';
const LINE = '#00f0ff';
const MARK = '#f2f2f0';

function readValues(instance: PluginInstance): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [id, def] of Object.entries(instance.descriptor.parameters)) {
    const v = instance.getParameter ? instance.getParameter(id) : def.defaultValue;
    out[id] = Number.isFinite(v) ? v : def.defaultValue;
  }
  return out;
}

function matchPreset(presets: PluginPreset[], values: Record<string, number>): string {
  for (const p of presets) {
    const same = Object.entries(p.params).every(([k, v]) => k in values && Math.abs(values[k] - v) < 1e-6);
    if (same) return p.id;
  }
  return 'custom';
}

// ---------------------------------------------------------------------------
// Curves
// ---------------------------------------------------------------------------

function drawCompressor(ctx: CanvasRenderingContext2D, w: number, h: number, v: Record<string, number>) {
  const PAD = 22;
  const lo = -60;
  const hi = 0;
  const pw = w - PAD - 6;
  const ph = h - PAD - 6;
  const x = (db: number) => PAD + ((db - lo) / (hi - lo)) * pw;
  const y = (db: number) => 6 + (1 - (db - lo) / (hi - lo)) * ph;
  const clampDb = (db: number) => Math.max(lo, Math.min(hi, db));

  ctx.fillStyle = '#0a0a0b';
  ctx.fillRect(0, 0, w, h);

  ctx.lineWidth = 1;
  ctx.strokeStyle = GRID;
  ctx.fillStyle = AXIS;
  ctx.font = '10px ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (let db = lo; db <= hi; db += 20) {
    const px = Math.round(x(db)) + 0.5;
    const py = Math.round(y(db)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(px, 6);
    ctx.lineTo(px, 6 + ph);
    ctx.moveTo(PAD, py);
    ctx.lineTo(PAD + pw, py);
    ctx.stroke();
    ctx.fillText(String(db), px, h - PAD + 6);
  }

  // 1:1 guide
  ctx.strokeStyle = '#2a2a2e';
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(x(lo), y(lo));
  ctx.lineTo(x(hi), y(hi));
  ctx.stroke();
  ctx.setLineDash([]);

  // Transfer curve, sampled each dB so the knee is smooth
  const params = {
    threshold: v.threshold ?? -18,
    ratio: v.ratio ?? 4,
    knee: v.knee ?? 6,
    makeupGain: v.makeupGain ?? 0,
  };
  ctx.strokeStyle = LINE;
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  for (let db = lo; db <= hi; db += 0.5) {
    const out = clampDb(compressorTransfer(db, params));
    if (db === lo) ctx.moveTo(x(db), y(out));
    else ctx.lineTo(x(db), y(out));
  }
  ctx.stroke();

  // Threshold marker
  const t = clampDb(params.threshold);
  ctx.fillStyle = MARK;
  ctx.beginPath();
  ctx.arc(x(t), y(clampDb(compressorTransfer(t, params))), 3.5, 0, Math.PI * 2);
  ctx.fill();
}

function drawEq(ctx: CanvasRenderingContext2D, w: number, h: number, pluginId: string, v: Record<string, number>) {
  const bands = eqBands(pluginId, v);
  const PAD_L = 28;
  const PAD_B = 18;
  const pw = w - PAD_L - 6;
  const ph = h - PAD_B - 6;
  const range = 18;
  const fx = (f: number) => PAD_L + (Math.log10(f / 20) / 3) * pw;
  const dy = (db: number) => 6 + (1 - (db + range) / (2 * range)) * ph;

  ctx.fillStyle = '#0a0a0b';
  ctx.fillRect(0, 0, w, h);
  ctx.font = '10px ui-monospace, monospace';
  ctx.lineWidth = 1;
  ctx.strokeStyle = GRID;
  ctx.fillStyle = AXIS;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'right';
  for (const db of [-12, 0, 12]) {
    const py = Math.round(dy(db)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(PAD_L, py);
    ctx.lineTo(PAD_L + pw, py);
    ctx.stroke();
    ctx.fillText(String(db), PAD_L - 4, py);
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (const [f, label] of [
    [100, '100'],
    [1000, '1k'],
    [10000, '10k'],
  ] as Array<[number, string]>) {
    const px = Math.round(fx(f)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(px, 6);
    ctx.lineTo(px, 6 + ph);
    ctx.stroke();
    ctx.fillText(label, px, h - PAD_B + 4);
  }
  if (!bands) return;

  ctx.strokeStyle = LINE;
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  const N = 160;
  for (let i = 0; i < N; i++) {
    const f = 20 * Math.pow(1000, i / (N - 1));
    const db = Math.max(-range, Math.min(range, eqResponseDb(bands, f)));
    const px = fx(f);
    const py = dy(db);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.stroke();
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

interface SliderProps {
  id: string;
  def: { min: number; max: number; step?: number; unit?: string; label?: string; name?: string };
  value: number;
  onChange: (id: string, value: number) => void;
}

const ParamSlider: React.FC<SliderProps> = ({ id, def, value, onChange }) => {
  const label = paramLabel(id, def.label, def.name);
  if (def.unit === 'bool') {
    const on = value >= 0.5;
    return (
      <div className="flex min-h-[2.25rem] items-center justify-between gap-2">
        <span className="truncate text-xs text-ink-dim">{label}</span>
        <Switch checked={on} onChange={(v) => onChange(id, v ? 1 : 0)} label={label} hideLabel />
      </div>
    );
  }
  return (
    <div className="min-w-0">
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <span className="truncate text-xs text-ink-dim">{label}</span>
        <span className="font-num shrink-0 text-xs text-ink">{formatParamValue(id, value, def)}</span>
      </div>
      <input
        type="range"
        aria-label={label}
        min={def.min}
        max={def.max}
        step={def.step || (def.max - def.min) / 100}
        value={value}
        onChange={(e) => onChange(id, parseFloat(e.target.value))}
        className="w-full cursor-pointer"
      />
    </div>
  );
};

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

export interface PluginPanelProps {
  instance: PluginInstance;
  trackId: string;
  /** Show the preset menu */
  showPresets?: boolean;
  /** Show the Mix slider (leave off where the rack header already has one) */
  showMix?: boolean;
  /** Extra control placed at the end of the preset row, for example Bypass */
  presetRowExtra?: React.ReactNode;
}

export const PluginPanel: React.FC<PluginPanelProps> = ({
  instance,
  trackId,
  showPresets = true,
  showMix = false,
  presetRowExtra,
}) => {
  const descriptor = instance.descriptor;
  const presets: PluginPreset[] = getPluginPresets(descriptor);
  const hasMix = MIX_KEY in descriptor.parameters;

  const [values, setValues] = useState<Record<string, number>>(() => readValues(instance));
  const [presetId, setPresetId] = useState<string>(() => matchPreset(presets, readValues(instance)));
  const [, setTick] = useState(0);

  // Mix and bypass change elsewhere too (rack header); re-read when the manager says something changed
  useEffect(() => pluginManager.subscribe(() => setTick((t) => t + 1)), []);

  const setParam = (id: string, value: number) => {
    if (id === MIX_KEY) pluginManager.setPluginDryWet(trackId, instance.instanceId, value);
    else pluginManager.setParameterDirect(trackId, instance.instanceId, id, value);
    setValues((prev) => ({ ...prev, [id]: value }));
  };

  const onSlider = (id: string, value: number) => {
    setParam(id, value);
    setPresetId('custom');
  };

  const applyPreset = (id: string) => {
    const preset = presets.find((p) => p.id === id);
    if (!preset) return;
    for (const [key, value] of Object.entries(preset.params)) setParam(key, value);
    setPresetId(id);
  };

  // Third-party modules that bring their own interface
  const ownGuiRef = useRef<HTMLDivElement>(null);
  const useOwnGui = descriptor.type === 'third-party-wam' && descriptor.hasCustomGui && !!instance.renderGUI;
  useEffect(() => {
    const el = ownGuiRef.current;
    if (!useOwnGui || !el || !instance.renderGUI || el.children.length > 0) return;
    instance.renderGUI(el).catch((err) => console.warn('Failed to render plugin interface:', err));
  }, [useOwnGui, instance]);

  const mix = hasMix ? instance.dryWet : 1;
  const sliderIds = Object.keys(descriptor.parameters).filter((id) => id !== MIX_KEY);
  const isCompressor = descriptor.id === 'uuda-native-compressor';
  const isEq = eqBands(descriptor.id, {}) !== null;

  return (
    <div className="flex flex-col gap-3">
      {(showPresets || showMix) && (
        <div className="flex flex-wrap items-center gap-2 rounded-card border border-line bg-surface-2 p-2.5">
          {showPresets && (
            <label className="flex items-center gap-2 min-w-0 flex-1 basis-48">
              <span className="shrink-0 text-xs text-ink-faint">Preset</span>
              <select
                value={presetId}
                onChange={(e) => applyPreset(e.target.value)}
                className="h-8 min-w-0 flex-1 cursor-pointer rounded-full border border-line-strong bg-surface-3 px-3 text-xs font-semibold text-ink hover:border-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
              >
                {presetId === 'custom' && <option value="custom">Custom</option>}
                {presets.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {presetRowExtra}
        </div>
      )}

      {showMix && hasMix && (
        <div className="rounded-card border border-line bg-surface-2 p-2.5">
          <div className="mb-1.5 flex items-baseline justify-between">
            <span className="text-xs text-ink-dim">Dry / Wet</span>
            <span className="font-num text-xs text-ink">{Math.round(mix * 100)}% wet</span>
          </div>
          <input
            type="range"
            aria-label="Dry / Wet"
            min={0}
            max={1}
            step={0.01}
            value={mix}
            onChange={(e) => {
              setParam(MIX_KEY, parseFloat(e.target.value));
              setPresetId('custom');
            }}
            className="w-full cursor-pointer"
          />
          <div className="mt-0.5 flex justify-between text-[10px] text-ink-faint">
            <span>Dry</span>
            <span>Wet</span>
          </div>
        </div>
      )}

      {useOwnGui ? (
        <div ref={ownGuiRef} />
      ) : (
        <>
          {isCompressor && (
            <div className="mx-auto w-full max-w-[260px] overflow-hidden rounded-control border border-line">
              <SharpCanvas aspect={1} draw={(ctx, w, h) => drawCompressor(ctx, w, h, values)} />
            </div>
          )}
          {isEq && (
            <div className="w-full overflow-hidden rounded-control border border-line">
              <SharpCanvas aspect={3} draw={(ctx, w, h) => drawEq(ctx, w, h, descriptor.id, values)} />
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
            {sliderIds.map((id) => (
              <ParamSlider key={id} id={id} def={descriptor.parameters[id]} value={values[id]} onChange={onSlider} />
            ))}
          </div>
        </>
      )}
    </div>
  );
};
