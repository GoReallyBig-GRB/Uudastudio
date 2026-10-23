/**
 * X-PRO AUDIO - Recording Studio Modal
 * Complete recording interface featuring device selection, 4-band hardware input EQ,
 * EQ curve visualization, preset management, ducking controls, and live peak/RMS meter.
 */

import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  Mic,
  Square,
  Sliders,
  Settings2,
  Volume2,
  VolumeX,
  X,
  Check,
  AlertCircle,
  HelpCircle,
  BookmarkPlus,
  Trash2,
  Radio,
  Sparkles,
} from 'lucide-react';
import { InputEQSettings, EQPreset, RecordingDeviceSettings } from '../types';
import { audioRecorder, DeviceInfo, StreamStats } from '../audio/recorder';
import { audioEngine } from '../audio/engine';
import {
  loadEQPresets,
  saveEQPresets,
  getDefaultEQPreset,
  setDefaultEQPreset,
  loadRecordingDeviceSettings,
  saveRecordingDeviceSettings,
  DEFAULT_EQ_SETTINGS,
} from '../storage/presets';
import { formatTimecode } from '../utils/formatters';

interface RecordingModalProps {
  isOpen: boolean;
  onClose: () => void;
  onFinishRecording: (buffer: AudioBuffer, takeName: string) => void;
  duckPlayingTracks: boolean;
  duckingAmountDb: number;
}

