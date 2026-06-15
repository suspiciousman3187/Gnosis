import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { inTauri } from './library';

type Step = 'welcome' | 'folder' | 'finish';

export const FTUE_COMPLETED_KEY = 'gnosis_ftue_completed';

export function isFtueCompleted(): boolean {
  if (typeof localStorage === 'undefined') return true;
  return localStorage.getItem(FTUE_COMPLETED_KEY) === '1';
}

export function markFtueCompleted(): void {
  try { localStorage.setItem(FTUE_COMPLETED_KEY, '1'); } catch {}
}

export function clearFtueCompletion(): void {
  try { localStorage.removeItem(FTUE_COMPLETED_KEY); } catch {}
}

async function autoDetectAddonDir(): Promise<string | null> {
  if (!inTauri) return null;
  try {
    const detected = await invoke<string | null>('find_addon_data_dir');
    return typeof detected === 'string' && detected.length > 0 ? detected : null;
  } catch {
    return null;
  }
}

async function pickFolder(currentDir: string | null): Promise<string | null> {
  try {
    const selected = await openDialog({
      directory: true,
      multiple: false,
      defaultPath: currentDir ?? undefined,
      title: 'Select your Gnosis addon data folder',
    });
    if (typeof selected === 'string' && selected.length > 0) return selected;
    return null;
  } catch {
    return null;
  }
}

function ProgressDots({ step }: { step: Step }) {
  const order: Step[] = ['welcome', 'folder', 'finish'];
  const idx = order.indexOf(step);
  return (
    <div className="flex items-center justify-center gap-2 mt-6">
      {order.map((s, i) => (
        <span
          key={s}
          className={`h-1.5 rounded-full transition-all ${
            i === idx ? 'w-8 bg-accent' : i < idx ? 'w-1.5 bg-accent/40' : 'w-1.5 bg-white/15'
          }`}
        />
      ))}
    </div>
  );
}

function StepWelcome({ onNext }: { onNext: () => void }) {
  return (
    <div className="text-center space-y-6">
      <div className="space-y-2">
        <div className="inline-flex items-center gap-2">
          <h1 className="text-5xl font-bold tracking-tight text-accent">GNOSIS</h1>
          <span className="text-[10px] font-bold uppercase tracking-wider text-amber-200 bg-amber-500/20 border border-amber-500/40 rounded px-1.5 py-0.5 self-end mb-2">Beta</span>
        </div>
        <p className="text-base text-gray-300">Tracking and analytics for Final Fantasy XI.</p>
      </div>
      <div className="bg-row-even border border-white/10 rounded-xl p-5 text-left space-y-3">
        <p className="text-sm text-gray-200">
          Gnosis is two pieces working together:
        </p>
        <ul className="text-sm text-gray-300 space-y-2">
          <li className="flex items-start gap-2">
            <span className="text-accent shrink-0">●</span>
            <span><span className="text-white font-semibold">The Windower Addon</span> captures your gameplay and writes encounter logs.</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-accent shrink-0">●</span>
            <span><span className="text-white font-semibold">The Viewer</span> (this app) reads those logs and renders the reports.</span>
          </li>
        </ul>
        <p className="text-xs text-gray-400 pt-2 border-t border-white/[0.06]">
          Let&apos;s get you set up in about 30 seconds.
        </p>
      </div>
      <button
        onClick={onNext}
        className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 border border-emerald-400/30 text-white px-10 py-3 font-bold uppercase tracking-wide transition-colors"
      >
        Get Started
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 5l7 7-7 7" /></svg>
      </button>
    </div>
  );
}

