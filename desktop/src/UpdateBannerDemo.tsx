const labelCls = 'text-[10px] uppercase tracking-wider text-gray-500 font-semibold mt-6 mb-2 border-b border-white/10 pb-1';
const upToDateCls    = 'text-emerald-200 bg-emerald-500/15 border-emerald-500/40 hover:bg-emerald-500/25';
const updateFoundCls = 'text-accent bg-accent/15 border-accent/40 hover:bg-accent/25';
const checkNowCls    = 'text-gray-400 bg-white/[0.04] border-white/15 hover:text-gray-100 hover:bg-white/[0.08] hover:border-white/25';
const checkingCls    = 'text-gray-400 bg-white/[0.05] border-white/15';
const errorCls       = 'text-amber-200 bg-amber-500/15 border-amber-500/40 hover:bg-amber-500/25';
const badgeBaseCls   = 'text-[8.5px] font-bold uppercase tracking-wider border rounded px-1.5 py-0.5 transition-colors';

function PillRow({ heading, version, badges }: { heading: string; version: string; badges: { label: string; cls: string }[] }) {
  return (
    <div className="flex items-stretch gap-5 bg-row-even border border-white/10 rounded-xl px-5 py-4 mb-3">
      {badges.map((b, i) => (
        <div key={i} className="min-w-0 flex flex-col justify-center" style={{ borderLeft: i === 0 ? 'none' : '1px solid rgba(255,255,255,0.1)', paddingLeft: i === 0 ? 0 : 20 }}>
          <div className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold flex items-center gap-1.5">
            {heading}
            <button className={`${badgeBaseCls} ${b.cls}`}>{b.label}</button>
          </div>
          <div className="text-lg font-bold font-mono text-emerald-300">v{version}</div>
        </div>
      ))}
    </div>
  );
}

