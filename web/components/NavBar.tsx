'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

interface NavBarProps {
  isAdmin?: boolean;
  username?: string | null;
  avatarUrl?: string | null;
  loggedIn?: boolean;
}

const DISCORD_URL = 'https://discord.com/invite/vSgYvdh8gT';

type NavItem = { href: string; label: string; active: boolean; danger?: boolean; external?: boolean };
function buildItems(pathname: string, isAdmin: boolean): NavItem[] {
  const isActive = (prefix: string) => pathname === prefix || pathname.startsWith(prefix + '/');
  const items: NavItem[] = [
    { href: '/my/encounters',  label: 'ENCOUNTERS', active: isActive('/my/encounters') || isActive('/my/sortie') },
    { href: '/download',   label: 'DOWNLOAD',   active: isActive('/download') },
    { href: '/',           label: 'ABOUT',      active: false },
    { href: DISCORD_URL,   label: 'DISCORD',    active: false, external: true },
  ];
  if (isAdmin) {
    items.push({ href: '/admin', label: 'ADMIN', active: isActive('/admin'), danger: true });
  }
  return items;
}

function NavLinks({ items }: { items: NavItem[] }) {
  return (
    <div className="flex items-center gap-1">
      {items.map(it => {
        const cls = `px-3 py-1.5 rounded-md text-xs font-semibold tracking-wide transition-colors ${
          it.active
            ? (it.danger ? 'bg-rose-500/10 text-rose-300' : 'bg-white/[0.07] text-white')
            : (it.danger ? 'text-rose-400/70 hover:text-rose-300 hover:bg-rose-500/10' : 'text-gray-300 hover:text-white hover:bg-white/[0.05]')
        }`;
        if (it.external) {
          return (
            <a key={it.label} href={it.href} target="_blank" rel="noopener noreferrer" className={cls}>
              {it.label}
            </a>
          );
        }
        return (
          <Link key={it.label} href={it.href} className={cls}>
            {it.label}
          </Link>
        );
      })}
    </div>
  );
}

