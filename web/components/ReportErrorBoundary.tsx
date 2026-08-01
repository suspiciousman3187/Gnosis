'use client';

import React from 'react';

type Props = { resetKey?: unknown; children: React.ReactNode };
type State = { error: Error | null };

export default class ReportErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ReportErrorBoundary] render failed:', error, info.componentStack);
  }

  componentDidUpdate(prev: Props) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  render() {
    const err = this.state.error;
    if (!err) return this.props.children;
    return (
      <div className="mx-auto max-w-lg mt-10 bg-surface border border-white/10 rounded-xl p-6 text-center">
        <div className="mx-auto mb-3 w-10 h-10 rounded-full bg-amber-500/15 border border-amber-500/40 flex items-center justify-center">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#f0c040" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 9v4M12 17h.01" />
            <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
          </svg>
        </div>
        <h2 className="text-sm font-bold text-gray-100 mb-1.5">This log couldn&apos;t be displayed</h2>
        <p className="text-xs text-gray-400 leading-relaxed">
          It looks like a partial or unusual capture (for example, tracking that started part-way through a run). Your raw log file is safe and unchanged, and the rest of your library is unaffected.
        </p>
        <details className="mt-4 text-left">
          <summary className="text-[11px] text-gray-500 cursor-pointer hover:text-gray-300">Technical details</summary>
          <pre className="mt-2 text-[10px] text-rose-300/90 bg-black/40 border border-white/10 rounded p-2 overflow-x-auto whitespace-pre-wrap break-words">{err.message || String(err)}</pre>
        </details>
      </div>
    );
  }
}
