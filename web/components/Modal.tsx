'use client';

import { useState, useEffect, useCallback, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';

const EASE_OUT = [0.22, 1, 0.36, 1] as const;

type ChildrenInput = ReactNode | ((close: () => void) => ReactNode);

export default function Modal({
  onClose,
  children,
  panelClass = '',
  dismissOnBackdrop = true,
}: {
  onClose: () => void;
  children: ChildrenInput;
  panelClass?: string;
  dismissOnBackdrop?: boolean;
}) {
  const [open, setOpen] = useState(true);
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);

  return createPortal(
    <AnimatePresence onExitComplete={onClose}>
      {open && (
        <motion.div
          className="fixed inset-0 z-[60] grid place-items-center p-6 bg-black/60"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.14 }}
          onClick={dismissOnBackdrop ? close : undefined}
        >
          <motion.div
            className={panelClass}
            onClick={e => e.stopPropagation()}
            initial={{ opacity: 0, y: 10, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.2, ease: EASE_OUT }}
          >
            {typeof children === 'function' ? children(close) : children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
