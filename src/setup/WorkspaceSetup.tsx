/** First-run panel: "Set up your Uuda Workspace". Browser advice and install, microphone access, audio devices and the Uuda folder. */
import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Check, Download, FolderOpen, Headphones, Mic, Monitor } from 'lucide-react';
import { Button, Logo } from '../components/ui';
import { detectBrowser } from './browserSupport';
import { installApp, isRunningAsApp, useCanInstallApp } from '../pwa/install';
import { canUseStudioFolder, getStudioFolder, studioFolderLabel } from '../jobs/studioFolder';
import type { AudioDevice } from '../audio/deviceWatch';

const DONE_KEY = 'uuda_workspace_setup_v1';
export const isSetupDone = (): boolean => { try { return localStorage.getItem(DONE_KEY) === 'yes'; } catch { return true; } };
export const markSetupDone = (): void => { try { localStorage.setItem(DONE_KEY, 'yes'); } catch { /* asked again next time */ } };
export const OPEN_SETUP_EVENT = 'uuda:open-setup';

interface Props {
  devices: AudioDevice[];
  named: boolean;
  requestAccess: () => Promise<void>;
  onChooseDevices: () => void;
  onDone: () => void;
}

type Tone = 'ok' | 'warn' | 'todo';
const Row: React.FC<{ icon: React.ReactNode; title: string; tone: Tone; status: string; children?: React.ReactNode }> = ({ icon, title, tone, status, children }) => (
  <li className="flex items-start gap-4 rounded-card border border-line bg-surface-2 p-4">
    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-surface-1 text-accent">{icon}</span>
    <div className="min-w-0 flex-1">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        <span className={`inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold ${tone === 'ok' ? 'text-ok' : tone === 'warn' ? 'text-warn' : 'text-ink-faint'}`}>
          {tone === 'ok' ? <Check className="h-3.5 w-3.5" /> : tone === 'warn' ? <AlertCircle className="h-3.5 w-3.5" /> : null}{status}
        </span>
      </div>
      {children}
    </div>
  </li>
);

export const WorkspaceSetup: React.FC<Props> = ({ devices, named, requestAccess, onChooseDevices, onDone }) => {
  const browser = useMemo(() => detectBrowser(navigator as never), []);
  const canInstall = useCanInstallApp();
  const asApp = isRunningAsApp();
  const folderOk = canUseStudioFolder();
  const [folder, setFolder] = useState('');
  const [folderMsg, setFolderMsg] = useState('');
  const [asking, setAsking] = useState(false);
  useEffect(() => { void studioFolderLabel().then(setFolder); }, []);

  const mics = devices.filter((d) => d.direction === 'input');
  const outs = devices.filter((d) => d.direction === 'output');
  const micReady = named && mics.length > 0;

  const chooseFolder = async () => {
    setFolderMsg('');
    try { const dir = await getStudioFolder({ ask: true, choose: true }); if (dir) setFolder(await studioFolderLabel()); }
    catch { setFolderMsg('That folder could not be used. Try another one.'); }
  };

  return (
    <div className="fixed inset-0 z-[60] overflow-y-auto bg-surface-0 antialiased" role="dialog" aria-modal="true" aria-labelledby="setup-title">
      <div className="mx-auto flex min-h-full max-w-2xl flex-col justify-center px-5 py-10">
        <div className="mb-7 text-center">
          <Logo variant="full" className="mx-auto mb-5 h-20" />
          <h1 id="setup-title" className="text-2xl font-bold tracking-tight text-ink">Set up your Uuda Workspace</h1>
          <p className="mt-1.5 text-sm text-ink-dim">Four quick checks so recording, saving and playback just work.</p>
        </div>

        <ul className="flex flex-col gap-3">
          <Row icon={<Monitor className="h-5 w-5" />} title="Browser" tone={asApp || browser.best ? 'ok' : 'warn'} status={asApp ? 'Installed app' : browser.best ? 'Best experience' : 'Works, not at its best'}>
            <p className="mt-1 text-xs text-ink-dim">
              {browser.best || asApp ? `You are in ${asApp ? 'the Uuda app' : browser.name}. ` : `You are in ${browser.name}. `}
              Uuda works best in Chrome, Brave, Edge or any Chromium browser.
            </p>
            {!asApp && canInstall && (
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <Button variant="primary" size="sm" onClick={() => { void installApp(); }} leftIcon={<Download className="h-4 w-4" />}>Install Uuda Studio</Button>
                <span className="text-[11px] text-ink-faint">Opens in its own window and your saved files open in it with a double-click.</span>
              </div>
            )}
          </Row>

          <Row icon={<Mic className="h-5 w-5" />} title="Microphone" tone={micReady ? 'ok' : 'todo'} status={micReady ? 'Allowed' : 'Not allowed yet'}>
            <p className="mt-1 text-xs text-ink-dim">{micReady ? `Ready: ${mics.find((m) => m.id === 'default')?.label || mics[0].label || 'microphone found'}.` : 'Allow the microphone so you can record. Nothing is recorded during this check.'}</p>
            {!micReady && <Button className="mt-3" variant="primary" size="sm" disabled={asking} onClick={async () => { setAsking(true); await requestAccess(); setAsking(false); }}>{asking ? 'Waiting for your browser...' : 'Allow microphone'}</Button>}
          </Row>

          <Row icon={<Headphones className="h-5 w-5" />} title="Audio devices" tone={micReady ? 'ok' : 'todo'} status={micReady ? `${mics.length} in, ${outs.length} out` : 'Allow the microphone first'}>
            <p className="mt-1 text-xs text-ink-dim">Pick the microphone to record with and where you listen. You can change this any time.</p>
            <Button className="mt-3" variant="secondary" size="sm" disabled={!micReady} onClick={onChooseDevices}>Choose devices</Button>
          </Row>

          <Row icon={<FolderOpen className="h-5 w-5" />} title="Uuda folder" tone={folder ? 'ok' : folderOk ? 'todo' : 'warn'} status={folder ? 'Chosen' : folderOk ? 'Not chosen' : 'Not supported here'}>
            <p className="mt-1 text-xs text-ink-dim">
              {folder ? `Projects, recordings and exports are saved in "${folder}".` : folderOk ? 'Choose where Uuda saves your projects, recordings and exports. Until then, files go to your Downloads folder.' : 'This browser cannot save into a folder, so files go to your Downloads folder. Chrome, Brave or Edge can.'}
            </p>
            {folderOk && <Button className="mt-3" variant="secondary" size="sm" onClick={() => { void chooseFolder(); }}>{folder ? 'Change folder' : 'Choose folder'}</Button>}
            {folderMsg && <p role="alert" className="mt-2 text-xs text-danger">{folderMsg}</p>}
          </Row>
        </ul>

        <div className="mt-7 flex flex-col items-center gap-3">
          <Button variant="primary" size="lg" className="w-full max-w-xs" onClick={onDone}>Start creating</Button>
          <button type="button" onClick={onDone} className="text-xs text-ink-faint underline-offset-4 hover:text-ink-dim hover:underline cursor-pointer">Skip for now</button>
        </div>
      </div>
    </div>
  );
};
