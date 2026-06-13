'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export default function PrivateReportGate({ loggedIn }: { loggedIn: boolean }) {
  const pathname = usePathname() ?? '/';
  const next = encodeURIComponent(pathname);
  return (
    <div className="flex flex-col items-center justify-center gap-7 select-none py-10">
      <p className="text-xs uppercase tracking-[0.22em] font-semibold text-gray-300 [text-shadow:0_1px_2px_rgba(0,0,0,0.9)]">
        <span className="text-accent">Private Report</span>
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
      <div className="flex flex-col items-center gap-5 max-w-lg">
        <p className="text-center text-xl text-gray-50 leading-relaxed [text-shadow:0_1px_2px_rgba(0,0,0,0.9),0_2px_20px_rgba(0,0,0,0.7)]">
          This report is private, only the owner can view it.
        </p>
        {!loggedIn && (
          <Link
            href={`/login?next=${next}`}
            className="inline-flex items-center justify-center text-sm rounded-lg px-5 py-2.5 bg-accent/20 border border-accent/50 text-accent hover:bg-accent/30 transition-colors"
          >
            Sign In
          </Link>
        )}
      </div>
    </div>
  );
}
