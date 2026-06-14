import { createClient } from '@/lib/supabase/server';
import { createClient as adminClient } from '@supabase/supabase-js';
import NavBar from '@/components/NavBar';

export const revalidate = 300;

const REPO = 'suspiciousman3187/Gnosis';
const RELEASES_PAGE = `https://github.com/${REPO}/releases/latest`;
const DISCORD_URL = 'https://discord.com/invite/vSgYvdh8gT';

type GhAsset = { name: string; browser_download_url: string; size: number; download_count: number };
type GhRelease = { tag_name: string; published_at: string; assets: GhAsset[]; html_url: string };

function DownloadArrow({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M12 4v12" />
      <path d="M6 14l6 6 6-6" />
      <path d="M4 22h16" />
    </svg>
  );
}

function GitHubIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor" className={className} aria-hidden="true">
      <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.55v-2.02c-3.2.7-3.87-1.36-3.87-1.36-.52-1.32-1.27-1.67-1.27-1.67-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.02 1.76 2.69 1.25 3.34.95.1-.75.4-1.25.73-1.54-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.18-3.1-.12-.29-.51-1.45.11-3.02 0 0 .96-.31 3.15 1.18a10.96 10.96 0 0 1 5.74 0c2.18-1.49 3.14-1.18 3.14-1.18.63 1.57.23 2.73.12 3.02.73.81 1.18 1.84 1.18 3.1 0 4.42-2.7 5.39-5.27 5.68.41.36.78 1.06.78 2.13v3.16c0 .31.21.67.8.55C20.22 21.39 23.5 17.08 23.5 12 23.5 5.65 18.35.5 12 .5z" />
    </svg>
  );
}

