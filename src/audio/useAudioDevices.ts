import { useCallback, useEffect, useRef, useState } from 'react';
import { audioRecorder } from './recorder';
import { loadRecordingDeviceSettings } from '../storage/presets';
import { newDevices, shouldOpenOnLoad, signature, systemDefaults, toDevices, type AudioDevice, type SystemDefaults } from './deviceWatch';

const SIG_KEY = 'uuda_audio_signature';
const readSig = (): string | null => { try { return localStorage.getItem(SIG_KEY); } catch { return null; } };
const writeSig = (s: string): void => { try { localStorage.setItem(SIG_KEY, s); } catch { /* storage unavailable */ } };

/**
 * Watches the computer's audio gear. Opens the setup sheet when the app loads (first time, or when the gear differs from last time)
 * and whenever a microphone, interface or headphones are plugged in while the app is open.
 */
export const useAudioDevices = () => {
  const [devices, setDevices] = useState<AudioDevice[]>([]);
  const [open, setOpen] = useState(false);
  const [fresh, setFresh] = useState<AudioDevice | null>(null);
  const [named, setNamed] = useState(false);
  const [defaults, setDefaults] = useState<SystemDefaults>({});
  const known = useRef<Set<string> | null>(null);
  const loadedRef = useRef(false);

  const refresh = useCallback(async (): Promise<AudioDevice[]> => {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    let list: AudioDevice[] = [];
    try { const raw = await navigator.mediaDevices.enumerateDevices(); list = toDevices(raw); setDefaults(systemDefaults(raw)); } catch { /* nothing to list */ }
    setDevices(list);
    setNamed(list.length > 0);
    if (known.current && list.length > 0) {
      const added = newDevices(known.current, list);
      // Not while a take is being recorded: a popup there could cost a recording
      if (added.length > 0 && !audioRecorder.getIsRecording()) { setFresh(added[0]); setOpen(true); }
    }
    if (list.length > 0) known.current = new Set(list.map((d) => d.id));
    return list;
  }, []);

  // Device names appear only once the microphone is allowed, so this asks (the person pressed a button for it)
  const requestAccess = useCallback(async () => {
    try { const s = await navigator.mediaDevices.getUserMedia({ audio: true }); s.getTracks().forEach((t) => t.stop()); } catch { /* blocked: the list stays empty */ }
    await refresh();
  }, [refresh]);

  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    void (async () => {
      const list = await refresh();
      const last = readSig();
      if (list.length === 0 ? last === null : shouldOpenOnLoad(list, last, loadRecordingDeviceSettings().deviceId)) setOpen(true);
    })();
    const md = navigator.mediaDevices;
    const onChange = () => void refresh();
    const onOpen = () => { setFresh(null); setOpen(true); void refresh(); };
    md?.addEventListener?.('devicechange', onChange);
    window.addEventListener('uuda:open-devices', onOpen);
    return () => { md?.removeEventListener?.('devicechange', onChange); window.removeEventListener('uuda:open-devices', onOpen); };
  }, [refresh]);

  const close = useCallback(() => {
    setOpen(false);
    setFresh(null);
    writeSig(signature(devices));
  }, [devices]);

  return { devices, defaults, open, fresh, named, close, requestAccess };
};
