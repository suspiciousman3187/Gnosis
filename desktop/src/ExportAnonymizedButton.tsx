import { useState } from 'react';
import { save as saveDialog } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { anonymize } from './anonymize';
import { readText } from './library';

export default function ExportAnonymizedButton({ sourcePath }: { sourcePath?: string | null }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  if (!sourcePath) return null;

  const onClick = async () => {
    setBusy(true); setErr('');
    try {
      const raw = await readText(sourcePath);
      const parsed = JSON.parse(raw);
      const anon = anonymize(parsed);
      const baseName = sourcePath
        .replace(/^.*[\\/]/, '')
        .replace(/\.json(?:\.gz)?$/, '')
        .replace(/__[A-Za-z0-9]+$/, '__anon');
      const dest = await saveDialog({
        defaultPath: `${baseName}.json`,
        filters: [{ name: 'Anonymized report', extensions: ['json'] }],
      });
      if (!dest) { setBusy(false); return; }
      await invoke('write_text_file', { path: dest, contents: JSON.stringify(anon) });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      onClick={onClick}
      disabled={busy}
      data-tooltip={err || 'Save an anonymized copy of this report to disk'}
      className="inline-flex items-center gap-1.5 text-xs rounded-lg px-3 py-1.5 bg-white/[0.06] border border-white/15 text-gray-200 hover:bg-white/[0.10] transition-colors disabled:opacity-50"
    >
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <path d="M7 10l5 5 5-5" />
        <path d="M12 15V3" />
      </svg>
      {busy ? 'Exporting…' : err ? 'Failed - retry' : 'Export Anon'}
    </button>
  );
}
