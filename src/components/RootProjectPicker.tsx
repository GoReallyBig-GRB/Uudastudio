import React from 'react';
import { FileAudio } from 'lucide-react';
import { Button, ModalShell } from './ui';

export interface RootProjectChoice {
  name: string;
}

interface Props {
  open: boolean;
  folderName: string;
  choices: RootProjectChoice[];
  onPick: (index: number) => void;
  onClose: () => void;
}

/** List of the .uuda projects found in the Uuda Studio folder. Replaces window.prompt, which sandboxed frames block. */
export const RootProjectPicker: React.FC<Props> = ({ open, folderName, choices, onPick, onClose }) => (
  <ModalShell
    open={open}
    onClose={onClose}
    title="Open from Uuda Studio folder"
    description={`Projects found in “${folderName}”`}
    size="sm"
    footer={<Button variant="secondary" onClick={onClose}>Cancel</Button>}
  >
    <ul className="flex flex-col gap-1.5">
      {choices.map((choice, index) => (
        <li key={choice.name}>
          <button
            type="button"
            onClick={() => onPick(index)}
            className="flex w-full items-center gap-3 rounded-control border border-line bg-surface-2 px-3 py-2.5 text-left text-sm text-ink hover:border-accent hover:bg-surface-3 cursor-pointer"
          >
            <FileAudio className="h-4 w-4 shrink-0 text-accent" />
            <span className="truncate">{choice.name.replace(/\.uuda$/i, '')}</span>
          </button>
        </li>
      ))}
    </ul>
  </ModalShell>
);
