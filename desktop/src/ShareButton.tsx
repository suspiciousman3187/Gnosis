import { useContext, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { LoadedContent } from './content';
import { ItemIconContext } from '@/components/ItemIcon';
import { shareReport, getShareStatus, lookupShared, setSharePrivacy, removeShareUpload, OversizedPayloadError, type SharedPathEntry } from './share';
import { openExternal } from './library';
import LoadingScreen from './LoadingScreen';
import { alertDialog, confirmDialog } from '@/lib/dialogs';

const SHARE_TOKEN_KEY = 'gnosis_share_token';
const DEFAULT_PRIVACY_KEY = 'gnosis_share_default_privacy';
const MIN_WORKING_MS = 2500;
function loadShareToken(): string | null {
  try { return localStorage.getItem(SHARE_TOKEN_KEY) || null; } catch { return null; }
}
function loadDefaultPrivacy(): 'public' | 'private' {
  try { return localStorage.getItem(DEFAULT_PRIVACY_KEY) === 'public' ? 'public' : 'private'; } catch { return 'private'; }
}

type ShareModalProps = {
  open: boolean;
  state: 'confirm' | 'oversized' | 'working' | 'done' | 'error';
  url: string;
  err: string;
  already: boolean;
  anonymizeOnShare: boolean;
  copied: boolean;
  hasAccount: boolean;
  privacy: 'public' | 'private';
  onPrivacyChange: (p: 'public' | 'private') => void;
  onConfirm: () => void;
  onStripAndUpload: () => void;
  onCopy: () => void;
  onClose: () => void;
  onRetry: () => void;
};

export function ShareModal({ open, state, url, err, already, anonymizeOnShare, copied, hasAccount, privacy, onPrivacyChange, onConfirm, onStripAndUpload, onCopy, onClose, onRetry }: ShareModalProps) {
  if (!open) return null;

  const completeFooter = state === 'done' ? (
    <div className="mt-2 flex flex-col gap-3">
      <div className="text-sm text-gray-300 text-center px-2 leading-snug">
        {already && (
          <div className="text-sky-300/90 mb-1.5">This run was already uploaded - here&apos;s its existing link.</div>
        )}
        {anonymizeOnShare ? 'Character names are anonymized.' : 'Real character names are included.'}{' '}
        {privacy === 'private'
          ? 'Only you can view this report when signed in.'
          : 'Anyone with this link can view this report.'}
      </div>
      <div className="grid grid-cols-2 gap-2 px-2">
        <button
          onClick={() => openExternal(url).catch(() => { /* fall back silently */ })}
          className="inline-flex items-center justify-center gap-1.5 text-sm rounded-lg px-4 py-2.5 bg-accent/20 border border-accent/50 text-accent hover:bg-accent/30 transition-colors"
        >
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
            <path d="M15 3h6v6" />
            <path d="M10 14L21 3" />
          </svg>
          View
        </button>
        <button
          onClick={onCopy}
          className="inline-flex items-center justify-center gap-1.5 text-sm rounded-lg px-4 py-2.5 bg-white/[0.06] border border-white/15 text-gray-200 hover:bg-white/[0.10] transition-colors"
        >
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="9" y="9" width="13" height="13" rx="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
          {copied ? 'Copied!' : 'Copy URL'}
        </button>
      </div>
    </div>
  ) : null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
      <div className="absolute inset-0 bg-black/60" onClick={() => state !== 'working' && onClose()} />
      <div className="relative w-full max-w-md bg-surface border border-white/10 rounded-xl p-5 shadow-2xl shadow-black/50">
        <button
          onClick={onClose}
          disabled={state === 'working'}
          aria-label="Close"
          className="absolute top-2.5 right-2.5 z-10 w-7 h-7 inline-flex items-center justify-center rounded-md text-rose-400 hover:text-rose-300 hover:bg-rose-500/15 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="6" y1="6" x2="18" y2="18" />
            <line x1="18" y1="6" x2="6" y2="18" />
          </svg>
        </button>

        {state === 'confirm' && (
          <div className="py-2">
            <div className="text-base font-semibold text-gray-100 mb-3 text-center">Share Report</div>
            {hasAccount ? (
              <>
                <div className="text-xs text-gray-400 mb-2">Privacy</div>
                <div className="grid grid-cols-2 gap-2 mb-3">
                  <button
                    onClick={() => onPrivacyChange('public')}
                    className={`text-left rounded-lg px-3 py-2.5 border transition-colors ${
                      privacy === 'public'
                        ? 'bg-accent/20 border-accent/50 text-accent'
                        : 'border-white/10 text-gray-300 hover:bg-white/[0.05]'
                    }`}
                  >
                    <div className="text-sm font-semibold">Public</div>
                    <div className="text-[11px] text-gray-400">Anyone with the link can view.</div>
                  </button>
                  <button
                    onClick={() => onPrivacyChange('private')}
                    className={`text-left rounded-lg px-3 py-2.5 border transition-colors ${
                      privacy === 'private'
                        ? 'bg-accent/20 border-accent/50 text-accent'
                        : 'border-white/10 text-gray-300 hover:bg-white/[0.05]'
                    }`}
                  >
                    <div className="text-sm font-semibold">Private</div>
                    <div className="text-[11px] text-gray-400">Only you can view (signed in).</div>
                  </button>
                </div>
              </>
            ) : (
              <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 mb-3 text-[12px] text-amber-200 leading-snug">
                <div className="font-semibold mb-0.5">This report will be publicly viewable by others.</div>
                <div className="text-amber-200/80">Connect a gnosis-xi.com account in Settings &gt; Sharing to share privately.</div>
              </div>
            )}
            <div className="text-[11px] text-gray-500 mb-3 leading-snug">
              {anonymizeOnShare ? 'Character names will be anonymized.' : 'Real character names will be included.'}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={onClose}
                className="text-sm rounded-lg px-4 py-2 bg-white/[0.06] border border-white/15 text-gray-200 hover:bg-white/[0.10] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={onConfirm}
                className="text-sm rounded-lg px-4 py-2 bg-accent/20 border border-accent/50 text-accent hover:bg-accent/30 transition-colors"
              >
                Upload
              </button>
            </div>
          </div>
        )}

        {state === 'oversized' && (
          <div className="py-2">
            <div className="text-base font-semibold text-gray-100 mb-3 text-center">Encounter Is Too Large</div>
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 mb-3 text-[12px] text-amber-200 leading-snug">
              <div className="font-semibold mb-1">This encounter exceeds the upload size limit.</div>
              <div className="text-amber-200/85 mb-2">To proceed, the following per-second time-series logs will be stripped from the upload:</div>
              <ul className="list-disc list-inside text-amber-200/85 space-y-0.5">
                <li>Position log (movement)</li>
                <li>Party HP log</li>
                <li>Party MP log</li>
                <li>Party TP log</li>
                <li>Boss HP log</li>
              </ul>
              <div className="text-amber-200/70 mt-2 text-[11px]">Damage, kills, drops, buffs, and actions are kept - only the time-series charts will be missing on the shared report.</div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={onClose}
                className="text-sm rounded-lg px-4 py-2 bg-white/[0.06] border border-white/15 text-gray-200 hover:bg-white/[0.10] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={onStripAndUpload}
                className="text-sm rounded-lg px-4 py-2 bg-accent/20 border border-accent/50 text-accent hover:bg-accent/30 transition-colors"
              >
                Upload Anyway
              </button>
            </div>
          </div>
        )}

        {(state === 'working' || state === 'done') && (
          <LoadingScreen
            fill={false}
            caption="Uploading"
            completeCaption="Upload Complete!"
            complete={state === 'done'}
            hideQuote={state === 'done'}
            footer={completeFooter}
          />
        )}

        {state === 'error' && (
          <div className="py-3">
            <div className="text-red-400 text-sm break-words">{err}</div>
            <button onClick={onRetry} className="mt-3 text-xs rounded px-3 py-1.5 border border-white/15 text-gray-200 hover:bg-white/[0.06]">Try again</button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

function UploadedPrivacyPill({
  cached, onChangePrivacy, openExternalUrl,
}: {
  cached: SharedPathEntry;
  onChangePrivacy: (next: boolean) => void;
  openExternalUrl: (entry: SharedPathEntry) => void;
}) {
  const [busy, setBusy] = useState(false);
  const isPrivate = !!cached.isPrivate;

  const toggle = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (busy) return;
    const next = !isPrivate;
    setBusy(true);
    onChangePrivacy(next);
    try {
      await setSharePrivacy(cached.id, next, loadShareToken());
    } catch (err) {
      onChangePrivacy(!next);
      await alertDialog({
        title: 'Privacy update failed',
        message: err instanceof Error ? err.message : String(err),
        tone: 'danger',
      });
    } finally {
      setBusy(false);
    }
  };

  const lockTip = isPrivate
    ? 'Private - only you can view this report. Click to make public.'
    : 'Public - anyone with the link can view. Click to make private.';

  return (
    <div className={`inline-flex items-stretch text-xs rounded-lg border overflow-hidden transition-colors ${
      isPrivate
        ? 'bg-amber-500/15 border-amber-500/40 text-amber-300'
        : 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
    }`}>
      <button
        type="button"
        onClick={toggle}
        disabled={busy}
        data-tooltip={lockTip}
        aria-label={isPrivate ? 'Make report public' : 'Make report private'}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 hover:bg-white/[0.08] transition-colors disabled:opacity-50 disabled:cursor-wait"
      >
        {busy ? (
          <span className="inline-block w-3.5 h-3.5 rounded-full border-2 border-current border-t-transparent animate-spin" />
        ) : isPrivate ? (
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="4" y="11" width="16" height="10" rx="2" />
            <path d="M8 11V7a4 4 0 018 0v4" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="4" y="11" width="16" height="10" rx="2" />
            <path d="M8 11V7a4 4 0 017.5-1.8" />
          </svg>
        )}
        <span className="font-semibold">{isPrivate ? 'Private' : 'Public'}</span>
      </button>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); openExternalUrl(cached); }}
        data-tooltip={`Open shared report - ${cached.url}`}
        aria-label="Open shared report in browser"
        className="inline-flex items-center px-2 border-l border-current/30 hover:bg-white/[0.08] transition-colors"
      >
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M7 17L17 7M9 7h8v8" />
        </svg>
      </button>
    </div>
  );
}