async function fetchReleases(): Promise<GhRelease[] | null> {
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=30`, {
      headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
      next: { revalidate: 300 },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export default async function DownloadPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  let username: string | null = null, avatarUrl: string | null = null, isAdmin = false;
  if (user) {
    const { data: profile } = await adminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    ).from('profiles').select('username, avatar_url, is_admin').eq('id', user.id).maybeSingle();
    username = (profile as { username?: string | null } | null)?.username ?? null;
    avatarUrl = (profile as { avatar_url?: string | null } | null)?.avatar_url ?? null;
    isAdmin = (profile as { is_admin?: boolean } | null)?.is_admin ?? false;
  }

  const releases = await fetchReleases();
  const latest = releases?.[0] ?? null;
  const releaseHref = latest?.html_url ?? RELEASES_PAGE;
  const totalDownloads = releases
    ? releases.reduce((sum, r) => sum + r.assets.reduce((s, a) => s + (a.download_count ?? 0), 0), 0)
    : null;

  return (
    <div className="min-h-screen text-white flex flex-col">
      <NavBar isAdmin={isAdmin} username={username} avatarUrl={avatarUrl} loggedIn={!!user} />
      <div className="flex-1 px-4 py-8">
        <div className="max-w-5xl mx-auto space-y-6">
          <section className="bg-row-even border border-white/10 rounded-xl p-5 space-y-5">
            <div className="flex items-baseline justify-between gap-2 flex-wrap">
              <h2 className="font-bold text-xl text-accent uppercase tracking-wide">Download the latest release</h2>
              {latest?.tag_name && <span className="text-xs font-mono text-gray-300">{latest.tag_name}</span>}
            </div>

            <div className="flex flex-wrap justify-center gap-3 py-2">
              <a
                href={releaseHref}
                target="_blank"
                rel="noopener noreferrer"
                className="group inline-flex items-center gap-6 rounded-lg bg-emerald-600 hover:bg-emerald-500 border border-emerald-400/30 text-white px-12 py-4 transition-colors"
              >
                <DownloadArrow className="shrink-0 group-hover:translate-y-0.5 transition-transform" />
                <div className="text-left">
                  <div className="text-base font-bold uppercase tracking-wide leading-tight">Download Gnosis</div>
                  <div className="text-[12px] font-medium opacity-80 leading-tight mt-0.5">Download from GitHub Releases</div>
                </div>
                <span className="shrink-0 text-[10px] font-mono font-bold uppercase tracking-wide px-2 py-1 rounded bg-black/25 border border-white/15">{latest?.tag_name ?? 'v0.0.0'} BETA</span>
              </a>
              <a
                href={`https://github.com/${REPO}`}
                target="_blank"
                rel="noopener noreferrer"
                className="group inline-flex items-center gap-6 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/50 hover:border-emerald-400 text-emerald-200 px-12 py-4 transition-colors"
              >
                <GitHubIcon className="shrink-0" />
                <div className="text-left">
                  <div className="text-base font-bold uppercase tracking-wide leading-tight">View source code</div>
                  <div className="text-[12px] font-medium opacity-80 leading-tight mt-0.5">Visit the repository on GitHub!</div>
                </div>
              </a>
            </div>

            <div className="flex items-center justify-between gap-3 text-xs text-gray-400 pt-2 border-t border-white/[0.06]">
              <a href={`https://github.com/${REPO}/releases`} target="_blank" rel="noopener noreferrer" className="hover:text-accent transition-colors">All releases on GitHub &rarr;</a>
              {totalDownloads != null && (
                <span>
                  Total downloads: <span className="font-mono text-gray-200">{totalDownloads.toLocaleString()}</span>
                </span>
              )}
            </div>
          </section>

          <section className="bg-row-even border border-white/10 rounded-xl p-5 space-y-4">
            <h2 className="font-bold text-xl text-accent uppercase tracking-wide">Getting Started</h2>
            <ol className="space-y-8 text-sm text-gray-100">
              <li className="flex gap-4">
                <span className="shrink-0 w-6 h-6 rounded-full bg-accent/20 border border-accent/50 text-accent font-bold text-xs flex items-center justify-center">1</span>
                <div className="space-y-2">
                  <div className="font-semibold text-accent text-base">Download &amp; install the Windower addon</div>
                  <div className="text-gray-300 text-[13px]">
                    Extract the addon zip into your Windower folder. It should be under <code className="px-1 py-0.5 bg-black/40 rounded text-[12px] font-mono">Windower/addons/Gnosis/</code>. Load the addon ingame with <code className="px-1 py-0.5 bg-black/40 rounded text-[12px] font-mono">//lua l Gnosis</code>.
                  </div>
                </div>
              </li>
              <li className="flex gap-4">
                <span className="shrink-0 w-6 h-6 rounded-full bg-accent/20 border border-accent/50 text-accent font-bold text-xs flex items-center justify-center">2</span>
                <div className="space-y-2">
                  <div className="font-semibold text-accent text-base">Download &amp; install the Viewer</div>
                  <div className="text-gray-300 text-[13px]">
                    Download the Viewer and run the <code className="px-1 py-0.5 bg-black/40 rounded text-[12px] font-mono">installer.exe</code> to set up and install it for viewing logs.
                  </div>
                </div>
              </li>
              <li className="flex gap-4">
                <span className="shrink-0 w-6 h-6 rounded-full bg-accent/20 border border-accent/50 text-accent font-bold text-xs flex items-center justify-center">3</span>
                <div className="space-y-2">
                  <div className="font-semibold text-accent text-base">Configure your Gnosis data folder location in the Viewer</div>
                  <div className="text-gray-300 text-[13px]">
                    Open the Viewer and go to <span className="text-gray-100 font-medium">Settings</span>, then set the <span className="text-gray-100 font-medium">Data folder</span> to where you extracted the Gnosis addon, usually <code className="px-1 py-0.5 bg-black/40 rounded text-[12px] font-mono">Windower/addons/Gnosis/data/</code>.
                  </div>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src="/getting-started-data-folder.png"
                    alt="Gnosis Settings showing the Addon Data Folder field highlighted"
                    className="mt-2 rounded-lg border border-white/10 w-full max-w-4xl"
                  />
                </div>
              </li>
              <li className="flex gap-4">
                <span className="shrink-0 w-6 h-6 rounded-full bg-accent/20 border border-accent/50 text-accent font-bold text-xs flex items-center justify-center">4</span>
                <div className="space-y-2">
                  <div className="font-semibold text-accent text-base">You&apos;re ready to go!</div>
                  <div className="text-gray-300 text-[13px]">
                    The Gnosis Viewer should now be connected ingame and you should be ready to start logging! The default tracking mode is <span className="text-gray-100 font-medium">Encounter</span>, but you can set different types of tracking behavior at the bottom bar. Enjoy!
                  </div>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src="/getting-started-tracking-modes.png"
                    alt="Gnosis bottom bar showing the tracking mode selector"
                    className="mt-2 rounded-lg border border-white/10 w-full max-w-4xl"
                  />
                </div>
              </li>
            </ol>
          </section>

          <section className="bg-row-even border border-white/10 rounded-xl p-5 space-y-3">
            <h2 className="font-bold text-xl text-accent uppercase tracking-wide">Reporting Bugs &amp; Feature Requests</h2>
            <p className="text-sm text-gray-100 leading-relaxed">
              Gnosis is currently in <span className="font-bold uppercase tracking-wide text-amber-200">Beta</span> testing, which means there will likely be lots of bugs and stability issues.
            </p>
            <p className="text-sm text-gray-100 leading-relaxed">
              If you run into any issues or bugs, or if you have suggestions for new features in Gnosis, please visit our Discord at{' '}
              <a href={DISCORD_URL} target="_blank" rel="noopener noreferrer" className="text-accent hover:text-accent-hover underline underline-offset-2">
                {DISCORD_URL.replace(/^https?:\/\//, '')}
              </a>
              . Thank you, and happy testing!
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
