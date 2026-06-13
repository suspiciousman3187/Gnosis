'use client';

import { useMemo, useState } from 'react';
import { CONTENT_REGISTRY, ADDON_SOURCE_COLOR, ADDON_SOURCE_LABEL } from '@/lib/contentRegistry';

interface Swatch {
  /** Solid background color in hex (#rrggbb). Alpha applied separately. */
  chipBg: string;
  /** Background opacity 0-100 (matches Tailwind /NN suffix). */
  chipBgAlpha: number;
  /** Chip foreground text color (hex). */
  chipText: string;
  /** Chip border color (hex). */
  chipBorder: string;
  /** Border opacity 0-100. */
  chipBorderAlpha: number;
  /** Accent text used for boss-list headings / off-state titles (hex). */
  accent: string;
}

const SEEDS: Record<string, Swatch> = {
  sortie:      { chipBg: '#9333ea', chipBgAlpha: 35, chipText: '#f3e8ff', chipBorder: '#a855f7', chipBorderAlpha: 60, accent: '#d8b4fe' },
  'sheol-a':   { chipBg: '#14b8a6', chipBgAlpha: 25, chipText: '#99f6e4', chipBorder: '#14b8a6', chipBorderAlpha: 50, accent: '#2dd4bf' },
  'sheol-b':   { chipBg: '#f59e0b', chipBgAlpha: 25, chipText: '#fde68a', chipBorder: '#f59e0b', chipBorderAlpha: 50, accent: '#fbbf24' },
  'sheol-c':   { chipBg: '#84cc16', chipBgAlpha: 25, chipText: '#d9f99d', chipBorder: '#84cc16', chipBorderAlpha: 50, accent: '#a3e635' },
  'sheol-floors': { chipBg: '#ffffff', chipBgAlpha: 10, chipText: '#e5e7eb', chipBorder: '#ffffff', chipBorderAlpha: 25, accent: '#cbd5e1' },
  'sheol-gaol':{ chipBg: '#b91c1c', chipBgAlpha: 35, chipText: '#fee2e2', chipBorder: '#b91c1c', chipBorderAlpha: 60, accent: '#fca5a5' },
  omen:        { chipBg: '#3f6212', chipBgAlpha: 35, chipText: '#ecfccb', chipBorder: '#4d7c0f', chipBorderAlpha: 60, accent: '#bef264' },
  'dynamis-d': { chipBg: '#f97316', chipBgAlpha: 25, chipText: '#ffedd5', chipBorder: '#f97316', chipBorderAlpha: 50, accent: '#fb923c' },
  'geas-fete': { chipBg: '#06b6d4', chipBgAlpha: 25, chipText: '#a5f3fc', chipBorder: '#06b6d4', chipBorderAlpha: 50, accent: '#22d3ee' },
  limbus:      { chipBg: '#3b82f6', chipBgAlpha: 25, chipText: '#bfdbfe', chipBorder: '#3b82f6', chipBorderAlpha: 50, accent: '#60a5fa' },
  ambuscade:   { chipBg: '#b45309', chipBgAlpha: 35, chipText: '#fef3c7', chipBorder: '#b45309', chipBorderAlpha: 60, accent: '#fcd34d' },
  unity:       { chipBg: '#d946ef', chipBgAlpha: 25, chipText: '#f5d0fe', chipBorder: '#d946ef', chipBorderAlpha: 50, accent: '#e879f9' },
  // Addon-source-only entries (no ContentDef in registry).
  odyssey:     { chipBg: '#4338ca', chipBgAlpha: 35, chipText: '#e0e7ff', chipBorder: '#4338ca', chipBorderAlpha: 60, accent: '#a5b4fc' },
};

