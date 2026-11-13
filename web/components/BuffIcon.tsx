'use client';

import { createContext, useContext, useEffect, useState } from 'react';

// Resolver: buff/status id → icon URL, or null when disabled/unavailable. The
// host provides one pointing at the bundled buff icon set the user picked.
export const BuffIconContext = createContext<(buffId: number) => string | null>(() => null);

// Small status-icon image; renders nothing when no icon is available (so it can
// sit as a prefix before the buff name without leaving a gap). When the chosen
// set is missing an id, it falls back to the most complete set (xiview) before
// giving up, so switching to a sparser set (e.g. Buffed) never leaves blanks.
export default function BuffIcon({ id, size = 16 }: { id?: number; size?: number }) {
  const resolve = useContext(BuffIconContext);
  const primary = id != null && id >= 0 ? resolve(id) : null;
  const fallback = id != null && id >= 0 ? `/buffs/xiview/${id}.bmp` : null;
  const [stage, setStage] = useState<0 | 1 | 2>(0); // 0 primary, 1 fallback, 2 failed
  useEffect(() => { setStage(0); }, [primary]);
  if (!primary || stage === 2) return null;
  const src = stage === 0 ? primary : fallback;
  if (!src) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      width={size}
      height={size}
      alt=""
      className="rounded-sm inline-block shrink-0 align-middle"
      style={{ imageRendering: 'pixelated' }}
      onError={() => setStage(s => (s === 0 && fallback && fallback !== primary) ? 1 : 2)}
      draggable={false}
    />
  );
}
