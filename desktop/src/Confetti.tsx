import { useMemo } from 'react';

const PALETTE = [
  '#f0c062', '#ffd87a', '#e8a24a', '#ffffff',
  '#9be7c4', '#7cc7ff', '#f29bd1', '#c9b8ff',
];

type Piece = {
  id: number;
  color: string;
  tx: number;
  ty: number;
  rot: number;
  size: number;
  duration: number;
  delayMs: number;
  radius: 0 | 50;
};

function makePieces(count: number): Piece[] {
  return Array.from({ length: count }, (_, i) => {
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.4;
    const distance = 80 + Math.random() * 220;
    const gravityBias = 60 + Math.random() * 120;
    return {
      id: i,
      color: PALETTE[i % PALETTE.length],
      tx: Math.cos(angle) * distance,
      ty: Math.sin(angle) * distance + gravityBias,
      rot: (Math.random() < 0.5 ? -1 : 1) * (180 + Math.random() * 540),
      size: 5 + Math.random() * 6,
      duration: 1100 + Math.random() * 900,
      delayMs: Math.random() * 120,
      radius: Math.random() < 0.5 ? 0 : 50,
    };
  });
}

export default function Confetti({ count = 36, playKey = 0 }: { count?: number; playKey?: number }) {
  const pieces = useMemo(() => makePieces(count), [count, playKey]);
  return (
    <div className="confetti-container" aria-hidden="true">
      {pieces.map(p => (
        <span
          key={p.id}
          className="confetti-piece"
          style={{
            ['--c-color' as string]: p.color,
            ['--c-tx' as string]: `${p.tx.toFixed(1)}px`,
            ['--c-ty' as string]: `${p.ty.toFixed(1)}px`,
            ['--c-rot' as string]: `${p.rot.toFixed(0)}deg`,
            ['--c-size' as string]: `${p.size.toFixed(1)}px`,
            ['--c-duration' as string]: `${Math.round(p.duration)}ms`,
            ['--c-radius' as string]: p.radius === 50 ? '50%' : '0',
            animationDelay: `${Math.round(p.delayMs)}ms`,
          } as React.CSSProperties}
        />
      ))}
    </div>
  );
}
