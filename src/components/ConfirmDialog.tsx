/**
 * A blocking message the user has to answer. Unlike a toast it stays until OK (or Cancel) is pressed, and nothing behind it
 * can be clicked. Built on ModalShell. Escape counts as Cancel (or as OK when there is no Cancel); clicking outside does nothing.
 */

import React, { useEffect } from 'react';
import { Button, ModalShell } from './ui';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  /** Optional second paragraph, shown smaller */
  detail?: string;
  confirmLabel?: string;
  /** Pass null for a notice that only needs OK */
  cancelLabel?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  open,
  title,
  message,
  detail,
  confirmLabel = 'OK',
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
}) => {
  const hasCancel = cancelLabel !== null;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      if (hasCancel) onCancel();
      else onConfirm();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, hasCancel, onCancel, onConfirm]);

  return (
    <ModalShell
      open={open}
      onClose={hasCancel ? onCancel : onConfirm}
      title={title}
      size="sm"
      dismissible={false}
      footer={
        <>
          {hasCancel && (
            <Button variant="ghost" onClick={onCancel}>
              {cancelLabel}
            </Button>
          )}
          <Button variant="primary" onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className="text-sm leading-relaxed text-ink">{message}</p>
      {detail && <p className="mt-3 text-xs leading-relaxed text-ink-dim">{detail}</p>}
    </ModalShell>
  );
};