export default function ShareButton({ content, anonymizeOnShare, sourcePath }: { content: LoadedContent; anonymizeOnShare: boolean; sourcePath?: string | null }) {
  const iconResolver = useContext(ItemIconContext);
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<'confirm' | 'oversized' | 'working' | 'done' | 'error'>('confirm');
  const [url, setUrl] = useState('');
  const [err, setErr] = useState('');
  const [copied, setCopied] = useState(false);
  const [already, setAlready] = useState(false);
  const [cached, setCached] = useState<SharedPathEntry | null>(() => lookupShared(sourcePath));
  useEffect(() => { setCached(lookupShared(sourcePath)); }, [sourcePath]);
  const [serverEnabled, setServerEnabled] = useState(true);
  useEffect(() => {
    let alive = true;
    getShareStatus().then(s => { if (alive) setServerEnabled(s.enabled); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  const [token, setToken] = useState<string | null>(() => loadShareToken());
  const [privacy, setPrivacy] = useState<'public' | 'private'>('public');
  const hasAccount = !!token;

  const openModal = () => {
    const t = loadShareToken();
    setToken(t);
    setPrivacy(t ? loadDefaultPrivacy() : 'public');
    setErr(''); setCopied(false); setUrl(''); setAlready(false);
    setState('confirm');
    setOpen(true);
  };

  const openCached = (entry: SharedPathEntry) => {
    openExternal(entry.url).catch(() => { /* fall back silently */ });
  };

  const upload = async (stripHeavyLogs = false) => {
    const t0 = Date.now();
    setState('working');
    const settle = async () => {
      const remaining = MIN_WORKING_MS - (Date.now() - t0);
      if (remaining > 0) await new Promise(res => setTimeout(res, remaining));
    };
    try {
      const r = await shareReport(content, anonymizeOnShare, iconResolver, token, sourcePath, {
        private: privacy === 'private',
        stripHeavyLogs,
      });
      await settle();
      setUrl(r.url); setAlready(r.alreadyUploaded); setState('done');
      setCached(lookupShared(sourcePath));
    } catch (e) {
      if (e instanceof OversizedPayloadError) {
        setState('oversized');
        return;
      }
      await settle();
      setErr(e instanceof Error ? e.message : String(e)); setState('error');
    }
  };

  const copy = async () => {
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* ignore */ }
  };

  if (!serverEnabled) return null;

  const unshare = async () => {
    if (!cached) return;
    const ok = await confirmDialog({
      title: 'Unshare encounter',
      message: 'Remove this uploaded report from the web? The /r/ link will stop working immediately.',
      destructive: true,
      confirmLabel: 'Unshare',
    });
    if (!ok) return;
    try {
      await removeShareUpload(cached.id, loadShareToken());
      setCached(null);
    } catch (e) {
      await alertDialog({
        title: 'Unshare failed',
        message: e instanceof Error ? e.message : String(e),
        tone: 'danger',
      });
    }
  };

  return (
    <>
      {cached && hasAccount ? (
        <div className="inline-flex items-center gap-1.5">
          <UploadedPrivacyPill cached={cached} onChangePrivacy={(p) => setCached({ ...cached, isPrivate: p })} openExternalUrl={openCached} />
          <button
            onClick={unshare}
            data-tooltip="Unshare - remove this upload from the web"
            aria-label="Unshare uploaded report"
            className="inline-flex items-center justify-center w-7 h-7 rounded-lg text-rose-400/70 hover:text-rose-300 hover:bg-rose-500/10 border border-rose-500/30 hover:border-rose-500/50 transition-colors"
          >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 6h18" />
              <path d="M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2" />
              <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
            </svg>
          </button>
        </div>
      ) : cached ? (
        <button
          onClick={() => openCached(cached)}
          data-tooltip={`Uploaded - ${cached.url}`}
          className="inline-flex items-center gap-1.5 text-xs rounded-lg px-3 py-1.5 bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/25 transition-colors"
        >
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 6L9 17l-5-5" />
          </svg>
          Uploaded ↗
        </button>
      ) : (
        <button
          onClick={openModal}
          className="inline-flex items-center gap-1.5 text-xs rounded-lg px-3 py-1.5 bg-accent/15 border border-accent/40 text-accent hover:bg-accent/25 transition-colors"
        >
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
            <path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" />
          </svg>
          Share
        </button>
      )}

      <ShareModal
        open={open}
        state={state}
        url={url}
        err={err}
        already={already}
        anonymizeOnShare={anonymizeOnShare}
        copied={copied}
        hasAccount={hasAccount}
        privacy={privacy}
        onPrivacyChange={setPrivacy}
        onConfirm={() => upload(false)}
        onStripAndUpload={() => upload(true)}
        onCopy={copy}
        onClose={() => setOpen(false)}
        onRetry={() => upload(false)}
      />
    </>
  );
}
