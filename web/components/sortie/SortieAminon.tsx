'use client';

import { useState, Fragment, type ReactNode } from 'react';
import type { RunRecord, ActionLogEntry, BossHpEntry } from '@/lib/types';
import { isWeaponSkill, isAutoAttack, isSpell } from '@/lib/actionCategory';
import { M as ACTION_MSG, swingsOf } from '@/lib/combatStats';
import { BossReportSection } from '@/lib/reportShared';
import type { GearIndex } from '@/lib/gearLookup';
import { StatRow, formatDuration, fmtFightTime } from './SortieHelpers';
import { synthesizeAminonReport, isSynthesizedAminon } from '@/lib/aminonSynth';

const ACTION_DEDUP_WINDOW_SEC = 3;
function dedupActionLog(log: ActionLogEntry[] | null | undefined): ActionLogEntry[] | null {
  if (!log || log.length === 0) return log ?? null;
  const sorted = [...log].sort((a, b) => a.elapsed - b.elapsed);
  const lastByKey = new Map<string, number>();
  const out: ActionLogEntry[] = [];
  for (const e of sorted) {
    const k = `${e.playerId ?? 0}:${e.player}:${e.category ?? 0}:${e.param ?? 0}:${e.phase ?? ''}:${e.targets?.[0]?.id ?? 0}`;
    const prev = lastByKey.get(k);
    if (prev != null && e.elapsed - prev <= ACTION_DEDUP_WINDOW_SEC) continue;
    lastByKey.set(k, e.elapsed);
    out.push(e);
  }
  return out;
}

