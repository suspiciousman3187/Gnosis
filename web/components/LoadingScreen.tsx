'use client';

import { RotatingQuote } from './IdleQuote';

export default function LoadingScreen({ caption = 'Loading' }: { caption?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-7 select-none py-10">
      <p className="text-xs uppercase tracking-[0.22em] font-semibold text-gray-300 [text-shadow:0_1px_2px_rgba(0,0,0,0.9)]">
        Now {caption}<span className="splash-dots" aria-hidden="true">
          <span>.</span><span>.</span><span>.</span>
        </span>
      </p>
      <div className="splash-stage">
        <div className="splash-translate">
          <div className="splash-scale">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/gnosis-icon.png"
              alt=""
              aria-hidden="true"
              draggable={false}
              className="splash-rotate"
            />
          </div>
        </div>
      </div>
      <RotatingQuote />
    </div>
  );
}
