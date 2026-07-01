'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

export default function LoginPage() {
  return (
    <Suspense fallback={<LoginForm nextSafe="/my/encounters" />}>
      <LoginFormWithNext />
    </Suspense>
  );
}

function LoginFormWithNext() {
  const params = useSearchParams();
  const nextRaw = params?.get('next') ?? '';
  const nextSafe = nextRaw.startsWith('/') && !nextRaw.startsWith('//') ? nextRaw : '/my/encounters';
  return <LoginForm nextSafe={nextSafe} />;
}

function LoginForm({ nextSafe }: { nextSafe: string }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setError(error.message);
      setLoading(false);
    } else {
      // Full-page nav (not router.push) so Chrome's password-manager prompt
      // gets to fully render before unmount. router.push tore the form out
      // mid-prompt and left Chrome's backdrop stuck on screen.
      window.location.href = nextSafe;
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-bold text-accent mb-1 text-center inline-flex w-full items-center justify-center gap-2">
          <span className="leading-none">GNOSIS</span>
          <span className="text-[9px] font-bold uppercase tracking-wider text-amber-200 bg-amber-500/20 border border-amber-500/40 rounded px-1.5 py-0.5 leading-none">Beta</span>
        </h1>
        <p className="text-gray-400 text-sm text-center mb-8">Sign in to your account</p>

        <form onSubmit={handleSubmit} className="bg-surface rounded-xl p-6 space-y-4 border border-white/10">
          {error && (
            <p className="text-red-400 text-sm bg-red-950/50 border border-red-800 rounded-lg px-3 py-2">
              {error}
            </p>
          )}
          <div>
            <label className="block text-sm text-gray-200 mb-1" htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-surface-raised border border-white/[0.08] rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-accent/40"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-200 mb-1" htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-surface-raised border border-white/[0.08] rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-accent/40"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="le-tap w-full bg-accent hover:bg-accent-hover disabled:bg-gray-700 text-gray-900 font-semibold rounded-lg py-2 text-sm transition-colors"
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className="text-center text-sm text-gray-400 mt-4">
          No account?{' '}
          <Link href="/register" className="text-accent hover:text-gray-200">
            Register
          </Link>
        </p>
      </div>
    </div>
  );
}
