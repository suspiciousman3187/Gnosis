import { useEffect, useState, type ReactNode } from 'react';
import { RotatingQuote } from './IdleQuote';
import Confetti from './Confetti';

const CONFETTI_PULSE_MS = 3000;

const ICON_BY_THEME: Record<string, string> = {
  dawn: '/forest-icon.png',
  crimson: '/lesserevil-icon.png',
};

function useThemeIcon(): string {
  const [icon, setIcon] = useState<string>(() => ICON_BY_THEME[document.documentElement.dataset.theme ?? ''] ?? '/gnosis-icon.png');
  useEffect(() => {
    const el = document.documentElement;
    const apply = () => setIcon(ICON_BY_THEME[el.dataset.theme ?? ''] ?? '/gnosis-icon.png');
    apply();
    const obs = new MutationObserver(apply);
    obs.observe(el, { attributes: true, attributeFilter: ['data-theme'] });
    return () => obs.disconnect();
  }, []);
  return icon;
}

export default function LoadingScreen({
  exiting = false,
  caption = 'Loading',
  completeCaption = 'Complete!',
  fill = true,
  complete = false,
  confettiKey = 0,
  hideQuote = false,
  footer,
}: {
  exiting?: boolean;
  caption?: string;
  completeCaption?: string;
  fill?: boolean;
  complete?: boolean;
  confettiKey?: number;
  hideQuote?: boolean;
  footer?: ReactNode;
}) {
  const [pulse, setPulse] = useState(0);
  useEffect(() => {
    if (!complete) { setPulse(0); return; }
    const id = setInterval(() => setPulse(p => p + 1), CONFETTI_PULSE_MS);
    return () => clearInterval(id);
  }, [complete]);
  const iconSrc = useThemeIcon();
  const className = fill
    ? `splash-overlay absolute inset-0 flex flex-col items-center justify-center gap-7 select-none${exiting ? ' splash-overlay--exiting' : ''}`
    : 'flex flex-col items-center justify-center gap-7 select-none py-4';
  return (
    <div className={className}>
      <p className="text-xs uppercase tracking-[0.22em] font-semibold text-gray-300 [text-shadow:0_1px_2px_rgba(0,0,0,0.9)]">
        {complete ? (
          <span className="text-accent">{completeCaption}</span>
        ) : (
          <>
            {caption ? caption[0].toUpperCase() + caption.slice(1) : 'Loading'}<span className="splash-dots" aria-hidden="true">
              <span>.</span><span>.</span><span>.</span>
            </span>
          </>
        )}
      </p>
      <div className="splash-stage">
        {complete && <Confetti key={`${confettiKey}-${pulse}`} />}
        <div className={complete ? 'splash-translate splash-translate--cheer' : 'splash-translate'}>
          <div className={complete ? 'splash-scale splash-scale--cheer' : 'splash-scale'}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={iconSrc}
              alt=""
              aria-hidden="true"
              draggable={false}
              className={complete ? 'splash-rotate splash-rotate--cheer' : 'splash-rotate'}
            />
          </div>
        </div>
      </div>
      {!hideQuote && <RotatingQuote />}
      {footer && <div className="w-full">{footer}</div>}
    </div>
  );
}
