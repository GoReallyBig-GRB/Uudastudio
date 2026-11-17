import React, { useEffect, useState } from 'react';
import { Cable, Check, FolderOpen, HardDrive, Headphones, Keyboard, SlidersHorizontal } from 'lucide-react';
import { Button, ModalShell } from '../components/ui';
import { AudioDevicesSheet } from '../components/AudioDevicesSheet';
import { useAudioDevices } from '../audio/useAudioDevices';
import { audioEngine } from '../audio/engine';
import { authService } from '../services/authService';
import { canUseStudioFolder, getStudioFolder, studioFolderLabel } from '../jobs/studioFolder';
import { useFreesound } from '../hooks/useFreesound';
import { clearAllProjectData } from '../storage/db';
import { shortcutGroups } from './shortcuts';
import { formatBytes, keepStorage, readStorage, type StorageUse } from './storageInfo';

export type SettingsTab = 'general' | 'devices' | 'shortcuts' | 'storage' | 'connections';

interface Props {
  open: boolean;
  onClose: () => void;
  autoRefresh: boolean;
  onToggleAutoRefresh: () => void;
  ducking: boolean;
  duckingDb: number;
  onToggleDucking: () => void;
  onUpdateDuckingDb: (db: number) => void;
  onClearSession: () => void;
}

const TABS: ReadonlyArray<{ id: SettingsTab; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: 'general', label: 'General', icon: SlidersHorizontal },
  { id: 'devices', label: 'Devices', icon: Headphones },
  { id: 'shortcuts', label: 'Shortcuts', icon: Keyboard },
  { id: 'storage', label: 'Storage', icon: HardDrive },
  { id: 'connections', label: 'Connections', icon: Cable },
];

const Toggle: React.FC<{ on: boolean; onClick: () => void; label: string }> = ({ on, onClick, label }) => (
  <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={onClick}
    className={`h-5 w-9 shrink-0 cursor-pointer rounded-full p-0.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 ${on ? 'bg-accent' : 'bg-surface-3'}`}>
    <span className={`block h-4 w-4 rounded-full bg-white transition-transform ${on ? 'translate-x-4' : 'translate-x-0'}`} />
  </button>
);

const Row: React.FC<{ title: string; hint?: string; children: React.ReactNode }> = ({ title, hint, children }) => (
  <div className="flex items-center justify-between gap-4 border-b border-line py-3 last:border-b-0">
    <div className="min-w-0"><div className="text-sm font-medium text-ink">{title}</div>{hint && <div className="text-xs text-ink-dim">{hint}</div>}</div>
    <div className="shrink-0">{children}</div>
  </div>
);

const Heading: React.FC<{ title: string; hint?: string }> = ({ title, hint }) => (
  <div className="mb-3"><h3 className="text-base font-semibold text-ink">{title}</h3>{hint && <p className="mt-0.5 text-xs text-ink-dim">{hint}</p>}</div>
);

const DevicesTab: React.FC = () => {
  const d = useAudioDevices();
  return (
    <div>
      <Heading title="Devices" hint="Pick the microphone you record with and where you listen. Mixers, interfaces and DJ decks are recognised by name; if one shows up as a generic USB device, tell Uuda what it is with the dropdown beside it." />
      <AudioDevicesSheet inline open onClose={() => undefined} devices={d.devices} defaults={d.defaults} fresh={null} named={d.named} requestAccess={d.requestAccess} />
    </div>
  );
};

