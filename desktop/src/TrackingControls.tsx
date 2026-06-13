import { useEffect, useState, Fragment } from 'react';
import type { TrackerStatus, TrackingMode } from './content';
import { useBoxes } from './multibox';
import { openExternal } from './library';

const MODES: { mode: TrackingMode; label: string; hint: string }[] = [
  { mode: 'off',     label: 'Off',       hint: 'Stop tracking' },
  { mode: 'fight',   label: 'Encounter', hint: 'One encounter per fight - opens on combat, closes after the idle timeout' },
  { mode: 'zone',    label: 'Zone',      hint: 'One encounter per zone' },
  { mode: 'session', label: 'Session',   hint: 'One continuous encounter until stopped' },
];

const SOURCE_CHIP: Record<string, string> = {
  sortie: 'text-amber-300',
};

function mmss(s: number) {
  const total = Math.max(0, Math.floor(s));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

export default function TrackingControls({
  status,
  connected,
  busy,
  onSetMode,
  onSave,
}: {
  status: TrackerStatus | null;
  connected: boolean;
  busy: boolean;
  onSetMode: (m: TrackingMode) => void;
  onSave: () => void;
}) {
  const active = status?.mode ?? 'off';
  const activeLabel = MODES.find(m => m.mode === active)?.label ?? active;
  const boxes = useBoxes();

  // Tick once a second so the per-zone elapsed counts stay live (boxes
  // snapshot only refreshes on IPC traffic; elapsed is derived from
  // combatStart vs now, so we need our own clock).
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // A character is "actively recording" if its addon is still streaming the
  // ~1Hz live payload AND that payload's recording flag is true. This signal
  // fires whenever an encounter is open, NOT gated by the Live tab being on
  // (that gate only affects the heavy `combat` stream - combatAt would
  // never tick for users who don't have the Live tab open).
  const LIVE_FRESH_MS = 5000;
  const recordingChars = boxes.filter(b =>
    b.live?.recording === true && b.liveAt && (nowMs - b.liveAt) < LIVE_FRESH_MS
  );
  const totalChars = boxes.length;
  const zoneGroups = new Map<string, { count: number; maxElapsed: number }>();
  for (const b of recordingChars) {
    const zone = b.live?.zone;
    if (!zone) continue;
    const g = zoneGroups.get(zone) ?? { count: 0, maxElapsed: 0 };
    g.count += 1;
    const e = b.live?.elapsed ?? 0;
    if (e > g.maxElapsed) g.maxElapsed = e;
    zoneGroups.set(zone, g);
  }
  const sortedZones = [...zoneGroups.entries()].sort((a, b) => b[1].count - a[1].count);
  const recording = connected && (sortedZones.length > 0 || !!status?.recording);

  return (
    <footer className="bg-nav border-t border-white/10 shrink-0 px-3 py-1.5 flex items-center gap-3 text-xs">
      <span className="flex items-center gap-1 text-[10px] shrink-0">
        <span className={`inline-block w-1.5 h-1.5 rounded-full ${connected ? 'bg-emerald-400' : 'bg-gray-600'}`} />
        <span className={connected ? 'text-emerald-400/80' : 'text-gray-600'}>{connected ? 'connected' : 'offline'}</span>
      </span>

      <span className="text-[10px] font-bold uppercase tracking-wide text-gray-400 shrink-0">Tracking</span>

      <div className="flex gap-1 shrink-0">
        {MODES.map(({ mode, label, hint }) => {
          const on = active === mode;
          return (
            <button
              key={mode}
              data-tooltip={hint}
              disabled={!connected || busy}
              onClick={() => onSetMode(mode)}
              className={`px-2.5 py-1 rounded border transition-colors ${
                on
                  ? 'bg-accent/20 border-accent/50 text-accent font-semibold'
                  : 'border-white/10 text-gray-300 hover:bg-white/[0.05]'
              } ${(!connected || busy) ? 'opacity-40 cursor-not-allowed' : ''}`}
            >
              {label}
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-1.5 min-w-0 text-[11px]">
        {!connected ? (
          <span className="text-gray-600 truncate">Load Gnosis in-game to control tracking.</span>
        ) : recording ? (
          <>
            <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 animate-pulse shrink-0" />
            <span className="text-emerald-300 font-medium shrink-0">Recording</span>
            {status?.source && <span className={`shrink-0 ${SOURCE_CHIP[status.source] ?? 'text-gray-300'}`}>· {status.source}</span>}
            {(() => {
              if (sortedZones.length === 0) {
                // No active multi-character signal - fall back to the addon's own status.
                return <>
                  {status?.zone && <span className="text-gray-300 truncate min-w-0">· {status.zone}</span>}
                  <span className="text-gray-400 font-mono shrink-0">· {mmss(status?.elapsed ?? 0)}</span>
                </>;
              }
              if (sortedZones.length >= 4) {
                return <span className="text-gray-300 shrink-0">· {sortedZones.length} zones</span>;
              }
              // 1 to 3 zones: per-zone breakdown with count + elapsed.
              return <>
                {sortedZones.map(([zone, info], i) => (
                  <Fragment key={zone}>
                    <span className="text-gray-500 shrink-0">{i === 0 ? '·' : '|'}</span>
                    <span className="text-gray-300 truncate min-w-0">{zone}</span>
                    <span className="text-gray-500 font-mono shrink-0">({info.count}/{totalChars})</span>
                    <span className="text-gray-400 font-mono shrink-0">· {mmss(info.maxElapsed)}</span>
                  </Fragment>
                ))}
              </>;
            })()}
          </>
        ) : (
          <>
            <span className="inline-block w-2 h-2 rounded-full bg-gray-600 shrink-0" />
            <span className="text-gray-500 truncate">{active === 'off' ? 'Idle' : `Ready (${activeLabel}) - waiting for combat`}</span>
          </>
        )}
      </div>

      <div className="ml-auto flex items-center gap-3 shrink-0">
        {/* Connected-character roster lives on the Home dashboard now -
            see HomeDashboard's ConnectedCharactersCard. The bottom bar
            stays focused on tracking state + the save action. */}
        {recording && (
          <button
            onClick={onSave}
            disabled={busy}
            className="text-xs rounded px-2.5 py-1 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-40"
          >
            Split Encounter
          </button>
        )}
        <span className="text-[10px] text-gray-600">
          Made by <span className="text-accent font-medium">Noirblanc</span>
          <span className="text-gray-700 mx-1.5">·</span>
          Background by{' '}
          <button
            onClick={() => openExternal('https://www.youtube.com/watch?v=jwLMaRNzg3I')}
            className="text-accent/80 hover:text-accent underline-offset-2 hover:underline transition-colors"
          >
            DDal
          </button>
        </span>
      </div>
    </footer>
  );
}