export default function UpdateBannerDemo({ onClose }: { onClose: () => void }) {
  return (
    <div className="h-screen overflow-y-auto bg-zinc-950">
      <div className="styx-bg" />
      <div className="relative max-w-4xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-2xl font-bold text-gray-100">Updater UI demo</h1>
          <button onClick={onClose} className="text-sm rounded px-3 py-1.5 border border-white/15 text-gray-200 hover:bg-white/[0.06]">
            ← back to app
          </button>
        </div>
        <p className="text-sm text-gray-400 mb-2">
          All overlay states the updater can render. Verify legibility over the meadow background, then close out.
        </p>

        <div className={labelCls}>Nav-bar pill badges (small)</div>
        <PillRow heading="Gnosis" version="1.2.0" badges={[{ label: 'Check now', cls: checkNowCls }]} />
        <PillRow heading="Gnosis" version="1.2.0" badges={[{ label: 'Checking…', cls: checkingCls }]} />
        <PillRow heading="Gnosis" version="1.2.0" badges={[{ label: 'Up to date', cls: upToDateCls }]} />
        <PillRow heading="Gnosis" version="1.2.0" badges={[{ label: 'Update available', cls: updateFoundCls }]} />
        <PillRow heading="Gnosis" version="1.2.0" badges={[{ label: 'Check failed', cls: errorCls }]} />
        <PillRow heading="Addon"  version="1.2.0" badges={[{ label: 'Folder ?', cls: errorCls }]} />

        <div className={labelCls}>Desktop update available</div>
        <div className="bg-row-odd border border-accent/50 rounded-lg px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-semibold text-accent">Gnosis update available: v1.2.0 → v1.2.1</div>
              <div className="text-[11px] text-gray-300 mt-1.5 max-h-20 overflow-y-auto whitespace-pre-wrap border-l-2 border-white/10 pl-2">
                Test release for updater flow
              </div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button className="text-[11px] rounded px-2 py-1 text-gray-500 hover:text-gray-300 transition-colors">Skip</button>
              <button className="text-[11px] rounded px-2 py-1 bg-white/[0.06] border border-white/15 text-gray-200 hover:bg-white/[0.10]">Later</button>
              <button className="text-[11px] rounded px-3 py-1 bg-accent text-zinc-950 font-semibold hover:bg-accent/90">Update now</button>
            </div>
          </div>
        </div>

        <div className={labelCls}>Desktop downloading (~50%)</div>
        <div className="bg-row-odd border border-accent/50 rounded-lg px-4 py-3">
          <div className="flex items-center justify-between gap-3 mb-2">
            <div className="text-sm font-semibold text-accent">Downloading Gnosis update…</div>
            <div className="text-[11px] font-mono text-gray-400 shrink-0">15.2 MB / 30.4 MB · 50%</div>
          </div>
          <div className="w-full h-1.5 rounded-full bg-white/[0.08] overflow-hidden">
            <div className="h-full bg-accent transition-[width] duration-200" style={{ width: '50%' }} />
          </div>
        </div>

        <div className={labelCls}>Desktop installing</div>
        <div className="bg-row-odd border border-accent/50 rounded-lg px-4 py-3">
          <div className="text-sm font-semibold text-accent">Installing update…</div>
          <div className="text-[11px] text-gray-400 mt-0.5">App will relaunch shortly.</div>
        </div>

        <div className={labelCls}>Desktop check error</div>
        <div className="bg-row-odd border border-rose-500/50 rounded-lg px-4 py-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-rose-200">Gnosis update check failed</div>
            <div className="text-[11px] text-rose-300/80 font-mono mt-1 break-all">network error: failed to fetch manifest at https://gnosis-xi.com/updates/desktop.json</div>
          </div>
          <button className="text-rose-300 hover:text-rose-100 text-lg leading-none shrink-0">×</button>
        </div>

        <div className={labelCls}>Addon update available</div>
        <div className="bg-row-odd border border-accent/50 rounded-lg px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-semibold text-accent">Addon update available: v1.2.0 → v1.2.1</div>
              <div className="text-[10px] text-gray-400 mt-0.5">
                Files in <span className="font-mono text-gray-300">data/</span> and <span className="font-mono text-gray-300">*config*.json</span> are left alone. After install, type <span className="font-mono text-accent">//lua r gnosis</span> in FFXI.
              </div>
              <div className="text-[11px] text-gray-300 mt-1.5 max-h-20 overflow-y-auto whitespace-pre-wrap border-l-2 border-white/10 pl-2">
                Test release for updater flow
              </div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button className="text-[11px] rounded px-2 py-1 text-gray-500 hover:text-gray-300 transition-colors">Skip</button>
              <button className="text-[11px] rounded px-2 py-1 bg-white/[0.06] border border-white/15 text-gray-200 hover:bg-white/[0.10]">Later</button>
              <button className="text-[11px] rounded px-3 py-1 bg-accent text-zinc-950 font-semibold hover:bg-accent/90">Update now</button>
            </div>
          </div>
        </div>

        <div className={labelCls}>Addon installing</div>
        <div className="bg-row-odd border border-accent/50 rounded-lg px-4 py-3">
          <div className="text-sm font-semibold text-accent">Updating addon files…</div>
          <div className="text-[11px] text-gray-400 mt-0.5">Your data folder is untouched.</div>
        </div>

        <div className={labelCls}>Addon installed (success)</div>
        <div className="bg-row-odd border border-emerald-500/50 rounded-lg px-4 py-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-emerald-200">Addon updated to v1.2.1</div>
            <div className="text-[11px] text-emerald-100 mt-1 font-mono bg-black/30 rounded inline-block px-2 py-0.5">
              In FFXI: <span className="text-accent font-bold">//lua r gnosis</span>
            </div>
            <div className="text-[10px] text-emerald-400/70 mt-1.5">17 files written · 3 skipped (data + config preserved)</div>
          </div>
          <button className="text-emerald-300 hover:text-emerald-100 text-lg leading-none shrink-0">×</button>
        </div>

        <div className={labelCls}>Addon folder not found (warning)</div>
        <div className="bg-row-odd border border-amber-500/50 rounded-lg px-4 py-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-amber-200">Addon folder not found</div>
            <div className="text-[11px] text-amber-300/80 mt-0.5 leading-snug">
              Open Settings → Updates → set the addon folder path. Detected data folder: <span className="font-mono">C:\Users\you\AppData\Roaming\Gnosis\data</span>
            </div>
          </div>
          <button className="text-amber-300 hover:text-amber-100 text-lg leading-none shrink-0">×</button>
        </div>

        <div className={labelCls}>Addon update error</div>
        <div className="bg-row-odd border border-rose-500/50 rounded-lg px-4 py-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-rose-200">Addon update failed</div>
            <div className="text-[11px] text-rose-300/80 font-mono mt-1 break-all">sha256 mismatch: expected d2c4921e… got a91f3b2c…</div>
          </div>
          <button className="text-rose-300 hover:text-rose-100 text-lg leading-none shrink-0">×</button>
        </div>

        <div className="h-12" />
      </div>
    </div>
  );
}
