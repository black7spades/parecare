import React, { useEffect } from 'react';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  /** Wider dialog for editors and pickers. */
  wide?: boolean;
  children: React.ReactNode;
}

export function Modal({ open, onClose, title, wide, children }: ModalProps) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (open) document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />
      <div className={`relative bg-card rounded-lg shadow-xl ${wide ? 'max-w-3xl' : 'max-w-md'} w-full p-6 focus:outline-none max-h-[calc(100vh-2rem)] overflow-y-auto`} role="dialog" aria-modal="true" aria-labelledby={title ? 'modal-title' : undefined}>
        {title ? (
          <h2 id="modal-title" className="text-lg font-semibold mb-4">{title}</h2>
        ) : null}
        {children}
      </div>
    </div>
  );
}