function StepFolder({
  detected, picked, onPick, onBack, onNext,
}: {
  detected: string | null;
  picked: string | null;
  onPick: () => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const effective = picked ?? detected;
  const status: 'auto' | 'manual' | 'none' = picked ? 'manual' : detected ? 'auto' : 'none';
  return (
    <div className="space-y-6">
      <div className="text-center space-y-2">
        <h2 className="text-2xl font-bold text-accent">Where does Gnosis live?</h2>
        <p className="text-sm text-gray-300">Point the Viewer at your Windower addon&apos;s data folder.</p>
      </div>
      <div className="bg-row-even border border-white/10 rounded-xl p-5 space-y-4">
        <div>
          <div className="text-[10px] uppercase tracking-wider font-bold text-gray-400 mb-2">Addon Data Folder</div>
          <div className="flex items-stretch gap-2">
            <div className="flex-1 min-w-0 bg-black/40 border border-white/10 rounded-md px-3 py-2.5 text-sm font-mono text-gray-200 truncate">
              {effective ?? <span className="text-gray-500 italic">No folder selected yet</span>}
            </div>
            <button
              onClick={onPick}
              className="shrink-0 px-4 rounded-md border border-white/15 text-sm text-gray-200 hover:bg-white/[0.06] transition-colors"
            >
              Browse&hellip;
            </button>
          </div>
          <div className="mt-2 text-[12px]">
            {status === 'auto' && (
              <span className="text-emerald-300">
                <span className="inline-block mr-1">✓</span>Auto-detected from your Windower install.
              </span>
            )}
            {status === 'manual' && (
              <span className="text-accent">
                <span className="inline-block mr-1">✓</span>Path set manually.
              </span>
            )}
            {status === 'none' && (
              <span className="text-amber-300">
                <span className="inline-block mr-1">⚠</span>Couldn&apos;t auto-detect your Windower folder. Click <span className="font-semibold">Browse</span> to pick it manually.
              </span>
            )}
          </div>
        </div>
        <div className="border-t border-white/[0.06] pt-3 text-[12px] text-gray-400 leading-relaxed">
          Usually under <code className="px-1 py-0.5 bg-black/40 rounded font-mono text-gray-300">Windower/addons/Gnosis/data/</code>. The Viewer will create the folder if it&apos;s missing.
        </div>
      </div>
      <div className="flex items-center justify-between gap-3">
        <button
          onClick={onBack}
          className="text-sm text-gray-400 hover:text-gray-200 transition-colors px-3 py-2"
        >
          ← Back
        </button>
        <button
          onClick={onNext}
          disabled={!effective}
          className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 border border-emerald-400/30 text-white px-8 py-2.5 font-bold uppercase tracking-wide transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Continue
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 5l7 7-7 7" /></svg>
        </button>
      </div>
    </div>
  );
}

function StepFinish({ onBack, onDone }: { onBack: () => void; onDone: () => void }) {
  return (
    <div className="space-y-6">
      <div className="text-center space-y-2">
        <h2 className="text-2xl font-bold text-accent">Almost there!</h2>
        <p className="text-sm text-gray-300">Two quick things, then you&apos;re tracking.</p>
      </div>
      <div className="bg-row-even border border-white/10 rounded-xl p-5 space-y-4">
        <div className="flex items-start gap-3">
          <span className="shrink-0 w-7 h-7 rounded-full bg-accent/20 border border-accent/50 text-accent font-bold text-sm flex items-center justify-center">1</span>
          <div className="space-y-1">
            <div className="text-sm font-semibold text-white">Load the Addon in FFXI</div>
            <div className="text-[13px] text-gray-300">
              Type <code className="px-1.5 py-0.5 bg-black/40 rounded font-mono text-accent">//lua l Gnosis</code> in your chat.
              Add it to <code className="px-1.5 py-0.5 bg-black/40 rounded font-mono text-gray-300">Windower/scripts/init.txt</code> if you want it to auto-load every session.
            </div>
          </div>
        </div>
        <div className="flex items-start gap-3 pt-3 border-t border-white/[0.06]">
          <span className="shrink-0 w-7 h-7 rounded-full bg-accent/20 border border-accent/50 text-accent font-bold text-sm flex items-center justify-center">2</span>
          <div className="space-y-1">
            <div className="text-sm font-semibold text-white">Tracking is set to Encounter</div>
            <div className="text-[13px] text-gray-300">
              The Viewer will auto-record each fight and close the encounter after 30 seconds of inactivity. Change it any time in <span className="text-white font-medium">Settings &rarr; Tracking</span>.
            </div>
          </div>
        </div>
      </div>
      <div className="flex items-center justify-between gap-3">
        <button
          onClick={onBack}
          className="text-sm text-gray-400 hover:text-gray-200 transition-colors px-3 py-2"
        >
          ← Back
        </button>
        <button
          onClick={onDone}
          className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 border border-emerald-400/30 text-white px-10 py-3 font-bold uppercase tracking-wide transition-colors"
        >
          Open Gnosis
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 5l7 7-7 7" /></svg>
        </button>
      </div>
    </div>
  );
}

export default function WelcomeWizard({ onComplete }: { onComplete: (dir: string) => void }) {
  const [step, setStep] = useState<Step>('welcome');
  const [detected, setDetected] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void autoDetectAddonDir().then(d => { if (alive) setDetected(d); });
    return () => { alive = false; };
  }, []);

  const handlePick = async () => {
    const sel = await pickFolder(picked ?? detected);
    if (sel) setPicked(sel);
  };

  const handleDone = () => {
    const final = picked ?? detected;
    if (!final) return;
    markFtueCompleted();
    onComplete(final);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-md p-6">
      <div className="w-full max-w-2xl bg-surface border border-white/10 rounded-2xl shadow-2xl shadow-black/60 p-8">
        {step === 'welcome' && <StepWelcome onNext={() => setStep('folder')} />}
        {step === 'folder' && (
          <StepFolder
            detected={detected}
            picked={picked}
            onPick={handlePick}
            onBack={() => setStep('welcome')}
            onNext={() => setStep('finish')}
          />
        )}
        {step === 'finish' && <StepFinish onBack={() => setStep('folder')} onDone={handleDone} />}
        <ProgressDots step={step} />
      </div>
    </div>
  );
}
