'use client';

import { useEffect, useState, type ReactNode } from 'react';

export default function Collapse({ open, children }: { open: boolean; children: () => ReactNode }) {
  const [mounted, setMounted] = useState(open);
  const [show, setShow] = useState(open);
  useEffect(() => {
    if (open) {
      setMounted(true);
      let r2 = 0;
      const r1 = requestAnimationFrame(() => { r2 = requestAnimationFrame(() => setShow(true)); });
      return () => { cancelAnimationFrame(r1); cancelAnimationFrame(r2); };
    }
    setShow(false);
    const t = window.setTimeout(() => setMounted(false), 200);
    return () => window.clearTimeout(t);
  }, [open]);
  if (!mounted) return null;
  return (
    <div
      className="motion-reduce:transition-none origin-top"
      style={{
        opacity: show ? 1 : 0,
        transform: show ? 'translateY(0)' : 'translateY(-6px)',
        transitionProperty: 'opacity, transform',
        transitionDuration: 'var(--dur-base)',
        transitionTimingFunction: 'var(--ease-out)',
        willChange: 'opacity, transform',
      }}
    >
      {children()}
    </div>
  );
}
