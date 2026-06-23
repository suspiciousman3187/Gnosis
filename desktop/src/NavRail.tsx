import { openExternal } from './library';

export type Section = 'home' | 'history' | 'activities' | 'loot' | 'trends' | 'compare' | 'overlay' | 'settings' | 'diagnostics';

const DISCORD_URL = 'https://discord.com/invite/vSgYvdh8gT';
const GITHUB_URL = 'https://github.com/suspiciousman3187';
const KOFI_URL = 'https://ko-fi.com/lesserevil';

const ICONS: Record<Section, React.ReactNode> = {
  home: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 11l9-8 9 8" /><path d="M5 10v10h14V10" />
    </svg>
  ),
  history: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="5" cy="7" r="1.1" fill="currentColor" stroke="none" />
      <line x1="9" y1="7" x2="20" y2="7" />
      <circle cx="5" cy="12" r="1.1" fill="currentColor" stroke="none" />
      <line x1="9" y1="12" x2="20" y2="12" />
      <circle cx="5" cy="17" r="1.1" fill="currentColor" stroke="none" />
      <line x1="9" y1="17" x2="20" y2="17" />
    </svg>
  ),
  // Grid of squares - "activities" = collection / catalog. Matches the rail's
  // 1.8 line-art stroke + 22px frame.
  activities: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3"  width="7" height="7" rx="1" />
      <rect x="14" y="3"  width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  ),
  // Treasure chest: keeps the rail icon set consistent (line-art, 1.8 stroke).
  loot: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 9a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v3H4V9z" />
      <path d="M4 12h16v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-6z" />
      <path d="M10 12v3M14 12v3" />
      <circle cx="12" cy="13.5" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  ),
  trends: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 3v18h18" /><path d="M7 14l4-5 3 3 5-7" />
    </svg>
  ),
  compare: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="9" width="6" height="11" rx="1" /><rect x="14" y="4" width="6" height="16" rx="1" />
    </svg>
  ),
  overlay: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="14" rx="2" /><rect x="12.5" y="11" width="7" height="5.5" rx="1" fill="currentColor" stroke="none" />
    </svg>
  ),
  settings: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <line x1="4" y1="8" x2="20" y2="8" /><circle cx="9" cy="8" r="2.2" fill="currentColor" />
      <line x1="4" y1="16" x2="20" y2="16" /><circle cx="15" cy="16" r="2.2" fill="currentColor" />
    </svg>
  ),
  diagnostics: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12h3l2-6 4 12 2-9 3 7h4" />
    </svg>
  ),
};
const LABELS: Record<Section, string> = { home: 'Home', history: 'History', activities: 'Activities', loot: 'Loot', trends: 'Trends', compare: 'Compare', overlay: 'Overlay', settings: 'Settings', diagnostics: 'Diag' };
const ORDER: Section[] = ['home', 'history', 'loot', 'overlay', 'settings', 'diagnostics'];

export default function NavRail({ section, onSelect, isAdmin = false }: { section: Section; onSelect: (s: Section) => void; isAdmin?: boolean }) {
  const visibleOrder = isAdmin ? ORDER : ORDER.filter(s => s !== 'diagnostics');
  return (
    <nav className="bg-nav w-16 shrink-0 border-r border-white/10 flex flex-col items-stretch py-2">
      {visibleOrder.map(s => {
        const on = section === s;
        return (
          <button
            key={s}
            onClick={() => onSelect(s)}
            className={`group relative flex flex-col items-center gap-1 py-2.5 transition-colors ${
              on
                ? 'text-accent hover:bg-accent/[0.08]'
                : 'text-gray-500 hover:text-white hover:bg-white/[0.06]'
            }`}
          >
            {on
              ? <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-r bg-accent" />
              : <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-r bg-white/40 opacity-0 group-hover:opacity-100 transition-opacity" />}
            {ICONS[s]}
            <span className="text-[10px] font-medium">{LABELS[s]}</span>
          </button>
        );
      })}

      <div className="mt-auto flex flex-col items-stretch border-t border-white/[0.06] pt-1">
        <button
          onClick={() => openExternal(DISCORD_URL)}
          data-tooltip="Join the Discord community"
          className="flex flex-col items-center gap-1 py-2.5 text-gray-500 hover:text-indigo-300 hover:bg-indigo-500/[0.08] transition-colors"
        >
          <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden>
            <path d="M20.317 4.369a19.79 19.79 0 00-4.885-1.515.074.074 0 00-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 00-5.487 0 12.64 12.64 0 00-.617-1.25.077.077 0 00-.079-.037A19.736 19.736 0 003.677 4.37a.07.07 0 00-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 00.031.057 19.9 19.9 0 005.993 3.03.078.078 0 00.084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 00-.041-.106 13.107 13.107 0 01-1.872-.892.077.077 0 01-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 01.077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 01.078.009c.12.099.246.198.373.292a.077.077 0 01-.006.127 12.3 12.3 0 01-1.873.892.077.077 0 00-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 00.084.028 19.839 19.839 0 006.002-3.03.077.077 0 00.032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 00-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
          </svg>
          <span className="text-[10px] font-medium">Discord</span>
        </button>
        <button
          onClick={() => openExternal(GITHUB_URL)}
          data-tooltip="View the project on GitHub"
          className="flex flex-col items-center gap-1 py-2.5 text-gray-500 hover:text-white hover:bg-white/[0.06] transition-colors"
        >
          <svg viewBox="0 0 16 16" width="20" height="20" fill="currentColor" aria-hidden>
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
          </svg>
          <span className="text-[10px] font-medium">GitHub</span>
        </button>
        <button
          onClick={() => openExternal(KOFI_URL)}
          data-tooltip="Support the project on Ko-fi"
          className="flex flex-col items-center gap-1 py-2.5 text-gray-500 hover:text-rose-300 hover:bg-rose-500/[0.08] transition-colors"
        >
          <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden>
            <path d="M12 21s-7.5-4.9-10-9.2C.4 8.8 1.6 5.4 4.7 4.7 6.7 4.2 8.6 5 9.7 6.4L12 9l2.3-2.6c1.1-1.4 3-2.2 5-1.7 3.1.7 4.3 4.1 2.7 7.1C19.5 16.1 12 21 12 21z" />
          </svg>
          <span className="text-[10px] font-medium">Donate</span>
        </button>
      </div>
    </nav>
  );
}
