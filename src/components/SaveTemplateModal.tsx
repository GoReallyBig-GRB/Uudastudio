/**
 * Uuda Studio - Save as template.
 * Saves the structure of the open project (tracks, effects, ducking) as a small file. No audio is included.
 * Built on the shared dialog frame: rounded panel, pill buttons, switches, tokens only.
 */

import React, { useEffect, useId, useState } from 'react';
import { Download, Cloud } from 'lucide-react';
import { Button, Input, ModalShell, Switch } from './ui';

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
  const formId = useId();
  const descId = useId();

  useEffect(() => {
    if (isOpen) {
      setName(defaultName);
      setDescription('');
      setTags('');
      setToFile(true);
      setToAccount(true);
    }
  }, [isOpen, defaultName]);

  const account = signedIn && toAccount;
  const canSave = !!name.trim() && trackCount > 0 && (toFile || account);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || (!toFile && !account)) return;
    onSave({
      name: name.trim(),
      description: description.trim(),
      tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
      toFile,
      toAccount: account,
    });
  };

  return (
    <ModalShell
      open={isOpen}
      onClose={onClose}
      title="Save as template"
      description="Keeps the structure of this project so you can start the next one from it."
      size="sm"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button variant="primary" size="sm" type="submit" form={formId} disabled={!canSave} leftIcon={<Download className="h-3.5 w-3.5" aria-hidden="true" />}>
            Save template
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="space-y-4">
        <Input label="Name" autoFocus value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
        <div>
          <label htmlFor={descId} className="mb-1.5 block text-xs font-medium text-ink-dim">Description (optional)</label>
          <textarea
            id={descId}
            value={description}
            maxLength={300}
            rows={2}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full resize-none rounded-control border border-line-strong bg-surface-3 px-3.5 py-2.5 text-sm text-ink placeholder:text-ink-faint transition-colors hover:border-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
          />
        </div>
        <Input label="Tags (optional)" hint="Separate with commas" value={tags} maxLength={120} onChange={(e) => setTags(e.target.value)} />

        <div role="group" aria-labelledby={`${formId}-where`} className="space-y-2.5 border-t border-line pt-4">
          <p id={`${formId}-where`} className="mb-2 text-xs font-medium text-ink-dim">Where to save it</p>
          <div className="flex items-center gap-2.5">
            <Download className="h-3.5 w-3.5 shrink-0 text-ink-faint" aria-hidden="true" />
            <Switch checked={toFile} onChange={setToFile} label="Download a template file" />
          </div>
          <div className="flex items-center gap-2.5">
            <Cloud className="h-3.5 w-3.5 shrink-0 text-ink-faint" aria-hidden="true" />
            <Switch checked={account} onChange={setToAccount} disabled={!signedIn} label={`Save to my account${signedIn ? '' : ' (sign in to use this)'}`} />
          </div>
        </div>

        <p className="text-xs text-ink-faint">
          Saves {trackCount} {trackCount === 1 ? 'track' : 'tracks'}, {pluginCount} {pluginCount === 1 ? 'plugin' : 'plugins'}, volumes, pan and auto-duck settings. No audio is saved.
        </p>
      </form>
    </ModalShell>
  );
};
