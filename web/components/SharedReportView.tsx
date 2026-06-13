'use client';

import { useEffect, useState, type ReactNode } from 'react';
import EncounterView from '@/components/EncounterView';
import RunTabs from '@/components/RunTabs';
import { BuffIconContext } from '@/components/BuffIcon';
import { ItemIconContext } from '@/components/ItemIcon';
import LoadingScreen from '@/components/LoadingScreen';
import PrivateReportGate from '@/components/PrivateReportGate';
import ReportPrivacyBadge from '@/components/ReportPrivacyBadge';
import { findPlayerLeaks } from '@/lib/findPlayerLeaks';
import type { RunRecord } from '@/lib/types';
import type { Encounter } from '@/lib/encounter';

type LoadedContent =
  | { kind: 'sortie'; record: RunRecord }
  | { kind: 'encounter'; encounter: Encounter };

type Payload = { v: number; anonymized?: boolean; content: LoadedContent; icons?: Record<string, string> };

const buffResolver = (id: number): string | null => (id >= 0 ? `/buffs/xiview/${id}.bmp` : null);

async function decode(buf: ArrayBuffer): Promise<string> {
  const bytes = new Uint8Array(buf);
  const isGzip = bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
  if (!isGzip) return new TextDecoder().decode(bytes);
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });
}

function fmtDuration(seconds: number | null | undefined): string {
  if (!seconds || seconds <= 0) return '-';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function StatCards({ cards }: { cards: { label: string; value: string | number; color?: string }[] }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
      {cards.map(({ label, value, color }) => (
        <div key={label} className="bg-surface border border-white/10 rounded-xl p-4">
          <p className="text-gray-400 text-xs">{label}</p>
          <p className={`text-xl font-bold mt-1 ${color ?? 'text-amber-400'}`}>{value}</p>
        </div>
      ))}
    </div>
  );
}

function Title({ children }: { children: React.ReactNode }) {
  return <h1 className="text-2xl font-bold flex items-center gap-3 flex-wrap">{children}</h1>;
}

function Chip({ children, className }: { children: React.ReactNode; className: string }) {
  return <span className={`text-sm font-bold px-2.5 py-0.5 rounded border ${className}`}>{children}</span>;
}

const SharedViewOnlyBadge = (
  <span className="shrink-0 text-[9px] font-bold uppercase tracking-wider text-gray-300 bg-white/[0.06] border border-white/15 rounded px-2 py-1 leading-none whitespace-nowrap">
    Shared · view only
  </span>
);

function SortieView({ r, headerBadge }: { r: RunRecord; headerBadge: ReactNode }) {
  const header = (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[10px] uppercase font-bold tracking-wide px-1.5 py-0.5 rounded border bg-amber-500/15 text-amber-300 border-amber-500/30">Sortie</span>
          <span className="text-[11px] text-gray-400 uppercase tracking-wide leading-none">Encounter</span>
        </div>
        <h2 className="text-2xl font-bold text-accent leading-none truncate">Outer Ra&apos;Kaznar</h2>
        <div className="mt-1.5 text-[11px] text-gray-400">
          <span className="uppercase tracking-wide text-gray-400 mr-1">Date</span>{fmtDate(r.run_date)}
        </div>
      </div>
      {headerBadge}
    </div>
  );
  return <RunTabs run={r} isAdmin header={header} />;
}