const ShortcutsTab: React.FC = () => (
  <div>
    <Heading title="Keyboard shortcuts" hint="These work anywhere in the editor except while you are typing in a text box." />
    <div className="grid gap-x-8 gap-y-5 md:grid-cols-2">
      {shortcutGroups().map((g) => (
        <section key={g.title} aria-label={g.title}>
          <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{g.title}</h4>
          <ul>
            {g.items.map((s) => (
              <li key={s.keys.join('+')} className="flex items-center justify-between gap-3 border-b border-line py-1.5 last:border-b-0">
                <span className="text-sm text-ink-dim">{s.does}</span>
                <span className="flex shrink-0 gap-1">{s.keys.map((k) => <kbd key={k} className="rounded border border-line-strong bg-surface-3 px-1.5 py-0.5 font-num text-[11px] text-ink">{k}</kbd>)}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  </div>
);

const StorageTab: React.FC = () => {
  const [use, setUse] = useState<StorageUse | null>(null);
  const [folder, setFolder] = useState('');
  const [msg, setMsg] = useState('');
  const [confirmWipe, setConfirmWipe] = useState(false);
  const [wiping, setWiping] = useState(false);
  const folderOk = canUseStudioFolder();
  const wipe = async () => {
    setWiping(true);
    try {
      await clearAllProjectData(); // saved projects, audio and long audio files
      try { // temporary copies kept by the browser; the voice samples stay because they cost quota to make again
        for (const name of await caches.keys()) if (!name.startsWith('uuda-voice-auditions')) await caches.delete(name);
      } catch { /* no cache storage here */ }
      try { // the session pointers and recovery flags only; every preference and connection key is left alone
        for (const k of ['uuda:restore-pending', 'uuda_project_session_id']) { window.localStorage.removeItem(k); window.sessionStorage.removeItem(k); }
      } catch { /* storage blocked */ }
      window.location.reload();
    } catch {
      setWiping(false);
      setMsg('Something stopped the clean-up. Close other Uuda tabs and try again.');
    }
  };
  useEffect(() => { void readStorage().then(setUse); void studioFolderLabel().then(setFolder); }, []);
  const chooseFolder = async () => {
    setMsg('');
    try { const dir = await getStudioFolder({ ask: true, choose: true }); if (dir) setFolder(await studioFolderLabel()); } catch { setMsg('That folder could not be used. Try another one.'); }
  };
  const keep = async () => { const ok = await keepStorage(); setMsg(ok ? 'Done. The browser will keep your saved work.' : 'The browser did not agree. It decides this itself; installing Uuda as an app or using it often usually helps.'); setUse(await readStorage()); };
  return (
    <div>
      <Heading title="Storage" hint="Where your work lives." />
      <Row title="Autosave" hint="Your session is saved in this browser as you work.">
        <span className="flex items-center gap-1 text-sm text-ok"><Check className="h-4 w-4" />Active</span>
      </Row>
      <Row title="Uuda folder" hint={folder ? `Projects, recordings and exports are saved in "${folder}".` : folderOk ? 'Not chosen yet. Until you choose one, files go to your Downloads folder.' : 'This browser cannot save into a folder, so files go to your Downloads folder. Chrome, Brave or Edge can.'}>
        {folderOk && <Button size="sm" variant="secondary" leftIcon={<FolderOpen className="h-3.5 w-3.5" />} onClick={() => { void chooseFolder(); }}>{folder ? 'Change folder' : 'Choose folder'}</Button>}
      </Row>
      <Row title="Browser space" hint={use ? `${formatBytes(use.used)} used of about ${formatBytes(use.quota)} available to Uuda in this browser.` : 'This browser does not say how much room is used.'}>
        {use?.persistent === true ? <span className="flex items-center gap-1 text-sm text-ok"><Check className="h-4 w-4" />Protected</span>
          : use?.persistent === false ? <Button size="sm" variant="secondary" onClick={() => { void keep(); }}>Keep my work safe</Button> : null}
      </Row>
      {msg && <p role="status" className="mt-2 text-xs text-ink-dim">{msg}</p>}
      <div className="pt-4">
        {!confirmWipe ? (
          <Button variant="secondary" size="md" onClick={() => setConfirmWipe(true)} className="border-danger/40 text-danger">Clear browser and reset</Button>
        ) : (
          <div role="alertdialog" aria-label="Confirm clear browser and reset" className="rounded-card border border-danger/40 bg-surface-2 p-3">
            <p className="text-sm text-ink">Delete every project and recording kept in this browser, including long audio?</p>
            <p className="mt-1 text-xs text-ink-dim">Anything you have not saved to a .uuda file is gone for good. Your connections (Gemini, Freesound, your account) and your settings stay as they are. Uuda reloads afterwards.</p>
            <div className="mt-3 flex gap-2">
              <Button size="sm" variant="secondary" disabled={wiping} onClick={() => { void wipe(); }} className="border-danger/40 text-danger">{wiping ? 'Clearing…' : 'Yes, clear it'}</Button>
              <Button size="sm" variant="secondary" disabled={wiping} onClick={() => setConfirmWipe(false)}>Cancel</Button>
            </div>
          </div>
        )}
        <p className="mt-1.5 text-xs text-ink-faint">Frees the space Uuda uses here. Saved .uuda files on your computer are not touched.</p>
      </div>
    </div>
  );
};

const ConnectionsTab: React.FC = () => {
  const [key, setKey] = useState(Boolean(authService.getOwnGeminiKey()));
  const fs = useFreesound();
  const [fsOn, setFsOn] = useState(false);
  const [fsMsg, setFsMsg] = useState('');
  useEffect(() => { fetch('/api/freesound/config').then((r) => r.json()).then((d) => setFsOn(Boolean(d.enabled))).catch(() => setFsOn(false)); }, []);
  const connectFreesound = async () => {
    setFsMsg('');
    const url = await fs.fetchAuthUrl();
    if (url) { window.open(url, '_blank', 'noopener'); setFsMsg('Finish connecting in the Freesound tab, then come back here.'); }
    else setFsMsg('Could not start the connection. Sign in to Uuda first, then try again.');
  };
  useEffect(() => { const on = () => setKey(Boolean(authService.getOwnGeminiKey())); window.addEventListener('uuda:auth-changed', on); return () => window.removeEventListener('uuda:auth-changed', on); }, []);
  return (
    <div>
      <Heading title="Connections" hint="Services Uuda uses for you." />
      <Row title="Gemini voice" hint={key ? 'Connected. Voiceovers use your own free Gemini quota.' : 'Not connected. Connect your free Gemini key to make AI voiceovers.'}>
        {key
          ? <Button size="sm" variant="secondary" onClick={() => { authService.setOwnGeminiKey(null); setKey(false); }}>Disconnect</Button>
          : <Button size="sm" variant="secondary" onClick={() => window.dispatchEvent(new CustomEvent('uuda:need-gemini-key'))}>Connect</Button>}
      </Row>
      {fsOn && (
        <Row title="Freesound" hint={fs.userToken ? 'Connected. Sounds you add use your own Freesound account.' : 'Not connected. Connect to add Freesound sounds to your timeline.'}>
          {fs.userToken
            ? <Button size="sm" variant="secondary" onClick={() => { void fs.disconnect(); }}>Disconnect</Button>
            : <Button size="sm" variant="secondary" onClick={() => { void connectFreesound(); }}>Connect</Button>}
        </Row>
      )}
      {fsMsg && <p role="status" className="mt-2 text-xs text-ink-dim">{fsMsg}</p>}
      <p className="mt-3 text-xs text-ink-faint">Your account details are in your dashboard.</p>
    </div>
  );
};

export const SettingsWindow: React.FC<Props> = ({ open, onClose, autoRefresh, onToggleAutoRefresh, ducking, duckingDb, onToggleDucking, onUpdateDuckingDb, onClearSession }) => {
  const [tab, setTab] = useState<SettingsTab>('general');
  useEffect(() => { if (open) { const t = window.localStorage.getItem('uuda_settings_tab') as SettingsTab | null; if (t && TABS.some((x) => x.id === t)) setTab(t); } }, [open]);
  const pick = (t: SettingsTab) => { setTab(t); try { window.localStorage.setItem('uuda_settings_tab', t); } catch { /* the tab is just not remembered */ } };

  return (
    <ModalShell open={open} onClose={onClose} title="Studio Settings" size="lg">
      <div className="flex min-h-[420px] flex-col gap-4 md:flex-row md:gap-6">
        <nav aria-label="Settings sections" className="flex shrink-0 gap-1 overflow-x-auto md:w-44 md:flex-col md:overflow-visible">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button key={id} type="button" aria-current={tab === id ? 'page' : undefined} onClick={() => pick(id)}
              className={`flex cursor-pointer items-center gap-2.5 whitespace-nowrap rounded-control px-3 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 ${tab === id ? 'bg-surface-3 font-medium text-ink' : 'text-ink-dim hover:bg-white/5 hover:text-ink'}`}>
              <Icon className={`h-4 w-4 ${tab === id ? 'text-accent' : ''}`} />{label}
            </button>
          ))}
        </nav>
        <div className="min-w-0 flex-1">
          {tab === 'general' && (
            <div>
              <Heading title="General" />
              <Row title="Auto-refresh" hint="Repaint the timeline as soon as you edit."><Toggle on={autoRefresh} onClick={onToggleAutoRefresh} label="Auto-refresh" /></Row>
              <Row title="Duck playing tracks" hint="Lower other tracks while another plays."><Toggle on={ducking} onClick={onToggleDucking} label="Duck playing tracks" /></Row>
              {ducking && (
                <div className="border-b border-line py-3">
                  <div className="mb-1 flex justify-between text-xs text-ink-dim"><span>Ducking amount</span><span className="font-num font-semibold text-accent">{duckingDb} dB</span></div>
                  <input type="range" min={-24} max={-3} step={1} value={duckingDb} aria-label="Ducking amount in decibels" onChange={(e) => onUpdateDuckingDb(parseInt(e.target.value, 10))} className="h-1 w-full cursor-pointer appearance-none rounded bg-surface-3" />
                </div>
              )}
              <Row title="Audio engine" hint="Sample rate and latency the browser gave Uuda."><span className="font-num text-sm text-ink">{audioEngine.getSampleRate()} Hz · interactive</span></Row>
              <div className="pt-4">
                <Button variant="secondary" size="md" onClick={() => { onClose(); onClearSession(); }} className="border-danger/40 text-danger">Clear session and reset</Button>
                <p className="mt-1.5 text-xs text-ink-faint">Removes everything from the timeline.</p>
              </div>
            </div>
          )}
          {tab === 'devices' && <DevicesTab />}
          {tab === 'shortcuts' && <ShortcutsTab />}
          {tab === 'storage' && <StorageTab />}
          {tab === 'connections' && <ConnectionsTab />}
        </div>
      </div>
    </ModalShell>
  );
};
