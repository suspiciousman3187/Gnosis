'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { GearSetCard } from '@/components/GearSets';
import type { GearLogEntry } from '@/lib/types';

export default function GearReveal({ entry, changed }: { entry: GearLogEntry; changed?: boolean }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      const W = 380;
      const left = Math.min(Math.max(8, r.left), window.innerWidth - W - 8);
      const top = Math.min(r.bottom + 4, window.innerHeight - 360);
      setPos({ top, left });
    }
    setOpen(o => !o);
  };

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('scroll', close, true); window.removeEventListener('resize', close); window.removeEventListener('keydown', onKey); };
  }, [open]);

  return (
    <>
      <button
        ref={btnRef}
        onClick={toggle}
        data-tooltip={changed ? 'View gear for this cast (changed from previous)' : 'View gear snapshotted for this cast'}
        className={`ml-1.5 inline-flex items-center justify-center w-5 h-5 rounded-md border align-middle transition-colors ${changed ? 'border-amber-500/60 bg-amber-500/20 text-amber-300 hover:bg-amber-500/30' : 'border-white/15 bg-white/[0.05] text-gray-300 hover:text-white hover:border-white/30'}`}
      >
        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M9 3l-6 3 1.5 3.5L7 8.5V21h10V8.5l2.5 1L21 6l-6-3a3 3 0 0 1-6 0z" />
        </svg>
      </button>
      {open && pos && createPortal(
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div style={{ position: 'fixed', top: pos.top, left: pos.left, width: 380, zIndex: 50, maxHeight: '75vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()} className="bg-gray-900 rounded-lg shadow-2xl ring-1 ring-black/40">
            <GearSetCard set={{ type: entry.type, name: entry.name, gear: entry.gear, precast: entry.precast, count: 1 }} />
          </div>
        </>,
        document.body,
      )}
    </>
  );
}