export default function SharedReportView({ id, loggedIn, isOwner, initialPrivate }: { id: string; loggedIn: boolean; isOwner: boolean; initialPrivate: boolean | null }) {
  const [state, setState] = useState<'loading' | 'error' | 'ok' | 'leak-blocked' | 'private'>('loading');
  const [content, setContent] = useState<LoadedContent | null>(null);
  const [icons, setIcons] = useState<Record<string, string>>({});
  const [err, setErr] = useState('');
  const [anonymized, setAnonymized] = useState<boolean | undefined>(undefined);
  const [leakedNames, setLeakedNames] = useState<string[]>([]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/share/${id}/payload`);
        if (res.status === 403) {
          if (alive) setState('private');
          return;
        }
        if (!res.ok) {
          throw new Error(res.status === 404 || res.status === 400 || res.status === 410
            ? 'This shared report could not be found - the link may be incorrect or it has expired.'
            : `Failed to load report (HTTP ${res.status}).`);
        }
        const payload = JSON.parse(await decode(await res.arrayBuffer())) as Payload;
        if (!payload || !payload.content || !payload.content.kind) throw new Error('This report is malformed.');

        if (payload.anonymized === true) {
          const target = (payload.content.kind === 'encounter'
            ? (payload.content as { encounter: unknown }).encounter
            : (payload.content as { record: unknown }).record);
          const leaks = findPlayerLeaks(target);
          if (leaks.length > 0) {
            if (alive) {
              setLeakedNames(leaks);
              setState('leak-blocked');
            }
            return;
          }
        }

        if (alive) {
          setContent(payload.content);
          setIcons(payload.icons ?? {});
          setAnonymized(payload.anonymized);
          setState('ok');
        }
      } catch (e) {
        if (alive) { setErr(e instanceof Error ? e.message : String(e)); setState('error'); }
      }
    })();
    return () => { alive = false; };
  }, [id]);

  if (state === 'loading') {
    return (
      <main className="min-h-screen flex items-center justify-center px-4">
        <LoadingScreen />
      </main>
    );
  }

  if (state === 'private') {
    return (
      <main className="min-h-screen flex items-center justify-center px-4">
        <PrivateReportGate loggedIn={loggedIn} />
      </main>
    );
  }

  return (
    <BuffIconContext.Provider value={buffResolver}>
    <ItemIconContext.Provider value={(itemId: number) => icons[itemId] ?? null}>
      <main className="max-w-6xl mx-auto px-4 py-8">
        {state === 'error' && (
          <div className="text-gray-300 bg-surface border border-white/10 rounded-xl p-10 text-center mt-6">
            <div className="text-rose-400 font-semibold mb-1">Couldn&apos;t load this report</div>
            <div className="text-sm text-gray-400">{err}</div>
          </div>
        )}
        {state === 'leak-blocked' && (
          <div className="text-gray-300 bg-rose-950/40 border border-rose-700/50 rounded-xl p-8 mt-6">
            <div className="text-rose-300 font-semibold text-base mb-2">Report blocked: anonymization check failed</div>
            <div className="text-sm text-gray-300 mb-3">
              This shared report was uploaded with anonymization enabled, but the viewer
              detected real character names that weren&apos;t scrubbed. To protect the original
              player&apos;s privacy, the report won&apos;t render.
            </div>
            <div className="text-xs text-gray-400 mb-3">
              If you uploaded this report, please re-share it from an updated Gnosis build.
              The names detected (which were NOT removed before upload):
            </div>
            <ul className="text-xs font-mono text-rose-300/80 list-disc list-inside space-y-0.5">
              {leakedNames.map(n => <li key={n}>{n}</li>)}
            </ul>
          </div>
        )}
        {state === 'ok' && content && anonymized === false && (
          <div className="bg-amber-950/30 border border-amber-700/50 rounded-lg px-4 py-2.5 mb-4 text-[12px] text-amber-200">
            <span className="font-semibold">Real character names included.</span>{' '}
            <span className="text-amber-200/80">The uploader chose to share this report without anonymizing player names.</span>
          </div>
        )}
        {state === 'ok' && content && (() => {
          const headerBadge = isOwner && initialPrivate != null
            ? <ReportPrivacyBadge id={id} initialPrivate={initialPrivate} />
            : SharedViewOnlyBadge;
          return content.kind === 'encounter' ? <EncounterView enc={content.encounter} headerAction={headerBadge} />
            : content.kind === 'sortie'  ? <SortieView r={content.record} headerBadge={headerBadge} />
            : null;
        })()}
      </main>
    </ItemIconContext.Provider>
    </BuffIconContext.Provider>
  );
}
