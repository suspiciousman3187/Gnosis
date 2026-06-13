'use client';

import { createContext, useContext, useState } from 'react';

// Resolver: buff/status id → icon URL, or null when disabled/unavailable. The
// desktop provides one pointing at the bundled buff icon set the user picked.
export const BuffIconContext = createContext<(buffId: number) => string | null>(() => null);

// Small status-icon image; renders nothing when no icon is available (so it can
// sit as a prefix before the buff name without leaving a gap).
export default function BuffIcon({ id, size = 16 }: { id?: number; size?: number }) {
  const resolve = useContext(BuffIconContext);
  const [failed, setFailed] = useState(false);
  const url = id != null && id >= 0 ? resolve(id) : null;
  if (!url || failed) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      width={size}
      height={size}
      alt=""
      className="rounded-sm inline-block shrink-0 align-middle"
      style={{ imageRendering: 'pixelated' }}
      onError={() => setFailed(true)}
      draggable={false}
    />
  );
}
