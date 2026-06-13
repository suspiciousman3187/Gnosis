
import { useEffect, useRef, useState } from 'react';

export const IDLE_QUOTES: string[] = [
  'Which is more important to you: a long meaningless life... or a short but meaningful one?',
  'The unexamined life is not worth living.',
  'I know that I know nothing.',
  'It is what it is.',
  'Know thyself.',
  'He who knows others is wise; he who knows himself is enlightened.',
  'Knowing yourself is the beginning of all wisdom.',
  'Who looks outside, dreams. Who looks inside, awakens.',
  'Until you make the unconscious conscious, it will direct your life and you will call it fate.',
  'Real knowledge is to know the extent of one’s ignorance.',
  'To know that you know what you know, and that you do not know what you do not know? That is true knowledge.',
  'According to the guidance of reason, of two things which are good, we shall follow the greater good, and of two evils, follow the less.',
  'The key to improving is simply not making the same mistake twice.',
  'There is nothing wrong with being bad. Staying bad, however...',
];

function useRotatingQuote() {
  const [i, setI] = useState(() => Math.floor(Math.random() * IDLE_QUOTES.length));
  const [phase, setPhase] = useState<'pre' | 'in' | 'out'>('in');
  const isFirstRender = useRef(true);
  const quote = IDLE_QUOTES[i];

  useEffect(() => {
    let cancelled = false;
    const timers: number[] = [];
    const isFirst = isFirstRender.current;
    isFirstRender.current = false;

    if (!isFirst) {
      setPhase('pre');
      timers.push(window.setTimeout(() => { if (!cancelled) setPhase('in'); }, 60));
    }
    const inDelay = isFirst ? 0 : 60;
    timers.push(window.setTimeout(() => { if (!cancelled) setPhase('out'); }, inDelay + 15000));
    timers.push(window.setTimeout(() => {
      if (cancelled) return;
      setI(prev => {
        if (IDLE_QUOTES.length < 2) return prev;
        let x = prev;
        while (x === prev) x = Math.floor(Math.random() * IDLE_QUOTES.length);
        return x;
      });
    }, inDelay + 15000 + 850));
    return () => { cancelled = true; timers.forEach(clearTimeout); };
  }, [i]);

  return { quote, phase, shown: phase === 'in' };
}

export function RotatingQuote({ caption }: { caption?: string }) {
  const { quote, phase, shown } = useRotatingQuote();
  return (
    <div className="flex flex-col items-center gap-6">
      {caption && (
        <p
          className="text-sm uppercase tracking-[0.18em] text-gray-300 [text-shadow:0_1px_2px_rgba(0,0,0,0.9)] transition-opacity duration-700"
          style={{ opacity: shown ? 0.85 : 0.4 }}
        >
          {caption}
        </p>
      )}
      <div className="relative max-w-lg">
        <div
          aria-hidden
          className="pointer-events-none absolute -inset-x-20 -inset-y-14 rounded-[50%] blur-2xl transition-opacity duration-1000"
          style={{ background: 'radial-gradient(closest-side, rgba(0,0,0,0.6), rgba(0,0,0,0.28) 55%, transparent 80%)', opacity: shown ? 1 : 0 }}
        />
        <blockquote
          className="relative text-center text-2xl italic font-light text-gray-50 leading-relaxed transition-all ease-out [text-shadow:0_1px_2px_rgba(0,0,0,0.9),0_2px_20px_rgba(0,0,0,0.7)]"
          style={{
            opacity: shown ? 1 : 0,
            transform: phase === 'in' ? 'translateY(0)' : phase === 'out' ? 'translateY(-16px)' : 'translateY(14px)',
            filter: shown ? 'blur(0px)' : 'blur(6px)',
            transitionDuration: phase === 'pre' ? '0ms' : phase === 'in' ? '950ms' : '750ms',
          }}
        >
          &ldquo;{quote}&rdquo;
        </blockquote>
      </div>
    </div>
  );
}

export default function IdleQuote({ caption }: { caption?: string }) {
  return (
    <div className="h-full flex flex-col items-center justify-center px-8">
      <RotatingQuote caption={caption} />
    </div>
  );
}
