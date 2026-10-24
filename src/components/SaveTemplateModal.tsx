/**
 * Uuda Studio - Save as template.
 * Saves the structure of the open project (tracks, effects, ducking) as a small file. No audio is included.
 */

import React, { useEffect, useState } from 'react';
import { LayoutTemplate, X, Download, Cloud } from 'lucide-react';

interface SaveTemplateModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultName: string;
  trackCount: number;
  pluginCount: number;
  /** Signed in: the template can also be kept on the user's account */
  signedIn: boolean;
  onSave: (meta: { name: string; description: string; tags: string[]; toFile: boolean; toAccount: boolean }) => void;
}

export const SaveTemplateModal: React.FC<SaveTemplateModalProps> = ({ isOpen, onClose, defaultName, trackCount, pluginCount, signedIn, onSave }) => {
  const [name, setName] = useState(defaultName);
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('');
  const [toFile, setToFile] = useState(true);
  const [toAccount, setToAccount] = useState(true);

  useEffect(() => {
    if (isOpen) {
      setName(defaultName);
      setDescription('');
      setTags('');
      setToFile(true);
      setToAccount(true);
    }
  }, [isOpen, defaultName]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const account = signedIn && toAccount;
    if (!name.trim() || (!toFile && !account)) return;
    onSave({
      name: name.trim(),
      description: description.trim(),
      tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
      toFile,
      toAccount: account,
    });
  };

  const field = 'w-full bg-[#09090D] border border-zinc-700 rounded-sm px-2.5 py-1.5 text-xs text-zinc-100 focus:outline-none focus:border-cyan-500';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-2 sm:p-4 select-none">
      <form
        onSubmit={submit}
        role="dialog"
        aria-modal="true"
        aria-label="Save as template"
        className="w-full max-w-md max-h-[calc(100dvh-1rem)] overflow-y-auto bg-[#101016] border border-zinc-700 rounded-lg text-xs text-zinc-200"
      >
        <div className="flex items-center gap-3 px-4 py-3 border-b border-zinc-800 bg-[#13131D]">
          <div className="w-8 h-8 rounded-sm bg-cyan-500/15 border border-cyan-500/40 flex items-center justify-center text-cyan-300 shrink-0">
            <LayoutTemplate className="w-4 h-4" />
          </div>
          <h2 className="flex-1 text-sm font-black uppercase tracking-wide text-white">Save as template</h2>
          <button type="button" onClick={onClose} aria-label="Close" title="Close" className="p-1.5 rounded-sm text-zinc-400 hover:text-white hover:bg-zinc-800 cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-3">
          <label className="block">
            <span className="text-[11px] text-zinc-400">Name</span>
            <input autoFocus value={name} maxLength={80} onChange={(e) => setName(e.target.value)} className={field} />
          </label>
          <label className="block">
            <span className="text-[11px] text-zinc-400">Description (optional)</span>
            <textarea value={description} maxLength={300} rows={2} onChange={(e) => setDescription(e.target.value)} className={`${field} resize-none`} />
          </label>
          <label className="block">
            <span className="text-[11px] text-zinc-400">Tags, separated by commas (optional)</span>
            <input value={tags} maxLength={120} onChange={(e) => setTags(e.target.value)} className={field} />
          </label>
          <fieldset className="space-y-1.5">
            <legend className="text-[11px] text-zinc-400 mb-1">Where to save it</legend>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={toFile} onChange={(e) => setToFile(e.target.checked)} />
              <Download className="w-3.5 h-3.5 text-zinc-400" />
              <span>Download a template file</span>
            </label>
            <label className={`flex items-center gap-2 ${signedIn ? 'cursor-pointer' : 'opacity-60'}`}>
              <input type="checkbox" disabled={!signedIn} checked={signedIn && toAccount} onChange={(e) => setToAccount(e.target.checked)} />
              <Cloud className="w-3.5 h-3.5 text-zinc-400" />
              <span>Save to my account{signedIn ? '' : ' (sign in to use this)'}</span>
            </label>
          </fieldset>
          <p className="text-[11px] text-zinc-500">
            Saves {trackCount} {trackCount === 1 ? 'track' : 'tracks'}, {pluginCount} {pluginCount === 1 ? 'plugin' : 'plugins'}, volumes, pan and auto-duck settings. No audio is saved.
          </p>
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-zinc-800">
          <button type="button" onClick={onClose} className="px-3 py-1.5 rounded-sm text-zinc-400 hover:text-white hover:bg-zinc-800 cursor-pointer">
            Cancel
          </button>
          <button
            type="submit"
            disabled={!name.trim() || trackCount === 0 || (!toFile && !(signedIn && toAccount))}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-sm bg-cyan-500 hover:bg-cyan-400 text-black font-bold cursor-pointer disabled:opacity-40 disabled:cursor-default"
          >
            <Download className="w-3.5 h-3.5" />
            Save template
          </button>
        </div>
      </form>
    </div>
  );
};