function RightCluster({
  loggedIn, username, avatarUrl, open, setOpen, dropdownRef, signOut,
}: {
  loggedIn: boolean;
  username?: string | null;
  avatarUrl?: string | null;
  open: boolean;
  setOpen: (v: boolean | ((v: boolean) => boolean)) => void;
  dropdownRef: React.RefObject<HTMLDivElement | null>;
  signOut: () => void;
}) {
  return (
    <div className="flex items-center gap-2">
      {!loggedIn && (
        <Link
          href="/login"
          className="ml-1 px-3.5 py-1.5 text-sm font-semibold bg-accent hover:bg-accent-hover text-gray-900 rounded-md transition-colors"
        >
          Sign in
        </Link>
      )}

      <div ref={dropdownRef} className={`relative ${!loggedIn ? 'hidden' : ''}`}>
        <button
          onClick={() => setOpen(v => !v)}
          className="flex items-center focus:outline-none rounded-full focus:ring-2 focus:ring-accent/50"
          aria-label="Account menu"
        >
          {avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatarUrl} alt="Profile" className="w-8 h-8 rounded-full object-cover border border-white/15 hover:border-accent/60 transition-colors" />
          ) : (
            <div className="w-8 h-8 rounded-full bg-white/[0.08] border border-white/15 hover:border-accent/60 flex items-center justify-center transition-colors">
              <span className="text-xs font-bold text-gray-200">
                {username ? username[0].toUpperCase() : '?'}
              </span>
            </div>
          )}
        </button>
        {open && (
          <div className="absolute right-0 mt-2 w-52 bg-surface-raised border border-white/[0.12] rounded-xl shadow-xl shadow-black/40 overflow-hidden z-50">
            {username && (
              <div className="px-4 py-3 border-b border-white/10">
                <p className="text-[10px] uppercase tracking-wide text-gray-400/80">Signed in as</p>
                <p className="text-sm font-semibold text-gray-100 truncate mt-0.5">{username}</p>
              </div>
            )}
            {username && (
              <Link
                href={`/user/${username}`}
                onClick={() => setOpen(false)}
                className="block px-4 py-2.5 text-sm text-gray-200/90 hover:bg-white/[0.05] hover:text-white transition-colors"
              >
                View profile
              </Link>
            )}
            <Link
              href="/settings"
              onClick={() => setOpen(false)}
              className="block px-4 py-2.5 text-sm text-gray-200/90 hover:bg-white/[0.05] hover:text-white transition-colors"
            >
              Settings
            </Link>
            <button
              onClick={signOut}
              className="w-full text-left px-4 py-2.5 text-sm text-rose-400/80 hover:bg-rose-900/20 hover:text-rose-300 transition-colors border-t border-white/10"
            >
              Sign out
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function NavBar({ isAdmin = false, username, avatarUrl, loggedIn = true }: NavBarProps) {
  const router = useRouter();
  const pathname = usePathname() ?? '';
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  }

  const items = buildItems(pathname, isAdmin);

  const [mobileOpen, setMobileOpen] = useState(false);
  useEffect(() => { setMobileOpen(false); }, [pathname]);

  const brand = (
    <Link href="/" className="text-accent hover:text-accent-hover transition-colors font-bold text-base tracking-[0.15em] inline-flex items-center gap-1.5">
      <span className="leading-none">GNOSIS</span>
      <span className="text-[8px] font-bold uppercase tracking-wider text-amber-200 bg-amber-500/20 border border-amber-500/40 rounded px-1 py-0.5 leading-none">Beta</span>
    </Link>
  );

  return (
    <div className="sticky top-3 z-30 px-3 sm:px-4">
      <nav className="mx-auto max-w-6xl flex items-center justify-between gap-3 sm:gap-4 px-3 sm:px-4 py-2 rounded-full bg-black/70 backdrop-blur-xl border border-white/15 shadow-lg shadow-black/30">
        <div className="flex items-center gap-2 min-w-0">
          <button
            onClick={() => setMobileOpen(o => !o)}
            className="md:hidden p-1.5 -ml-1 rounded-md text-gray-300 hover:text-white hover:bg-white/10 transition-colors shrink-0"
            aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={mobileOpen}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              {mobileOpen ? (
                <path d="M6 6l12 12M18 6l-12 12" />
              ) : (
                <>
                  <path d="M4 7h16" />
                  <path d="M4 12h16" />
                  <path d="M4 17h16" />
                </>
              )}
            </svg>
          </button>
          {brand}
        </div>
        <div className="hidden md:block">
          <NavLinks items={items} />
        </div>
        <RightCluster
          loggedIn={loggedIn} username={username} avatarUrl={avatarUrl}
          open={open} setOpen={setOpen} dropdownRef={dropdownRef} signOut={signOut}
        />
      </nav>
      {mobileOpen && (
        <div className="md:hidden mx-auto max-w-6xl mt-2 rounded-2xl bg-black/60 backdrop-blur-xl border border-white/15 shadow-lg shadow-black/30 p-1.5">
          {items.map(it => {
            const cls = `block px-4 py-2.5 rounded-lg text-sm font-semibold tracking-wide transition-colors ${
              it.active
                ? (it.danger ? 'bg-rose-500/15 text-rose-300' : 'bg-accent/15 text-accent')
                : (it.danger ? 'text-rose-400/80 hover:text-rose-300 hover:bg-rose-500/10' : 'text-gray-200 hover:text-white hover:bg-white/[0.06]')
            }`;
            if (it.external) {
              return (
                <a key={it.label} href={it.href} target="_blank" rel="noopener noreferrer" onClick={() => setMobileOpen(false)} className={cls}>
                  {it.label}
                </a>
              );
            }
            return (
              <Link key={it.label} href={it.href} onClick={() => setMobileOpen(false)} className={cls}>
                {it.label}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
