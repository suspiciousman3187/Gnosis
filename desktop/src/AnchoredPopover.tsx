import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';

// Anchored dropdown that renders in a portal on document.body, so it can never
// be clipped by an ancestor's overflow:hidden. Positions under (or, if there is
// no room, above) the anchor and clamps to the viewport. Use this for ANY
// popout/dropdown menu - do not hand-roll absolute-positioned panels inside
// scrolling/overflow-hidden containers.
export default function AnchoredPopover({
  anchorRef, open, onClose, width, align = 'left', children,
}: {
  anchorRef: RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
  width?: number;          // fixed width; defaults to the anchor's width
  align?: 'left' | 'right';
  children: ReactNode;
}) {
  const [pos, setPos] = useState<{ mode: 'below' | 'above'; y: number; left: number; width: number; maxH: number } | null>(null);

  useLayoutEffect(() => {
    if (!open) { setPos(null); return; }
    const compute = () => {
      const a = anchorRef.current;
      if (!a) return;
      const r = a.getBoundingClientRect();
      const PAD = 8;
      const w = width ?? r.width;
      let left = align === 'right' ? r.right - w : r.left;
      left = Math.min(left, window.innerWidth - w - PAD);
      left = Math.max(PAD, left);
      const spaceBelow = window.innerHeight - r.bottom - PAD;
      const spaceAbove = r.top - PAD;
      const below = spaceBelow >= 200 || spaceBelow >= spaceAbove;
      setPos(below
        ? { mode: 'below', y: r.bottom + 4, left, width: w, maxH: Math.max(120, spaceBelow) }
        : { mode: 'above', y: window.innerHeight - r.top + 4, left, width: w, maxH: Math.max(120, spaceAbove) });
    };
    compute();
    window.addEventListener('resize', compute);
    window.addEventListener('scroll', compute, true);
    return () => { window.removeEventListener('resize', compute); window.removeEventListener('scroll', compute, true); };
  }, [open, anchorRef, width, align]);

  useLayoutEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open || !pos) return null;
  const style: React.CSSProperties = {
    position: 'fixed',
    left: pos.left,
    width: pos.width,
    maxHeight: pos.maxH,
    ...(pos.mode === 'below' ? { top: pos.y } : { bottom: pos.y }),
  };
  return createPortal(
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div style={style} className="z-50 overflow-auto rounded-lg border border-white/15 bg-black/95 shadow-xl">
        {children}
      </div>
    </>,
    document.body,
  );
}
