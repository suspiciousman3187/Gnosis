'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

interface TooltipState {
  text: string;
  tone: 'default' | 'accent' | 'warn' | 'danger' | 'success';
  rect: { x: number; y: number; w: number; h: number };
}

const SHOW_DELAY_MS = 350;
const HIDE_DELAY_MS = 80;
const VIEWPORT_PAD = 8;
const TIP_OFFSET = 8;

const TONE_BORDER: Record<TooltipState['tone'], string> = {
  default: 'border-white/15',
  accent: 'border-accent/50',
  warn: 'border-amber-500/50',
  danger: 'border-rose-500/50',
  success: 'border-emerald-500/50',
};

function readTone(el: Element): TooltipState['tone'] {
  const t = (el.getAttribute('data-tooltip-tone') || '').toLowerCase();
  if (t === 'accent' || t === 'warn' || t === 'danger' || t === 'success') return t;
  return 'default';
}

export default function TooltipHost() {
  const [tip, setTip] = useState<TooltipState | null>(null);
  const [mounted, setMounted] = useState(false);
  const showTimerRef = useRef<number | null>(null);
  const hideTimerRef = useRef<number | null>(null);
  const tipRef = useRef<HTMLDivElement | null>(null);
  const [tipPos, setTipPos] = useState<{ left: number; top: number; placement: 'top' | 'bottom' } | null>(null);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    const onOver = (e: MouseEvent) => {
      const target = (e.target as Element | null)?.closest?.('[data-tooltip]') as HTMLElement | null;
      if (!target) return;
      const text = target.getAttribute('data-tooltip') ?? '';
      if (!text.trim()) return;
      if (hideTimerRef.current != null) { window.clearTimeout(hideTimerRef.current); hideTimerRef.current = null; }
      if (showTimerRef.current != null) window.clearTimeout(showTimerRef.current);
      const tone = readTone(target);
      showTimerRef.current = window.setTimeout(() => {
        const r = target.getBoundingClientRect();
        setTip({ text, tone, rect: { x: r.left, y: r.top, w: r.width, h: r.height } });
      }, SHOW_DELAY_MS);
    };
    const onOut = (e: MouseEvent) => {
      const from = (e.target as Element | null)?.closest?.('[data-tooltip]');
      const to = (e.relatedTarget as Element | null)?.closest?.('[data-tooltip]');
      if (!from || from === to) return;
      if (showTimerRef.current != null) { window.clearTimeout(showTimerRef.current); showTimerRef.current = null; }
      hideTimerRef.current = window.setTimeout(() => setTip(null), HIDE_DELAY_MS);
    };
    const onScroll = () => {
      if (showTimerRef.current != null) { window.clearTimeout(showTimerRef.current); showTimerRef.current = null; }
      setTip(null);
    };
    document.addEventListener('mouseover', onOver);
    document.addEventListener('mouseout', onOut);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mouseover', onOver);
      document.removeEventListener('mouseout', onOut);
      window.removeEventListener('scroll', onScroll, true);
      if (showTimerRef.current != null) window.clearTimeout(showTimerRef.current);
      if (hideTimerRef.current != null) window.clearTimeout(hideTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!tip) { setTipPos(null); return; }
    const el = tipRef.current;
    if (!el) return;
    const measure = () => {
      const tipRect = el.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const trigger = tip.rect;
      let placement: 'top' | 'bottom' = 'top';
      let top = trigger.y - tipRect.height - TIP_OFFSET;
      if (top < VIEWPORT_PAD) {
        placement = 'bottom';
        top = trigger.y + trigger.h + TIP_OFFSET;
      }
      if (placement === 'bottom' && top + tipRect.height > vh - VIEWPORT_PAD) {
        top = Math.max(VIEWPORT_PAD, vh - VIEWPORT_PAD - tipRect.height);
      }
      let left = trigger.x + trigger.w / 2 - tipRect.width / 2;
      if (left < VIEWPORT_PAD) left = VIEWPORT_PAD;
      if (left + tipRect.width > vw - VIEWPORT_PAD) left = vw - VIEWPORT_PAD - tipRect.width;
      setTipPos({ left, top, placement });
    };
    measure();
    const id = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(id);
  }, [tip]);

  if (!mounted || !tip) return null;
  return createPortal(
    <div
      ref={tipRef}
      role="tooltip"
      className={`fixed z-[10001] pointer-events-none bg-zinc-950/95 border ${TONE_BORDER[tip.tone]} rounded-lg shadow-2xl px-2.5 py-1.5 max-w-sm`}
      style={{
        left: tipPos?.left ?? -9999,
        top: tipPos?.top ?? -9999,
        opacity: tipPos ? 1 : 0,
        transition: 'opacity 120ms ease-out',
      }}
    >
      <div className="text-[11px] text-gray-200 whitespace-pre-wrap leading-snug font-mono">{tip.text}</div>
    </div>,
    document.body,
  );
}