function hexToRgba(hex: string, alphaPct: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const a = Math.max(0, Math.min(100, alphaPct)) / 100;
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

interface RowSpec {
  id: string;
  label: string;
  source: 'def' | 'addon';
}

function buildRows(): RowSpec[] {
  const rows: RowSpec[] = [];
  for (const def of CONTENT_REGISTRY) rows.push({ id: def.id, label: def.name, source: 'def' });
  const seenIds = new Set(rows.map(r => r.id));
  for (const [src, _color] of Object.entries(ADDON_SOURCE_COLOR)) {
    if (src === 'generic') continue;
    if (seenIds.has(src)) continue;
    const label = ADDON_SOURCE_LABEL[src as keyof typeof ADDON_SOURCE_LABEL] ?? src;
    rows.push({ id: src, label, source: 'addon' });
  }
  return rows;
}

export default function PaletteConfigurator() {
  const rows = useMemo(buildRows, []);
  const [state, setState] = useState<Record<string, Swatch>>(() => {
    const out: Record<string, Swatch> = {};
    for (const r of rows) out[r.id] = { ...(SEEDS[r.id] ?? SEEDS.sortie) };
    return out;
  });
  const [copied, setCopied] = useState(false);

  const update = (id: string, patch: Partial<Swatch>) => setState(s => ({ ...s, [id]: { ...s[id], ...patch } }));
  const reset = (id: string) => setState(s => ({ ...s, [id]: { ...(SEEDS[id] ?? SEEDS.sortie) } }));

  const exportJson = useMemo(() => JSON.stringify(state, null, 2), [state]);
  const copy = async () => {
    try { await navigator.clipboard.writeText(exportJson); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {}
  };

  return (
    <main className="min-h-screen bg-surface text-white p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        <header className="space-y-2">
          <h1 className="text-2xl font-bold">Content Palette Configurator</h1>
          <p className="text-sm text-gray-400">
            Tweak each content tag's chip + accent colors in raw hex. Live preview on the right. When you&apos;re happy,
            hit <span className="text-accent font-semibold">Copy JSON</span> at the bottom and paste it back — I&apos;ll translate to
            the closest Tailwind classes.
          </p>
        </header>

        <ul className="space-y-4">
          {rows.map(r => {
            const s = state[r.id];
            const chipStyle = {
              background: hexToRgba(s.chipBg, s.chipBgAlpha),
              color: s.chipText,
              borderColor: hexToRgba(s.chipBorder, s.chipBorderAlpha),
            };
            return (
              <li key={r.id} className="rounded-xl border border-white/10 bg-row-even p-4 space-y-3">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-3">
                    <span className="text-base font-semibold text-gray-100">{r.label}</span>
                    <span className="text-[10px] uppercase tracking-wide text-gray-500 font-mono">{r.id}</span>
                    {r.source === 'addon' && (
                      <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border border-white/15 text-gray-400">addon-source only</span>
                    )}
                  </div>
                  <button
                    onClick={() => reset(r.id)}
                    className="text-xs text-gray-400 hover:text-white transition-colors px-2 py-1 rounded border border-white/10 hover:border-white/30"
                  >
                    Reset
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-4 items-start">
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                    <PickerRow label="Chip background" hex={s.chipBg} onHex={v => update(r.id, { chipBg: v })} alpha={s.chipBgAlpha} onAlpha={v => update(r.id, { chipBgAlpha: v })} />
                    <PickerRow label="Chip border"     hex={s.chipBorder} onHex={v => update(r.id, { chipBorder: v })} alpha={s.chipBorderAlpha} onAlpha={v => update(r.id, { chipBorderAlpha: v })} />
                    <PickerRow label="Chip text"       hex={s.chipText} onHex={v => update(r.id, { chipText: v })} />
                    <PickerRow label="Accent text"     hex={s.accent} onHex={v => update(r.id, { accent: v })} />
                  </div>

                  <div className="flex flex-col items-center gap-3 sm:items-end min-w-[12rem]">
                    <div>
                      <div className="text-[10px] uppercase text-gray-500 mb-1 tracking-wide">Badge preview</div>
                      <span
                        className="inline-flex items-center justify-center text-[9px] uppercase font-bold tracking-wide px-1.5 py-0.5 rounded border whitespace-nowrap min-w-[3.5rem]"
                        style={chipStyle}
                      >
                        {r.label}
                      </span>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase text-gray-500 mb-1 tracking-wide">Boss heading preview</div>
                      <div
                        className="text-[10px] uppercase tracking-wide font-semibold border-t border-current/40 px-3 pt-2 pb-1"
                        style={{ color: s.accent }}
                      >
                        Bosses
                      </div>
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>

        <section className="rounded-xl border border-white/10 bg-row-even p-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-bold uppercase tracking-wide text-gray-300">Export</h2>
            <button
              onClick={copy}
              className="text-xs text-accent hover:underline px-3 py-1 rounded border border-accent/40 hover:border-accent/70"
            >
              {copied ? 'Copied!' : 'Copy JSON'}
            </button>
          </div>
          <textarea
            readOnly
            value={exportJson}
            className="w-full h-72 font-mono text-xs bg-black/40 border border-white/10 rounded p-3 text-gray-200"
          />
          <p className="text-xs text-gray-500">
            Send this JSON back when you&apos;re done — I&apos;ll translate the hex values to the closest Tailwind shades and rewire the registry.
          </p>
        </section>
      </div>
    </main>
  );
}

function PickerRow({ label, hex, onHex, alpha, onAlpha }: {
  label: string;
  hex: string;
  onHex: (v: string) => void;
  alpha?: number;
  onAlpha?: (v: number) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-gray-400 uppercase tracking-wide text-[10px]">{label}</span>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={hex}
          onChange={e => onHex(e.target.value)}
          className="h-7 w-12 rounded border border-white/15 bg-transparent cursor-pointer"
        />
        <input
          type="text"
          value={hex}
          onChange={e => onHex(e.target.value)}
          className="w-20 font-mono text-xs bg-black/40 border border-white/10 rounded px-2 py-1 text-gray-200"
        />
        {alpha != null && onAlpha && (
          <>
            <input
              type="range"
              min={0}
              max={100}
              value={alpha}
              onChange={e => onAlpha(parseInt(e.target.value, 10))}
              className="flex-1 min-w-[5rem]"
            />
            <span className="w-9 text-right text-gray-400 font-mono text-xs">{alpha}%</span>
          </>
        )}
      </div>
    </label>
  );
}
