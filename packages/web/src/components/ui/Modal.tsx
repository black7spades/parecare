import React, { useEffect, useId, useRef } from 'react';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  /** Wider dialog for editors and pickers. */
  wide?: boolean;
  children: React.ReactNode;
}

/**
 * Open dialogs, newest last. A dialog opened over another (an upload over a
 * medicine, say) is the one Escape closes, and each reads out its own title:
 * every dialog has its own heading id, so a screen reader never reads the
 * window underneath.
 */
const openStack: string[] = [];

export function Modal({ open, onClose, title, wide, children }: ModalProps) {
  const id = useId();
  const titleId = `${id}-title`;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    openStack.push(id);
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && openStack[openStack.length - 1] === id) onCloseRef.current();
    };
    document.addEventListener('keydown', handler);
    return () => {
      document.removeEventListener('keydown', handler);
      const at = openStack.lastIndexOf(id);
      if (at >= 0) openStack.splice(at, 1);
    };
  }, [open, id]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />
      <div
        className={`relative bg-card rounded-lg shadow-xl ${wide ? 'max-w-3xl' : 'max-w-md'} w-full p-6 focus:outline-none max-h-[calc(100vh-2rem)] overflow-y-auto`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-label={title ? undefined : 'Dialog'}
      >
        {title ? (
          <h2 id={titleId} className="text-lg font-semibold mb-4">{title}</h2>
        ) : null}
        {children}
      </div>
    </div>
  );
}

/** A dialog is open, so a panel beneath it leaves Escape to the dialog. */
export const anyModalOpen = () => openStack.length > 0;