export const RecordingModal: React.FC<RecordingModalProps> = ({
  isOpen,
  onClose,
  onFinishRecording,
  duckPlayingTracks,
  duckingAmountDb,
}) => {
  // Device & Stream States
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [deviceSettings, setDeviceSettings] = useState<RecordingDeviceSettings>(loadRecordingDeviceSettings);
  const [streamStats, setStreamStats] = useState<StreamStats | null>(null);
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const [isInitializingStream, setIsInitializingStream] = useState<boolean>(false);

  // EQ States & Presets
  const [presets, setPresets] = useState<EQPreset[]>(loadEQPresets);
  const [selectedPresetId, setSelectedPresetId] = useState<string>(() => getDefaultEQPreset(loadEQPresets()).id);
  const [eqSettings, setEqSettings] = useState<InputEQSettings>(() => getDefaultEQPreset(loadEQPresets()).settings);
  const [newPresetName, setNewPresetName] = useState<string>('');
  const [showSavePresetInput, setShowSavePresetInput] = useState<boolean>(false);

  // Recording State
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);
  const [takeCount, setTakeCount] = useState<number>(1);

  // Meter & Canvas Refs
  const meterCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const eqCurveCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // 1. Initialize Stream and Enumerate Devices ONLY when modal opens
  const initStreamAndDevices = useCallback(
    async (currentSettings: RecordingDeviceSettings, currentEq: InputEQSettings) => {
      setPermissionError(null);
      setIsInitializingStream(true);

      try {
        await audioRecorder.setupStream(currentSettings, currentEq);
        const devList = await audioRecorder.enumerateInputDevices();
        setDevices(devList);

        // If no deviceId was selected, select the first or default device
        if (!currentSettings.deviceId && devList.length > 0) {
          const defaultDev = devList.find((d) => d.deviceId === 'default') || devList[0];
          const updatedSettings = { ...currentSettings, deviceId: defaultDev.deviceId };
          setDeviceSettings(updatedSettings);
          saveRecordingDeviceSettings(updatedSettings);
        }

        setStreamStats(audioRecorder.getStreamStats());
      } catch (err: unknown) {
        const error = err as Error;
        setPermissionError(error.message);
      } finally {
        setIsInitializingStream(false);
      }
    },
    []
  );

  useEffect(() => {
    if (isOpen) {
      initStreamAndDevices(deviceSettings, eqSettings);

      // Listen for hardware plug/unplug events
      const handleDeviceChange = async () => {
        const devList = await audioRecorder.enumerateInputDevices();
        setDevices(devList);
      };

      navigator.mediaDevices.addEventListener('devicechange', handleDeviceChange);
      return () => {
        navigator.mediaDevices.removeEventListener('devicechange', handleDeviceChange);
      };
    } else {
      // Clean up stream if modal closed and not recording
      if (!isRecording) {
        audioRecorder.teardownStream();
      }
    }
  }, [isOpen]);

  // 2. Handle unexpected stream termination (mic unplugged)
  useEffect(() => {
    audioRecorder.setOnUnexpectedEnd((recoveredBuffer) => {
      setIsRecording(false);
      if (duckPlayingTracks) {
        audioEngine.setDucking(false);
      }
      if (recoveredBuffer && recoveredBuffer.duration > 0.2) {
        onFinishRecording(recoveredBuffer, `Mic Take ${takeCount} (Recovered)`);
        setTakeCount((prev) => prev + 1);
        onClose();
      }
    });
  }, [duckPlayingTracks, takeCount, onFinishRecording, onClose]);

  // 3. Live Input Meter Animation Loop
  useEffect(() => {
    let animId: number;
    let peakHold = 0;

    const renderMeter = () => {
      const canvas = meterCanvasRef.current;
      if (canvas && isOpen) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          const w = canvas.width;
          const h = canvas.height;
          ctx.clearRect(0, 0, w, h);

          // Background
          ctx.fillStyle = '#0a0a0f';
          ctx.fillRect(0, 0, w, h);

          const meter = audioRecorder.getInputMeter();
          const peak = Math.min(1.2, meter.peak);
          const rms = Math.min(1.0, meter.rms);

          if (peak > peakHold) {
            peakHold = peak;
          } else {
            peakHold = Math.max(0, peakHold * 0.95);
          }

          // RMS Bar
          const rmsWidth = rms * w;
          const grad = ctx.createLinearGradient(0, 0, w, 0);
          grad.addColorStop(0, '#00e5a3');
          grad.addColorStop(0.7, '#ffd000');
          grad.addColorStop(0.9, '#ff3b30');
          ctx.fillStyle = grad;
          ctx.fillRect(0, 0, rmsWidth, h);

          // Peak Indicator Line
          const peakX = Math.min(w - 2, peakHold * w);
          ctx.fillStyle = peakHold >= 0.99 ? '#ff2a2a' : '#ffffff';
          ctx.fillRect(peakX, 0, 2, h);
        }
      }
      animId = requestAnimationFrame(renderMeter);
    };

    animId = requestAnimationFrame(renderMeter);
    return () => cancelAnimationFrame(animId);
  }, [isOpen]);

  // 4. Draw EQ Frequency Curve Canvas
  useEffect(() => {
    const canvas = eqCurveCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    // Background & 0 dB baseline
    ctx.fillStyle = '#0c0c12';
    ctx.fillRect(0, 0, w, h);

    const midY = h / 2;
    ctx.strokeStyle = '#232330';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, midY);
    ctx.lineTo(w, midY);
    ctx.stroke();

    // Frequency grid lines (100Hz, 1kHz, 10kHz)
    const freqs = [100, 1000, 10000];
    ctx.font = '9px "JetBrains Mono", monospace';
    ctx.fillStyle = '#52525b';
    for (const f of freqs) {
      // Logarithmic x position from 20Hz to 20000Hz
      const x = (Math.log10(f / 20) / Math.log10(20000 / 20)) * w;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
      ctx.fillText(f >= 1000 ? `${f / 1000}k` : `${f}`, x + 2, h - 3);
    }

    if (eqSettings.bypassed) {
      // Flat line when bypassed
      ctx.strokeStyle = '#71717a';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(0, midY);
      ctx.lineTo(w, midY);
      ctx.stroke();
      ctx.setLineDash([]);
      return;
    }

    // Calculate approximate frequency curve
    ctx.strokeStyle = '#00F0FF';
    ctx.lineWidth = 2.5;
    ctx.shadowColor = '#00F0FF';
    ctx.shadowBlur = 6;
    ctx.beginPath();

    const maxDb = 12;
    const pxPerDb = (h / 2 - 4) / maxDb;

    for (let x = 0; x < w; x++) {
      // Frequency at x
      const logRatio = x / w;
      const freq = 20 * Math.pow(20000 / 20, logRatio);

      // Simple response sum of the 4 filters
      let db = 0;

      // Low shelf 80Hz
      const lowRatio = Math.max(0, 1 - Math.log2(freq / 80));
      if (freq <= 80) db += eqSettings.lowShelf80Hz;
      else if (freq <= 320) db += eqSettings.lowShelf80Hz * (1 - (freq - 80) / 240);

      // Peaking 400Hz (Q 1.2)
      const oct400 = Math.abs(Math.log2(freq / 400));
      if (oct400 < 1.5) db += eqSettings.peak400Hz * Math.exp(-Math.pow(oct400 * 1.2, 2));

      // Peaking 2500Hz (Q 1.5)
      const oct2500 = Math.abs(Math.log2(freq / 2500));
      if (oct2500 < 1.5) db += eqSettings.peak2500Hz * Math.exp(-Math.pow(oct2500 * 1.5, 2));

      // High shelf 8000Hz
      if (freq >= 8000) db += eqSettings.highShelf8000Hz;
      else if (freq >= 2000) db += eqSettings.highShelf8000Hz * ((freq - 2000) / 6000);

      const y = midY - db * pxPerDb;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
  }, [eqSettings]);

  // Update EQ settings and hardware nodes
  const handleUpdateEQ = (updates: Partial<InputEQSettings>) => {
    const next = { ...eqSettings, ...updates };
    setEqSettings(next);
    audioRecorder.updateEQ(next);
  };

  // Switch EQ preset
  const handleSelectPreset = (presetId: string) => {
    const found = presets.find((p) => p.id === presetId);
    if (found) {
      setSelectedPresetId(presetId);
      setEqSettings(found.settings);
      audioRecorder.updateEQ(found.settings);
    }
  };

  // Set current preset as default
  const handleSetCurrentAsDefault = () => {
    const updated = setDefaultEQPreset(selectedPresetId, presets);
    setPresets(updated);
  };

  // Save new custom preset
  const handleSaveNewPreset = () => {
    const name = newPresetName.trim();
    if (!name) return;
    const newPreset: EQPreset = {
      id: `preset-${Date.now()}`,
      name,
      settings: { ...eqSettings },
      isDefault: false,
    };
    const updated = [...presets, newPreset];
    saveEQPresets(updated);
    setPresets(updated);
    setSelectedPresetId(newPreset.id);
    setNewPresetName('');
    setShowSavePresetInput(false);
  };

  // Delete custom preset
  const handleDeletePreset = (id: string) => {
    if (presets.length <= 1) return;
    const updated = presets.filter((p) => p.id !== id);
    saveEQPresets(updated);
    setPresets(updated);
    if (selectedPresetId === id) {
      setSelectedPresetId(updated[0].id);
      setEqSettings(updated[0].settings);
      audioRecorder.updateEQ(updated[0].settings);
    }
  };

  // Change input device
  const handleChangeDevice = async (deviceId: string) => {
    const updated = { ...deviceSettings, deviceId };
    setDeviceSettings(updated);
    saveRecordingDeviceSettings(updated);
    await initStreamAndDevices(updated, eqSettings);
  };

  // Toggle DSP settings (Echo cancellation, noise suppression, auto gain)
  const handleToggleDsp = async (key: 'echoCancellation' | 'noiseSuppression' | 'autoGainControl') => {
    const updated = { ...deviceSettings, [key]: !deviceSettings[key] };
    setDeviceSettings(updated);
    saveRecordingDeviceSettings(updated);
    await initStreamAndDevices(updated, eqSettings);
  };

  // Record Start
  const handleStartRecording = async () => {
    try {
      if (duckPlayingTracks) {
        audioEngine.setDucking(true, duckingAmountDb);
      }

      await audioRecorder.startRecording((sec) => {
        setElapsedSeconds(sec);
      });
      setIsRecording(true);
      setElapsedSeconds(0);
    } catch (err: unknown) {
      const error = err as Error;
      setPermissionError(`Could not start recording: ${error.message}`);
    }
  };

  // Record Stop
  const handleStopRecording = async () => {
    try {
      const audioBuffer = await audioRecorder.stopRecording();
      setIsRecording(false);

      if (duckPlayingTracks) {
        audioEngine.setDucking(false);
      }

      if (audioBuffer && audioBuffer.duration > 0.1) {
        const takeName = `Mic Take ${takeCount}`;
        setTakeCount((prev) => prev + 1);
        onFinishRecording(audioBuffer, takeName);
        onClose();
      }
    } catch (err: unknown) {
      const error = err as Error;
      setPermissionError(`Error finalizing recording: ${error.message}`);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 select-none animate-in fade-in duration-150">
      <div className="bg-[#101016] border border-zinc-800 rounded-xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col text-zinc-100 max-h-[calc(100dvh-1.5rem)] md:h-[92dvh]">
        {/* Header */}
        <div className="px-3 sm:px-5 py-3.5 border-b border-zinc-800/80 bg-[#13131c] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-md bg-rose-500/20 text-rose-400 border border-rose-500/40 flex items-center justify-center">
              <Mic className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold tracking-tight text-zinc-100 flex items-center gap-2">
                <span>Record Input</span>
                {isRecording && (
                  <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-400 border border-rose-500/50 text-[10px] font-mono animate-pulse font-semibold">
                    <Radio className="w-2.5 h-2.5" />
                    LIVE ON AIR
                  </span>
                )}
              </h2>
              <div className="text-[11px] text-zinc-500">
                4-band input EQ applied directly before capture
              </div>
            </div>
          </div>

          <button
            onClick={() => {
              if (isRecording) {
                if (!window.confirm('Recording in progress. Stop and discard?')) return;
                handleStopRecording();
              }
              onClose();
            }}
            className="p-1 rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Permission Denied Error Banner */}
        {permissionError && (
          <div className="m-4 p-4 rounded-lg bg-rose-950/40 border border-rose-500/60 text-rose-200 text-xs flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <div className="font-semibold text-rose-100">Microphone Access Denied</div>
              <p className="text-[11px] leading-relaxed opacity-90">{permissionError}</p>
              <div className="text-[11px] text-rose-300 font-mono pt-1">
                Tip: Click the lock or settings icon in your browser URL address bar &rarr; Permissions &rarr; Microphone &rarr; Allow, then click Retry below.
              </div>
              <button
                onClick={() => initStreamAndDevices(deviceSettings, eqSettings)}
                className="mt-2 px-3 py-1 bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/60 text-rose-200 rounded text-[11px] font-semibold transition-colors"
              >
                Retry Microphone Permission
              </button>
            </div>
          </div>
        )}

        {/* Main Content Area */}
        <div className="p-5 overflow-y-auto space-y-4 flex-1">
          {/* Section 1: Input Device Picker & Stream Stats */}
          <div className="bg-[#0B0B0F] p-3.5 rounded-lg border border-zinc-800/80 space-y-3">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-zinc-200 flex items-center gap-1.5">
                <Sliders className="w-3.5 h-3.5 text-cyan-400" />
                Input Device
              </span>
              {streamStats && (
                <span className="text-[10px] font-mono text-zinc-400">
                  {streamStats.sampleRate} Hz · {streamStats.channelCount === 2 ? 'Joint Stereo' : 'Mono'}
                  {streamStats.latencyMs ? ` · ${streamStats.latencyMs}ms latency` : ''}
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {/* Device Selector */}
              <div>
                <select
                  disabled={isRecording || isInitializingStream}
                  value={deviceSettings.deviceId}
                  onChange={(e) => handleChangeDevice(e.target.value)}
                  className="w-full bg-[#14141E] border border-zinc-700/80 rounded px-2.5 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-cyan-500 font-medium"
                >
                  {devices.map((d) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label} {d.kind === 'interface' ? '(Audio Interface)' : d.kind === 'usb' ? '(USB Mic)' : ''}
                    </option>
                  ))}
                </select>
              </div>

              {/* Live Input Meter */}
              <div className="flex flex-col justify-center">
                <div className="flex justify-between text-[10px] text-zinc-500 mb-1">
                  <span>INPUT LEVEL</span>
                  <span className="font-mono text-zinc-400">PEAK / RMS</span>
                </div>
                <div className="h-2.5 w-full bg-black/60 rounded-xs border border-zinc-800 overflow-hidden">
                  <canvas ref={meterCanvasRef} width={280} height={10} className="w-full h-full block" />
                </div>
              </div>
            </div>

            {/* Broadcast Studio DSP Toggles */}
            <div className="pt-2 border-t border-zinc-800/60 flex flex-wrap items-center justify-between gap-2 text-[11px]">
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-1.5 cursor-pointer text-zinc-400 hover:text-zinc-200">
                  <input
                    type="checkbox"
                    checked={deviceSettings.echoCancellation}
                    onChange={() => handleToggleDsp('echoCancellation')}
                    className="rounded bg-zinc-800 border-zinc-700 accent-cyan-400"
                  />
                  <span>Echo Cancellation</span>
                </label>

                <label className="flex items-center gap-1.5 cursor-pointer text-zinc-400 hover:text-zinc-200">
                  <input
                    type="checkbox"
                    checked={deviceSettings.noiseSuppression}
                    onChange={() => handleToggleDsp('noiseSuppression')}
                    className="rounded bg-zinc-800 border-zinc-700 accent-cyan-400"
                  />
                  <span>Noise Suppression</span>
                </label>

                <label className="flex items-center gap-1.5 cursor-pointer text-zinc-400 hover:text-zinc-200">
                  <input
                    type="checkbox"
                    checked={deviceSettings.autoGainControl}
                    onChange={() => handleToggleDsp('autoGainControl')}
                    className="rounded bg-zinc-800 border-zinc-700 accent-cyan-400"
                  />
                  <span>Auto Gain</span>
                </label>
              </div>

              <div className="text-[10px] text-zinc-500 italic">
                (Studio default: all DSP off)
              </div>
            </div>

            {/* XLR Interface Honest Note */}
            <div className="p-2 rounded bg-zinc-900/60 border border-zinc-800/60 text-[10px] text-zinc-400 leading-relaxed flex items-start gap-1.5">
              <HelpCircle className="w-3.5 h-3.5 text-cyan-400 shrink-0 mt-0.5" />
              <span>
                <strong>Hardware note:</strong> XLR microphones require an audio interface. Multi-channel capture depends on whether your browser exposes them as separate or joint channels ({streamStats?.channelCount === 2 ? 'joint stereo detected' : 'mono detected'}).
              </span>
            </div>
          </div>

          {/* Section 2: Virtual 4-Band Input EQ */}
          <div className="bg-[#0B0B0F] p-3.5 rounded-lg border border-zinc-800/80 space-y-3">
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-2">
                <Settings2 className="w-3.5 h-3.5 text-cyan-400" />
                <span className="font-semibold text-zinc-200">4-Band Input EQ</span>
                <button
                  onClick={() => handleUpdateEQ({ bypassed: !eqSettings.bypassed })}
                  className={`text-[10px] px-2 py-0.5 rounded font-mono font-semibold transition-colors ${
                    eqSettings.bypassed
                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                      : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  {eqSettings.bypassed ? 'BYPASSED' : 'ACTIVE'}
                </button>
              </div>

              {/* Preset Selector */}
              <div className="flex items-center gap-1.5">
                <select
                  value={selectedPresetId}
                  onChange={(e) => handleSelectPreset(e.target.value)}
                  className="bg-[#14141E] border border-zinc-700/80 rounded px-2 py-1 text-[11px] text-zinc-200 focus:outline-none focus:border-cyan-500"
                >
                  {presets.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} {p.isDefault ? '(Default)' : ''}
                    </option>
                  ))}
                </select>

                <button
                  onClick={handleSetCurrentAsDefault}
                  title="Set current preset as automatic default"
                  className="p-1 rounded bg-zinc-800/80 text-zinc-400 hover:text-cyan-300 transition-colors"
                >
                  <Check className="w-3 h-3" />
                </button>

                <button
                  onClick={() => setShowSavePresetInput(!showSavePresetInput)}
                  title="Save current EQ settings as a new preset"
                  className="p-1 rounded bg-zinc-800/80 text-zinc-400 hover:text-cyan-300 transition-colors"
                >
                  <BookmarkPlus className="w-3 h-3" />
                </button>

                {presets.length > 1 && !presets.find((p) => p.id === selectedPresetId)?.isDefault && (
                  <button
                    onClick={() => handleDeletePreset(selectedPresetId)}
                    title="Delete preset"
                    className="p-1 rounded bg-zinc-800/80 text-zinc-400 hover:text-rose-400 transition-colors"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                )}
              </div>
            </div>

            {/* Save Preset Dialog Input */}
            {showSavePresetInput && (
              <div className="flex items-center gap-2 p-2 bg-[#14141E] rounded border border-zinc-700 text-xs">
                <input
                  type="text"
                  placeholder="New Preset Name..."
                  value={newPresetName}
                  onChange={(e) => setNewPresetName(e.target.value)}
                  className="bg-black/60 border border-zinc-600 rounded px-2 py-1 text-xs text-zinc-100 flex-1 focus:outline-none"
                />
                <button
                  onClick={handleSaveNewPreset}
                  className="px-2.5 py-1 bg-cyan-500 text-black font-semibold rounded text-xs hover:bg-cyan-400 transition-colors"
                >
                  Save
                </button>
              </div>
            )}

            {/* EQ Curve Display */}
            <div className="h-18 w-full bg-[#08080C] rounded border border-zinc-800/80 overflow-hidden">
              <canvas ref={eqCurveCanvasRef} width={580} height={72} className="w-full h-full block" />
            </div>

            {/* 4 EQ Band Sliders */}
            <div className="grid grid-cols-4 gap-3 pt-1 text-[11px]">
              {/* Band 1: Low Shelf 80Hz */}
              <div className="flex flex-col gap-1 bg-[#121218] p-2 rounded border border-zinc-800">
                <div className="flex justify-between text-zinc-400">
                  <span className="font-semibold text-zinc-300">80 Hz</span>
                  <span className="font-mono text-cyan-400">
                    {eqSettings.lowShelf80Hz > 0 ? `+${eqSettings.lowShelf80Hz}` : eqSettings.lowShelf80Hz} dB
                  </span>
                </div>
                <div className="text-[10px] text-zinc-500">Low Shelf</div>
                <input
                  type="range"
                  min="-12"
                  max="12"
                  step="0.5"
                  disabled={eqSettings.bypassed}
                  value={eqSettings.lowShelf80Hz}
                  onChange={(e) => handleUpdateEQ({ lowShelf80Hz: parseFloat(e.target.value) })}
                  className="w-full h-1 bg-zinc-800 rounded appearance-none cursor-pointer"
                />
              </div>

              {/* Band 2: Peaking 400Hz (Q 1.2) */}
              <div className="flex flex-col gap-1 bg-[#121218] p-2 rounded border border-zinc-800">
                <div className="flex justify-between text-zinc-400">
                  <span className="font-semibold text-zinc-300">400 Hz</span>
                  <span className="font-mono text-cyan-400">
                    {eqSettings.peak400Hz > 0 ? `+${eqSettings.peak400Hz}` : eqSettings.peak400Hz} dB
                  </span>
                </div>
                <div className="text-[10px] text-zinc-500">Peak (Q 1.2)</div>
                <input
                  type="range"
                  min="-12"
                  max="12"
                  step="0.5"
                  disabled={eqSettings.bypassed}
                  value={eqSettings.peak400Hz}
                  onChange={(e) => handleUpdateEQ({ peak400Hz: parseFloat(e.target.value) })}
                  className="w-full h-1 bg-zinc-800 rounded appearance-none cursor-pointer"
                />
              </div>

              {/* Band 3: Peaking 2500Hz (Q 1.5) */}
              <div className="flex flex-col gap-1 bg-[#121218] p-2 rounded border border-zinc-800">
                <div className="flex justify-between text-zinc-400">
                  <span className="font-semibold text-zinc-300">2.5 kHz</span>
                  <span className="font-mono text-cyan-400">
                    {eqSettings.peak2500Hz > 0 ? `+${eqSettings.peak2500Hz}` : eqSettings.peak2500Hz} dB
                  </span>
                </div>
                <div className="text-[10px] text-zinc-500">Peak (Q 1.5)</div>
                <input
                  type="range"
                  min="-12"
                  max="12"
                  step="0.5"
                  disabled={eqSettings.bypassed}
                  value={eqSettings.peak2500Hz}
                  onChange={(e) => handleUpdateEQ({ peak2500Hz: parseFloat(e.target.value) })}
                  className="w-full h-1 bg-zinc-800 rounded appearance-none cursor-pointer"
                />
              </div>

              {/* Band 4: High Shelf 8000Hz */}
              <div className="flex flex-col gap-1 bg-[#121218] p-2 rounded border border-zinc-800">
                <div className="flex justify-between text-zinc-400">
                  <span className="font-semibold text-zinc-300">8.0 kHz</span>
                  <span className="font-mono text-cyan-400">
                    {eqSettings.highShelf8000Hz > 0 ? `+${eqSettings.highShelf8000Hz}` : eqSettings.highShelf8000Hz} dB
                  </span>
                </div>
                <div className="text-[10px] text-zinc-500">High Shelf</div>
                <input
                  type="range"
                  min="-12"
                  max="12"
                  step="0.5"
                  disabled={eqSettings.bypassed}
                  value={eqSettings.highShelf8000Hz}
                  onChange={(e) => handleUpdateEQ({ highShelf8000Hz: parseFloat(e.target.value) })}
                  className="w-full h-1 bg-zinc-800 rounded appearance-none cursor-pointer"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Footer Transport & Record Button */}
        <div className="px-5 py-4 border-t border-zinc-800/80 bg-[#12121A] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            {isRecording ? (
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-rose-500 animate-ping" />
                <span className="font-mono text-lg font-bold text-rose-400">
                  {formatTimecode(elapsedSeconds)}
                </span>
              </div>
            ) : (
              <span className="text-xs text-zinc-400">
                Ready to capture. Recorded track lands at index 0.
              </span>
            )}
          </div>

          <div className="flex items-center gap-3">
            {isRecording ? (
              <button
                onClick={handleStopRecording}
                className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-rose-500 hover:bg-rose-400 text-white font-bold text-xs shadow-[0_0_20px_rgba(244,63,94,0.4)] transition-all cursor-pointer"
              >
                <Square className="w-4 h-4 fill-current" />
                <span>STOP & DOCK TRACK</span>
              </button>
            ) : (
              <button
                disabled={Boolean(permissionError)}
                onClick={handleStartRecording}
                className="flex items-center gap-2 px-6 py-2.5 rounded-lg bg-gradient-to-r from-rose-600 to-red-500 hover:from-rose-500 hover:to-red-400 text-white font-bold text-xs shadow-[0_0_20px_rgba(239,68,68,0.35)] transition-all cursor-pointer disabled:opacity-40"
              >
                <div className="w-3 h-3 rounded-full bg-white animate-pulse" />
                <span>RECORD NOW</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
