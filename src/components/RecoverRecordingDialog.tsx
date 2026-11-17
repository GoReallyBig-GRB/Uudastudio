/** Offered at start-up when a recording was cut short (crash, closed tab, flat battery): everything written up to the last second is still on disk. */
import React, { useState } from 'react';
import { Button, ModalShell } from './ui';
import { recoverRecording, type UnfinishedRecording } from '../audio/diskRecorder';
import { deleteStreamedAsset } from '../assets/streamedStore';
import { audioRecorder, type RecordedTake } from '../audio/recorder';

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

interface Props {
  items: UnfinishedRecording[];
  onClose: () => void;
  /** Adds the recovered take to the project */
  onRecovered: (take: RecordedTake, name: string) => void;
}

export const RecoverRecordingDialog: React.FC<Props> = ({ items, onClose, onRecovered }) => {
  const [left, setLeft] = useState(items);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const drop = (id: string) => setLeft((l) => { const n = l.filter((x) => x.journal.storeId !== id); if (n.length === 0) setTimeout(onClose, 0); return n; });

  const recover = async (u: UnfinishedRecording) => {
    setBusy(u.journal.storeId); setError('');
    try {
      const take = await audioRecorder.toTake(await recoverRecording(u));
      onRecovered(take, `${u.journal.name || 'Recording'} (Recovered)`);
      drop(u.journal.storeId);
    } catch (e) { setError(e instanceof Error ? e.message : 'This recording could not be recovered.'); }
    finally { setBusy(null); }
  };
  const discard = async (u: UnfinishedRecording) => { await deleteStreamedAsset(u.journal.storeId); drop(u.journal.storeId); };

  return (
    <ModalShell open onClose={onClose} title="Recover your recording" size="md">
      <p className="text-sm text-ink-dim">Uuda found {left.length === 1 ? 'a recording' : 'recordings'} that stopped before it was finished. The audio up to the last second is safe.</p>
      <ul className="mt-3 divide-y divide-line rounded-control border border-line">
        {left.map((u) => (
          <li key={u.journal.storeId} className="flex items-center justify-between gap-3 px-3 py-2.5">
            <span className="min-w-0 text-sm text-ink">{u.journal.name}<span className="ml-2 text-xs text-ink-faint">{clock(u.seconds)} · {new Date(u.journal.startedAt).toLocaleString()}</span></span>
            <span className="flex shrink-0 gap-2">
              <Button size="sm" variant="primary" disabled={busy !== null} onClick={() => { void recover(u); }}>{busy === u.journal.storeId ? 'Recovering…' : 'Recover'}</Button>
              <Button size="sm" variant="secondary" disabled={busy !== null} onClick={() => { void discard(u); }}>Discard</Button>
            </span>
          </li>
        ))}
      </ul>
      {error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
      <div className="mt-4 flex justify-end"><Button size="sm" variant="secondary" onClick={onClose}>Decide later</Button></div>
    </ModalShell>
  );
};
