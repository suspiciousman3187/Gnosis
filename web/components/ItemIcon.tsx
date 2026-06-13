'use client';

import { createContext, memo, useContext, useState } from 'react';

export const ItemIconContext = createContext<(id: number) => string | null>(() => null);

function ItemIconImpl({ id, name, size = 22, nameClass = 'truncate' }: { id?: number; name: string; size?: number; nameClass?: string }) {
  const resolve = useContext(ItemIconContext);
  const [failed, setFailed] = useState(false);
  const url = id != null && id > 0 ? resolve(id) : null;

  if (!url || failed) {
    return <span className={nameClass} title={name}>{name}</span>;
  }
  return (
    <span className="inline-flex items-center gap-1.5 min-w-0" title={name}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        width={size}
        height={size}
        alt=""
        className="rounded-sm shrink-0"
        style={{ imageRendering: 'pixelated' }}
        onError={() => setFailed(true)}
        draggable={false}
      />
      <span className={nameClass}>{name}</span>
    </span>
  );
}

export default memo(ItemIconImpl);
