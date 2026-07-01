'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'motion/react';
import { subscribeDialogs, resolveDialog, type DialogSpec, type DialogTone } from '@/lib/dialogs';

const TONE_BORDER: Record<DialogTone, string> = {
  info: 'border-accent/40',
  warn: 'border-amber-500/40',
  danger: 'border-rose-500/40',
  success: 'border-emerald-500/40',
};
const TONE_ACCENT: Record<DialogTone, string> = {
  info: 'text-accent',
  warn: 'text-amber-200',
  danger: 'text-rose-200',
  success: 'text-emerald-200',
};

function DialogPanel({ dlg }: { dlg: DialogSpec }) {
  const [value, setValue] = useState(dlg.input?.defaultValue ?? '');
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const firstBtnRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (dlg.input && inputRef.current) {
      inputRef.current.focus();
      if ('select' in inputRef.current) inputRef.current.select();
    } else if (firstBtnRef.current) {
      firstBtnRef.current.focus();
    }
  }, [dlg.id, dlg.input]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        const cancel = dlg.buttons.find(b => b.value === 'cancel');
        resolveDialog(dlg.id, { button: cancel ? cancel.value : 'cancel' });
      } else if (e.key === 'Enter' && !dlg.input?.multiline) {
        const primary = dlg.buttons.find(b => b.autoFocus) ?? dlg.buttons[dlg.buttons.length - 1];
        resolveDialog(dlg.id, { button: primary.value, value: dlg.input ? value : undefined });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dlg, value]);

  const click = (btnValue: string) => {
    resolveDialog(dlg.id, { button: btnValue, value: dlg.input ? value : undefined });
  };

  return (
    <motion.div
      className="fixed inset-0 z-[10000] flex items-center justify-center px-6 py-12"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.14 }}
    >
      <div className="absolute inset-0 bg-black/65 backdrop-blur-sm" onClick={() => click(dlg.buttons.find(b => b.value === 'cancel')?.value ?? 'cancel')} />
      <motion.div
        className={`relative w-full max-w-md bg-zinc-950/95 border ${TONE_BORDER[dlg.tone]} rounded-xl shadow-2xl px-5 py-4`}
        initial={{ opacity: 0, y: 10, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
      >
        {dlg.title && (
          <div className={`text-sm font-bold uppercase tracking-wider mb-2 ${TONE_ACCENT[dlg.tone]}`}>{dlg.title}</div>
        )}
        <div className="text-sm text-gray-200 whitespace-pre-wrap leading-relaxed">{dlg.message}</div>
        {dlg.input && (
          <label className="block mt-3">
            {dlg.input.label && <span className="text-[11px] text-gray-400">{dlg.input.label}</span>}
            {dlg.input.multiline ? (
              <textarea
                ref={el => { inputRef.current = el; }}
                value={value}
                onChange={e => setValue(e.target.value)}
                placeholder={dlg.input.placeholder}
                rows={4}
                className="mt-1 w-full text-sm bg-black/40 border border-white/10 rounded px-2.5 py-1.5 text-gray-100 placeholder:text-gray-400 focus:outline-none focus:border-accent/60 resize-y"
              />
            ) : (
              <input
                ref={el => { inputRef.current = el; }}
                value={value}
                onChange={e => setValue(e.target.value)}
                placeholder={dlg.input.placeholder}
                className="mt-1 w-full text-sm bg-black/40 border border-white/10 rounded px-2.5 py-1.5 text-gray-100 placeholder:text-gray-400 focus:outline-none focus:border-accent/60"
              />
            )}
          </label>
        )}
        <div className="flex items-center justify-end gap-2 mt-4">
          {dlg.buttons.map((b, i) => {
            const cls =
              b.tone === 'primary' ? 'bg-accent text-zinc-950 font-semibold hover:bg-accent/90'
              : b.tone === 'danger' ? 'bg-rose-600/90 text-white font-semibold hover:bg-rose-600'
              : 'bg-white/[0.06] border border-white/15 text-gray-200 hover:bg-white/[0.10]';
            return (
              <button
                key={b.value}
                ref={i === 0 ? firstBtnRef : undefined}
                onClick={() => click(b.value)}
                className={`le-tap text-xs rounded-lg px-3.5 py-1.5 transition-colors ${cls}`}
              >
                {b.label}
              </button>
            );
          })}
        </div>
      </motion.div>
    </motion.div>
  );
}

export default function DialogHost() {
  const [queue, setQueue] = useState<DialogSpec[]>([]);
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  useEffect(() => subscribeDialogs(setQueue), []);
  if (!mounted || queue.length === 0) return null;
  const top = queue[queue.length - 1];
  return createPortal(<DialogPanel key={top.id} dlg={top} />, document.body);
}
