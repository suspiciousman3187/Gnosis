'use client';

import { useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';

export default function RegisterPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (password !== confirm) {
      setError('Passwords do not match');
      return;
    }
    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signUp({ email, password });
    if (error) {
      setError(error.message);
      setLoading(false);
    } else {
      // Full-page nav so Chrome's password-manager prompt fully renders
      // before unmount. See login/page.tsx for the same fix.
      window.location.href = '/my/encounters';
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-bold text-accent mb-1 text-center inline-flex w-full items-center justify-center gap-2">
          <span className="leading-none">GNOSIS</span>
          <span className="text-[9px] font-bold uppercase tracking-wider text-amber-200 bg-amber-500/20 border border-amber-500/40 rounded px-1.5 py-0.5 leading-none">Beta</span>
        </h1>
        <p className="text-gray-400 text-sm text-center mb-8">Create your account</p>

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
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-surface-raised border border-white/[0.08] rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-accent/40"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-200 mb-1" htmlFor="confirm">Confirm Password</label>
            <input
              id="confirm"
              type="password"
              required
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="w-full bg-surface-raised border border-white/[0.08] rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-accent/40"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-accent hover:bg-accent-hover disabled:bg-gray-700 text-gray-900 font-semibold rounded-lg py-2 text-sm transition-colors"
          >
            {loading ? 'Creating account…' : 'Create account'}
          </button>
        </form>

        <p className="text-center text-sm text-gray-400 mt-4">
          Already have an account?{' '}
          <Link href="/login" className="text-accent hover:text-gray-200">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
