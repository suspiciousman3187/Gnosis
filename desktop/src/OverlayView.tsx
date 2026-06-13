import { useEffect, useMemo, useState } from 'react';
import { inTauri } from './library';
import { useBoxes } from './multibox';

const AUTO_PROMOTE_KEY  = 'gnosis_overlay_auto_promote_on_death';
const FOLLOW_TARGET_KEY = 'gnosis_overlay_follow_my_target';
const FOLLOW_CHAR_KEY   = 'gnosis_overlay_follow_target_char';

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-row-even border border-white/10 rounded-xl p-5">
      <div className="text-[10px] font-bold uppercase tracking-wide text-gray-400 mb-3">{title}</div>
      {children}
    </div>
  );
}

function Toggle({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      role="switch"
      aria-checked={on}
      className={`shrink-0 ml-4 relative w-11 h-6 rounded-full transition-colors ${on ? 'bg-accent/70' : 'bg-white/15'}`}
    >
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${on ? 'left-[22px]' : 'left-0.5'}`} />
    </button>
  );
}

export default function OverlayView({
  open, onToggleOpen, ct, onToggleCT, scale, onScaleChange, demo, onToggleDemo, compact, onToggleCompact, opacity, onOpacityChange,
}: {
  open: boolean;
  onToggleOpen: () => void;
  ct: boolean;
  onToggleCT: () => void;
  scale: number;
  onScaleChange: (s: number) => void;
  demo: boolean;
  onToggleDemo: () => void;
  compact: boolean;
  onToggleCompact: () => void;
  opacity: number;
  onOpacityChange: (o: number) => void;
}) {
  if (!inTauri) {
    return (
      <div className="space-y-6">
        <p className="text-gray-500 text-sm">The live overlay is only available in the desktop app.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card title="Live Overlay">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm text-gray-200">DPS Meter Overlay</div>
            <div className="text-[11px] text-gray-500">A small floating window showing live party DPS, damage, deaths, and enemy HP while tracking.</div>
          </div>
          <button
            onClick={onToggleOpen}
            className={`shrink-0 ml-4 text-sm px-4 py-1.5 rounded-lg border transition-colors ${
              open ? 'border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10' : 'bg-accent/20 border-accent/50 text-accent hover:bg-accent/30'
            }`}
          >
            {open ? 'Close' : 'Open'}
          </button>
        </div>
      </Card>

      <Card title="Window">
        {/* Always On Top moved to the overlay's own titlebar pin glyph
            (see OverlayApp.tsx). One toggle, in context - duplicating it
            here just split the surface area and confused users. */}
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm text-gray-200">Click-Through</div>
            <div className="text-[11px] text-gray-500">Let clicks pass through the overlay to the game. Turn off here to move/resize it again.</div>
          </div>
          <Toggle on={ct} onClick={onToggleCT} />
        </div>

        <div className="mt-4 pt-4 border-t border-white/5">
          <div className="flex items-center justify-between mb-2">
            <div className="text-sm text-gray-200">Opacity</div>
            <span className="text-sm font-mono text-accent">{Math.round(opacity * 100)}%</span>
          </div>
          <input
            type="range"
            min={0.2}
            max={1}
            step={0.05}
            value={opacity}
            onChange={e => onOpacityChange(parseFloat(e.target.value))}
            className="w-full accent-accent"
          />
          <div className="text-[11px] text-gray-500 mt-1.5">How see-through the overlay background is. Text stays readable.</div>
        </div>

        <div className="mt-4 pt-4 border-t border-white/5">
          <div className="flex items-center justify-between mb-2">
            <div className="text-sm text-gray-200">Text Size</div>
            <span className="text-sm font-mono text-accent">{Math.round(scale * 100)}%</span>
          </div>
          <input
            type="range"
            min={0.8}
            max={2}
            step={0.05}
            value={scale}
            onChange={e => onScaleChange(parseFloat(e.target.value))}
            className="w-full accent-accent"
          />
          <div className="text-[11px] text-gray-500 mt-1.5">Scales everything in the overlay. The window is resizable - drag its edges to fit.{!open && <span className="text-gray-400"> Open the overlay to preview.</span>}</div>
        </div>

        <div className="flex items-center justify-between mt-4 pt-4 border-t border-white/5">
          <div>
            <div className="text-sm text-gray-200">Compact Mode</div>
            <div className="text-[11px] text-gray-500">One line per player with a job badge instead of an icon - fits a full party in the normal overlay size.</div>
          </div>
          <Toggle on={compact} onClick={onToggleCompact} />
        </div>
      </Card>

      <Card title="Preview">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm text-gray-200">Show Demo Data</div>
            <div className="text-[11px] text-gray-500">Fills the overlay with a sample party, enemies, and damage so you can see your layout/size changes in a full scenario without being in combat.</div>
          </div>
          <Toggle on={demo} onClick={onToggleDemo} />
        </div>
        {demo && !open && <p className="text-[11px] text-amber-300/80 mt-2">Open the overlay to see the demo.</p>}
      </Card>
    </div>
  );
}

function BehaviorSettings() {
  const [onKill, setOnKill] = useState<boolean>(() => localStorage.getItem(AUTO_PROMOTE_KEY) !== '0');
  const [onTarget, setOnTarget] = useState<boolean>(() => localStorage.getItem(FOLLOW_TARGET_KEY) === '1');
  const [followChar, setFollowChar] = useState<string>(() => localStorage.getItem(FOLLOW_CHAR_KEY) ?? '');

  useEffect(() => { localStorage.setItem(AUTO_PROMOTE_KEY,  onKill   ? '1' : '0'); }, [onKill]);
  useEffect(() => { localStorage.setItem(FOLLOW_TARGET_KEY, onTarget ? '1' : '0'); }, [onTarget]);
  useEffect(() => { localStorage.setItem(FOLLOW_CHAR_KEY,   followChar); }, [followChar]);

  const boxes = useBoxes();
  const connectedNames = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const b of boxes) {
      const n = b.self?.name;
      if (!n || seen.has(n)) continue;
      seen.add(n); out.push(n);
    }
    return out.sort((a, b) => a.localeCompare(b));
  }, [boxes]);

  useEffect(() => {
    if (onTarget && !followChar && connectedNames.length > 0) setFollowChar(connectedNames[0]);
  }, [onTarget, followChar, connectedNames]);

  return (
    <>
      <div className="text-sm text-gray-200 mb-2">Automatically Refocus Overlay</div>
      <label className="flex items-start gap-3 cursor-pointer py-2">
        <input
          type="checkbox"
          checked={onKill}
          onChange={e => setOnKill(e.target.checked)}
          className="mt-0.5 accent-accent shrink-0"
        />
        <div>
          <div className="text-sm text-gray-200">Switch To Next Lowest HP Target</div>
          <div className="text-[11px] text-gray-500">Switches to the next target with the lowest HP.</div>
        </div>
      </label>
      <label className="flex items-start gap-3 cursor-pointer py-2 mt-1 pt-3 border-t border-white/5">
        <input
          type="checkbox"
          checked={onTarget}
          onChange={e => setOnTarget(e.target.checked)}
          className="mt-0.5 accent-accent shrink-0"
        />
        <div className="flex-1">
          <div className="text-sm text-gray-200">Switch on Player Target</div>
          <div className="text-[11px] text-gray-500">Switches focus based on the player&apos;s current target.</div>
          {onTarget && (
            <div className="mt-3">
              <div className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold mb-1.5">Follow target of</div>
              {connectedNames.length === 0 ? (
                <div className="text-[11px] text-gray-500 italic">No characters connected yet - start the addon in-game to populate this list.</div>
              ) : (
                <select
                  value={followChar}
                  onChange={e => setFollowChar(e.target.value)}
                  className="bg-panel-alt/60 border border-white/10 rounded px-2 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-accent/40"
                >
                  {/* If the saved name isn't currently connected (offline /
                      changed boxes), keep it in the list so it's not silently
                      dropped on next session. */}
                  {followChar && !connectedNames.includes(followChar) && (
                    <option value={followChar}>{followChar} (offline)</option>
                  )}
                  {connectedNames.map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              )}
            </div>
          )}
        </div>
      </label>
    </>
  );
}