function AbsorbTpPanel({ actionLog, fightDurationSeconds, fightStartElapsed, bossHpLog }: { actionLog: ActionLogEntry[] | null; fightDurationSeconds: number; fightStartElapsed?: number; bossHpLog: BossHpEntry[] | null }) {
  const [tab, setTab] = useState<'absorb' | 'ws'>('absorb');
  const [open, setOpen] = useState(false);
  const [enabledPlayers, setEnabledPlayers] = useState<Set<string>>(new Set());
  const togglePlayer = (p: string) =>
    setEnabledPlayers(prev => {
      const n = new Set(prev);
      if (n.has(p)) n.delete(p); else n.add(p);
      return n;
    });
  const [openCasts, setOpenCasts] = useState<Set<string>>(new Set());
  const toggleCast = (key: string) =>
    setOpenCasts(prev => {
      const n = new Set(prev);
      if (n.has(key)) n.delete(key); else n.add(key);
      return n;
    });
  if (!actionLog || actionLog.length === 0) return null;
  const perPlayer = new Map<string, { casts: number; absorbed: number }>();
  const casts: { elapsed: number; player: string; amount: number }[] = [];
  const bossTp: { elapsed: number; name: string }[] = [];
  const wsTimes: number[] = [];
  const wsByPlayer = new Map<string, { count: number; misses: number; dmgs: number[] }>();
  const SPELL_SET = new Set(['Thundara III', 'Thunder V', 'Impact', 'Dia III']);
  const spellTimes: number[] = [];
  const autoTimes: number[] = [];
  const events: { elapsed: number; kind: 'ws' | 'spell' | 'auto' | 'absorb'; name: string; player: string }[] = [];
  for (const e of actionLog) {
    const targets = e.targets ?? (e.mob ? [{ mob: e.mob, damage: e.damage ?? 0, result: e.result ?? 'hit' }] : []);
    const hitsAminon = targets.some(t => t.mob === 'Aminon');
    if (e.name === 'Absorb-TP') {
      if (!hitsAminon) continue;
      const amt = targets.filter(t => t.mob === 'Aminon').reduce((s, t) => s + (t.damage ?? 0), 0);
      const row = perPlayer.get(e.player) ?? { casts: 0, absorbed: 0 };
      row.casts += 1;
      row.absorbed += amt;
      perPlayer.set(e.player, row);
      casts.push({ elapsed: e.elapsed, player: e.player, amount: amt });
      events.push({ elapsed: e.elapsed, kind: 'absorb', name: 'Absorb-TP', player: e.player });
    } else if (e.player === 'Aminon' && !isSpell(e)
               && !/auto[- ]?attack/i.test(e.name)) {
      bossTp.push({ elapsed: e.elapsed, name: e.name });
    } else if (isWeaponSkill(e) && e.player !== 'Aminon' && hitsAminon) {
      wsTimes.push(e.elapsed);
      events.push({ elapsed: e.elapsed, kind: 'ws', name: e.name, player: e.player });
      let landedDmg = 0;
      let landed = false;
      let missed = false;
      for (const t of targets.filter(t => t.mob === 'Aminon')) {
        const swings = swingsOf(t);
        let sawMsg = false;
        for (const s of swings) {
          if (s.m == null) continue;
          sawMsg = true;
          if (ACTION_MSG.wsHit.has(s.m)) { landed = true; landedDmg += s.d || 0; }
          else if (ACTION_MSG.wsMiss.has(s.m)) { missed = true; }
        }
        if (!sawMsg) {
          if (t.result === 'miss') missed = true;
          else { landed = true; landedDmg += t.damage || 0; }
        }
      }
      const row = wsByPlayer.get(e.player) ?? { count: 0, misses: 0, dmgs: [] };
      row.count += 1;
      if (missed && !landed) row.misses += 1;
      if (landed) row.dmgs.push(landedDmg);
      wsByPlayer.set(e.player, row);
    } else if (SPELL_SET.has(e.name) && e.player !== 'Aminon' && hitsAminon) {
      spellTimes.push(e.elapsed);
      events.push({ elapsed: e.elapsed, kind: 'spell', name: e.name, player: e.player });
    } else if (isAutoAttack(e) && e.player !== 'Aminon' && hitsAminon) {
      autoTimes.push(e.elapsed);
      events.push({ elapsed: e.elapsed, kind: 'auto', name: e.name || 'Auto Attack', player: e.player });
    }
  }
  if (perPlayer.size === 0) return null;
  wsTimes.sort((a, b) => a - b);
  spellTimes.sort((a, b) => a - b);
  autoTimes.sort((a, b) => a - b);
  events.sort((a, b) => a.elapsed - b.elapsed);
  const hpSeries = (bossHpLog ?? [])
    .filter(h => h.name === 'Aminon')
    .sort((a, b) => a.elapsed - b.elapsed);
  const hpAt = (t: number): number | null => {
    let best: number | null = null;
    for (const h of hpSeries) { if (h.elapsed <= t) best = h.hpp; else break; }
    return best;
  };
  const lastAttackBefore = (t: number): number | null => {
    let best: number | null = null;
    for (const arr of [wsTimes, spellTimes, autoTimes]) {
      for (const v of arr) { if (v <= t) { if (best == null || v > best) best = v; } else break; }
    }
    return best;
  };
  const fmtGap = (s: number) => s < 60 ? `${s}s` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  const hpColor = (hp: number | null): string => {
    if (hp == null) return 'text-gray-400';
    if (hp >= 80) return 'text-emerald-400';
    if (hp >= 60) return 'text-lime-300';
    if (hp >= 40) return 'text-amber-300';
    if (hp >= 20) return 'text-orange-400';
    return 'text-rose-400';
  };
  const fightMin = fightDurationSeconds > 0 ? fightDurationSeconds / 60 : 0;
  const rows = Array.from(perPlayer.entries())
    .map(([player, r]) => ({ player, ...r, perMin: fightMin > 0 ? r.casts / fightMin : 0 }))
    .sort((a, b) => b.absorbed - a.absorbed);
  const wsRows = Array.from(wsByPlayer.entries())
    .map(([player, r]) => {
      const hits = r.dmgs.length;
      const totalDmg = r.dmgs.reduce((s, d) => s + d, 0);
      return {
        player,
        count: r.count,
        misses: r.misses,
        acc: r.count > 0 ? (r.count - r.misses) / r.count * 100 : 0,
        perMin: fightMin > 0 ? r.count / fightMin : 0,
        avg: hits > 0 ? Math.round(totalDmg / hits) : null,
        min: hits > 0 ? Math.min(...r.dmgs) : null,
        max: hits > 0 ? Math.max(...r.dmgs) : null,
      };
    })
    .sort((a, b) => (b.max ?? 0) - (a.max ?? 0));
  casts.sort((a, b) => a.elapsed - b.elapsed);
  const avgCdByPlayer = new Map<string, number | null>();
  {
    const byP = new Map<string, number[]>();
    for (const c of casts) {
      const arr = byP.get(c.player);
      if (arr) arr.push(c.elapsed); else byP.set(c.player, [c.elapsed]);
    }
    for (const [p, times] of byP) {
      times.sort((a, b) => a - b);
      if (times.length < 2) { avgCdByPlayer.set(p, null); continue; }
      let sum = 0;
      for (let k = 1; k < times.length; k++) sum += times[k] - times[k - 1];
      avgCdByPlayer.set(p, sum / (times.length - 1));
    }
  }
  bossTp.sort((a, b) => a.elapsed - b.elapsed);

  type DetailEv = { elapsed: number; kind: 'ws' | 'spell' | 'auto' | 'absorb'; name: string; player: string; gap: number };
  type TLRow =
    | { kind: 'absorb'; elapsed: number; player: string; amount: number; sinceAttack: number | null; sinceAbsorb: number | null; attackSinceAbsorb: number; hpp: number | null; overlap: boolean; detail: DetailEv[] }
    | { kind: 'tp'; elapsed: number; name: string };
  const timeline: TLRow[] = casts.map((c, i) => {
    const lastAtk = lastAttackBefore(c.elapsed);
    const prevElapsed = i > 0 ? casts[i - 1].elapsed : -Infinity;
    const inGap = (arr: number[]) => arr.filter(w => w > prevElapsed && w <= c.elapsed).length;
    const overlap = (i > 0 && c.elapsed - casts[i - 1].elapsed === 0)
      || (i < casts.length - 1 && casts[i + 1].elapsed - c.elapsed === 0);
    return {
      kind: 'absorb' as const,
      ...c,
      overlap,
      sinceAttack: lastAtk != null ? c.elapsed - lastAtk : null,
      sinceAbsorb: i > 0 ? c.elapsed - casts[i - 1].elapsed : null,
      attackSinceAbsorb: inGap(wsTimes) + inGap(spellTimes) + inGap(autoTimes),
      hpp: hpAt(c.elapsed),
      detail: (() => {
        const win = events.filter(ev => ev.elapsed >= prevElapsed && ev.elapsed <= c.elapsed);
        const base = Number.isFinite(prevElapsed) ? prevElapsed : (win[0]?.elapsed ?? c.elapsed);
        return win.map(ev => ({ ...ev, gap: Math.max(0, ev.elapsed - base) }));
      })(),
    };
  });
  const BEFORE = 3, AFTER = 25;
  const seenTp = new Set<string>();
  for (const c of casts) {
    if (c.amount <= 300) continue;
    for (const tp of bossTp) {
      if (tp.elapsed >= c.elapsed - BEFORE && tp.elapsed <= c.elapsed + AFTER) {
        const key = `${tp.elapsed}|${tp.name}`;
        if (seenTp.has(key)) continue;
        seenTp.add(key);
        timeline.push({ kind: 'tp', elapsed: tp.elapsed, name: tp.name });
      }
    }
  }
  timeline.sort((a, b) => a.elapsed - b.elapsed || (a.kind === 'tp' ? -1 : 1));
  const players = [...new Set(casts.map(c => c.player))].sort();
  const shownTimeline = enabledPlayers.size > 0
    ? timeline.filter(r => r.kind === 'absorb' && enabledPlayers.has(r.player))
    : timeline;

  return (
    <section className="bg-row-even border border-white/10 rounded-xl overflow-hidden">
      <div className="flex border-b border-white/[0.08]">
        {([
          { id: 'absorb' as const, label: 'Absorb-TP'    },
          { id: 'ws'     as const, label: 'Weaponskills' },
        ]).map(t => {
          const on = t.id === tab;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`relative flex-1 px-3 py-3 text-sm font-semibold uppercase tracking-wide transition-colors ${
                on ? 'text-accent bg-white/[0.03]' : 'text-gray-400 hover:text-gray-200 hover:bg-white/[0.02]'
              }`}
            >
              {t.label}
              {on && <span className="absolute inset-x-0 -bottom-px h-0.5 bg-accent" />}
            </button>
          );
        })}
      </div>

      {tab === 'absorb' && (
      <div className="p-5">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-gray-400 text-xs uppercase tracking-wide border-b border-white/10">
            <th className="text-center pb-2">PLAYER</th>
            <th className="text-center pb-2">CASTS</th>
            <th className="text-center pb-2">TOTAL ABSORBED</th>
            <th className="text-center pb-2">AVG / CAST</th>
            <th className="text-center pb-2">CASTS / MIN</th>
            <th className="text-center pb-2">AVG CD</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => {
            const avgCd = avgCdByPlayer.get(r.player);
            return (
            <tr key={r.player} className="border-b border-white/[0.08]">
              <td className="py-2 text-center text-white">{r.player}</td>
              <td className="py-2 text-center text-gray-400">{r.casts}</td>
              <td className="py-2 text-center text-sky-400 font-medium">{r.absorbed.toLocaleString()}</td>
              <td className="py-2 text-center text-emerald-400 font-mono">{r.casts > 0 ? Math.round(r.absorbed / r.casts).toLocaleString() : '-'}</td>
              <td className="py-2 text-center text-amber-400 font-mono">{r.perMin.toFixed(2)}</td>
              <td className="py-2 text-center text-gray-300 font-mono">{avgCd != null ? fmtGap(Math.round(avgCd)) : '-'}</td>
            </tr>
            );
          })}
        </tbody>
      </table>

      <button
        onClick={() => setOpen(o => !o)}
        className="mt-4 flex items-center justify-between w-full text-left"
      >
        <span className="text-xs text-gray-400 uppercase tracking-wide">
          Absorb Timeline <span className="ml-1.5 text-gray-400 font-mono">{casts.length}</span>
        </span>
        <span className="text-xs text-gray-400">{open ? '▾ collapse' : '▸ expand'}</span>
      </button>

      {open && (
        <>
          <div className="mt-3 flex items-center gap-2">
            <span className="w-16 shrink-0 text-[10px] uppercase tracking-wide text-gray-400 font-semibold">
              Player
            </span>
            <div className="flex flex-1 rounded-md border border-white/15 overflow-hidden">
              {players.map(p => {
                const on = enabledPlayers.has(p);
                return (
                  <button
                    key={p}
                    onClick={() => togglePlayer(p)}
                    className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1 text-xs transition-colors border-r border-white/10 last:border-r-0 ${
                      on ? 'bg-white/[0.06] text-sky-300' : 'text-gray-400 bg-transparent hover:bg-white/[0.02]'
                    }`}
                  >
                    <span className={`w-2 h-2 rounded-full inline-block shrink-0 ${on ? 'bg-sky-400' : 'bg-white/10'}`} />
                    {p}
                  </button>
                );
              })}
            </div>
            {enabledPlayers.size > 0 && (
              <button
                onClick={() => setEnabledPlayers(new Set())}
                className="shrink-0 text-xs text-gray-400 hover:text-gray-300"
              >
                clear
              </button>
            )}
          </div>
          <div className="mt-3 rounded-lg border border-white/10 bg-panel-alt/30 p-3">
            <div className="text-[10px] uppercase tracking-wide text-gray-400 mb-2">Column key</div>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-[11px]">
              {([
                ['Attack', <>An <span className="text-gray-300 font-medium">Attack</span> = a weaponskill, a tracked spell, or a melee auto-attack on Aminon (tracked spells: <span className="text-sky-300 font-medium">{[...SPELL_SET].join(', ')}</span>)</>],
                ['Attack Gap', 'Time since the last attack (WS / spell / auto) landed on Aminon'],
                ['Attack #', 'WS + tracked-spell + melee-auto count on Aminon since the previous absorb'],
                ['Absorb Gap', 'Time since the previous Absorb-TP cast'],
              ] as [string, ReactNode][]).map(([k, v]) => (
                <div key={k} className="flex gap-2">
                  <dt className="text-gray-300 font-medium whitespace-nowrap">{k}</dt>
                  <dd className="text-gray-400">- {v}</dd>
                </div>
              ))}
            </dl>
            <div className="text-[11px] text-gray-400 mt-2">
              Rows expand to show every attack (WS / tracked spell / auto) and absorb since the previous absorb.
              <span className="text-red-600 font-bold">8s+</span> gaps are flagged.
            </div>
          </div>
          <table className="w-full text-sm mt-2">
            <thead>
              <tr className="text-gray-400 text-xs border-b border-white/10">
                <th className="text-right pb-2 w-20">Time</th>
                <th className="text-right pb-2 px-3">Aminon HP</th>
                <th className="text-left pb-2 px-3">Player</th>
                <th className="text-right pb-2 px-3">Attack Gap</th>
                <th className="text-right pb-2 px-3">Attack #</th>
                <th className="text-right pb-2 px-3">Absorb Gap</th>
                <th className="text-right pb-2 pr-3">Absorbed TP</th>
              </tr>
            </thead>
            <tbody>
              {shownTimeline.map((row, i) => {
                if (row.kind === 'tp') {
                  return (
                    <tr key={i} className="border-b border-white/[0.06] last:border-0 bg-rose-950/60">
                      <td className="py-1.5 text-right text-gray-400 font-mono text-xs pr-3">{fmtFightTime(row.elapsed, fightStartElapsed)}</td>
                      <td className="py-1.5 px-3"></td>
                      <td className="py-1.5 px-3 text-rose-400 italic font-medium">Aminon - {row.name}</td>
                      <td className="py-1.5 px-3"></td>
                      <td className="py-1.5 px-3"></td>
                      <td className="py-1.5 px-3"></td>
                      <td className="py-1.5 text-right pr-3 whitespace-nowrap text-rose-500 font-semibold">TP MOVE</td>
                    </tr>
                  );
                }
                const high = row.amount > 300;
                const low = row.amount < 50;
                const rowCls = high ? 'bg-red-500/10' : low ? 'bg-blue-500/10' : '';
                const amtCls = high ? 'text-red-400 font-semibold' : low ? 'text-blue-400 font-semibold' : 'text-emerald-400';
                const key = `${row.elapsed}-${row.player}`;
                const isOpen = openCasts.has(key);
                return (
                  <Fragment key={i}>
                    <tr
                      className={`border-b border-white/[0.06] cursor-pointer hover:bg-white/[0.03] ${rowCls} ${row.overlap ? 'border-l-2 border-l-orange-500' : ''}`}
                      onClick={() => toggleCast(key)}
                    >
                      <td className={`py-1.5 text-right font-mono text-xs pr-3 ${row.overlap ? 'text-orange-400 font-bold' : 'text-gray-400'}`}>{fmtFightTime(row.elapsed, fightStartElapsed)}</td>
                      <td className={`py-1.5 px-3 text-right font-mono ${hpColor(row.hpp)}`}>{row.hpp != null ? `${row.hpp}%` : '-'}</td>
                      <td className="py-1.5 px-3 text-white">
                        <span className="text-gray-400 text-xs mr-1.5">{isOpen ? '▾' : '▸'}</span>{row.player}
                        {row.overlap && <span className="ml-1.5 text-[10px] font-bold uppercase tracking-wide text-orange-400">⚠ overlap</span>}
                        {high && <span className="ml-1.5 text-[10px] font-bold uppercase tracking-wide text-red-400">⚠ High Absorb</span>}
                        {low && <span className="ml-1.5 text-[10px] font-bold uppercase tracking-wide text-blue-400">⚠ Low Absorb</span>}
                      </td>
                      <td className={`py-1.5 px-3 text-right font-mono ${row.sinceAttack != null && row.sinceAttack >= 8 ? 'text-red-600 font-bold' : 'text-gray-400'}`}>{row.sinceAttack != null ? fmtGap(row.sinceAttack) : '-'}</td>
                      <td className="py-1.5 px-3 text-right font-mono text-gray-400">{row.attackSinceAbsorb}</td>
                      <td className={`py-1.5 px-3 text-right font-mono ${row.sinceAbsorb != null && row.sinceAbsorb >= 8 ? 'text-red-500 font-bold' : 'text-gray-400'}`}>{row.sinceAbsorb != null ? fmtGap(row.sinceAbsorb) : '-'}</td>
                      <td className={`py-1.5 text-right pr-3 font-mono ${amtCls}`}>{row.amount.toLocaleString()}</td>
                    </tr>
                    {isOpen && (row.detail.length === 0 ? (
                      <tr className="border-b border-white/[0.06] bg-panel-alt/30">
                        <td colSpan={7} className="py-2 px-3 text-xs text-gray-400 italic">
                          No attacks or absorbs since the previous absorb.
                        </td>
                      </tr>
                    ) : row.detail.map((ev, j) => {
                      const tcls = ev.kind === 'ws' ? 'text-amber-400'
                        : ev.kind === 'spell' ? 'text-sky-400'
                        : ev.kind === 'auto' ? 'text-zinc-400'
                        : 'text-emerald-400';
                      const label = ev.kind === 'ws' ? 'WS'
                        : ev.kind === 'spell' ? 'Spell'
                        : ev.kind === 'auto' ? 'Auto'
                        : 'Absorb';
                      const gcls = ev.gap >= 15 ? 'text-red-500 font-bold'
                        : ev.gap >= 8 ? 'text-orange-400'
                        : 'text-blue-400';
                      const last = j === row.detail.length - 1;
                      return (
                        <tr key={`d-${i}-${j}`} className={`bg-panel-alt/20 ${last ? 'border-b border-white/[0.06]' : ''}`}>
                          <td className="py-1 text-right text-gray-400 font-mono text-xs pr-3 w-20">{fmtFightTime(ev.elapsed, fightStartElapsed)}</td>
                          <td className="py-1 px-3" />
                          <td colSpan={3} className="py-1 px-3 whitespace-nowrap">
                            <span className="text-gray-400 mr-1.5">└</span>
                            <span className={`font-medium ${tcls}`}>{label}</span>
                            <span className="text-gray-300"> · {ev.name}</span>
                            <span className="text-gray-400"> · {ev.player}</span>
                          </td>
                          <td className={`py-1 px-3 text-right font-mono ${gcls}`}>{ev.gap}s</td>
                          <td />
                        </tr>
                      );
                    }))}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </>
      )}
      </div>
      )}

      {tab === 'ws' && (
      <div className="p-5">
        {wsRows.length === 0 ? (
          <div className="text-sm text-gray-400 italic py-2">No weaponskills landed on Aminon.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-gray-400 text-xs uppercase tracking-wide border-b border-white/10">
                <th className="text-center pb-2">PLAYER</th>
                <th className="text-center pb-2">CASTS</th>
                <th className="text-center pb-2">ACC</th>
                <th className="text-center pb-2">MISS</th>
                <th className="text-center pb-2">WS / MIN</th>
                <th className="text-center pb-2">MIN</th>
                <th className="text-center pb-2">MAX</th>
                <th className="text-center pb-2">AVG</th>
              </tr>
            </thead>
            <tbody>
              {wsRows.map(w => (
                <tr key={w.player} className="border-b border-white/[0.08]">
                  <td className="py-2 text-center text-white">{w.player}</td>
                  <td className="py-2 text-center text-gray-400">{w.count}</td>
                  <td className={`py-2 text-center font-mono ${w.acc >= 90 ? 'text-emerald-400' : w.acc >= 70 ? 'text-amber-400' : 'text-rose-400'}`}>{w.acc.toFixed(0)}%</td>
                  <td className={`py-2 text-center font-mono ${w.misses > 0 ? 'text-rose-400' : 'text-gray-400'}`}>{w.misses}</td>
                  <td className="py-2 text-center text-gray-300 font-mono">{w.perMin.toFixed(2)}</td>
                  <td className="py-2 text-center text-gray-300 font-mono">{w.min != null ? w.min.toLocaleString() : '-'}</td>
                  <td className="py-2 text-center text-gray-300 font-mono">{w.max != null ? w.max.toLocaleString() : '-'}</td>
                  <td className="py-2 text-center text-gray-300 font-mono">{w.avg != null ? w.avg.toLocaleString() : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      )}
    </section>
  );
}

function AminonSummaryPanel({ run, mode, fightSeconds }: { run: RunRecord; mode: 'normal' | 'hardmode'; fightSeconds: number }) {
  const aminonSeconds = run.area_times?.aminon ?? 0;
  const counts = new Map<string, number>();
  for (const d of run.drop_log ?? []) {
    if (d.type === 'temp' || d.type === 'temporary') continue;
    if (d.area !== 'Aminon') continue;
    counts.set(d.name, (counts.get(d.name) ?? 0) + 1);
  }
  const items = Array.from(counts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  return (
    <div className="bg-row-even border border-white/10 rounded-xl p-4">
      <h4 className="font-semibold text-xs text-gray-400 uppercase tracking-wide mb-2">Sector Summary</h4>
      <div className="space-y-0">
        <StatRow label="Mode" value={mode === 'hardmode' ? 'Hard Mode' : 'Normal Mode'}
                 valueClass={mode === 'hardmode' ? 'text-red-400' : 'text-amber-400'} />
        <StatRow label="Time Spent (Floor)" value={aminonSeconds > 0 ? formatDuration(aminonSeconds) : '-'} />
        <StatRow label="Kill Time (Fight)" value={fightSeconds > 0 ? formatDuration(fightSeconds) : '-'} />
        <div className="pt-2">
          <div className="text-xs text-gray-400 uppercase tracking-wide mb-1.5">Items Obtained</div>
          {items.length === 0 ? (
            <div className="text-xs text-gray-400 italic">None recorded for this sector.</div>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {items.map(({ name, count }) => (
                <span key={name} className="text-xs font-mono bg-panel-alt/60 border border-white/10 rounded px-2 py-0.5 text-emerald-300">
                  {name}{count > 1 ? ` ×${count}` : ''}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function SortieAminon({ r, jobMap, gearIndex }: { r: RunRecord; jobMap: Record<string, string>; gearIndex: GearIndex }) {
  const dedupedActionLog = dedupActionLog(r.action_log);
  const aminon = r.aminon ?? synthesizeAminonReport({ ...r, action_log: dedupedActionLog });
  if (!aminon) {
    return (
      <div className="bg-row-even border border-white/10 rounded-xl p-12 text-center text-gray-400 text-sm">
        No Aminon engagement found in this run.
      </div>
    );
  }
  const aminonKilled = aminon.killed !== false;
  const reconstructed = isSynthesizedAminon(aminon);
  return (
    <div className="space-y-4">
      {reconstructed && (
        <div className="w-full rounded-xl border border-amber-700/50 bg-amber-950/30 px-5 py-2.5 text-center">
          <span className="text-amber-200 text-xs font-bold uppercase tracking-wide">Reconstructed from raw action log</span>
          <span className="text-amber-300/70 text-[11px] ml-2">(addon didn&apos;t flag the fight; Corsair rolls + hardmode detection unavailable)</span>
        </div>
      )}
      {!aminonKilled && (
        <div className="w-full rounded-xl border border-red-700/50 bg-red-950/40 px-5 py-3 text-center">
          <span className="text-red-300 text-base font-bold uppercase tracking-wide">Wipe</span>
        </div>
      )}

      <AminonSummaryPanel run={r} mode={aminon.mode} fightSeconds={aminon.fightDurationSeconds} />

      <BossReportSection
        name="Aminon"
        displayName={aminon.mode === 'hardmode' ? 'Aminon (Hard Mode)' : 'Aminon'}
        report={aminon}
        jobMap={jobMap}
        hideKillTime
        itemUseLog={r.item_use_log?.filter(u => u.area === 'Aminon') ?? null}
        corsairRolls={aminon.rolls}
        actionLog={dedupedActionLog}
        party={r.party ?? []}
        bossReports={r.boss_reports}
        aminon={aminon}
        bossHpLog={r.boss_hp_log ?? null}
        partyHpLog={r.party_hp_log ?? null}
        partyMpLog={r.party_mp_log ?? null}
        partyTpLog={r.party_tp_log ?? null}
        skillchainLog={r.skillchain_log ?? null}
        buffLog={r.buff_log ?? null}
        gearByPlayer={r.gearByPlayer ?? null}
        gearIndex={gearIndex}
        middleSlot={
          <AbsorbTpPanel actionLog={dedupedActionLog} fightDurationSeconds={aminon.fightDurationSeconds} fightStartElapsed={aminon.fightStartElapsed} bossHpLog={r.boss_hp_log} />
        }
      />
    </div>
  );
}
