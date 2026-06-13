import type { JobExtendedEntry } from '@/lib/types';

export const JOB_NAMES: Record<number, string> = {
  1: 'WAR', 2: 'MNK', 3: 'WHM', 4: 'BLM', 5: 'RDM', 6: 'THF',
  7: 'PLD', 8: 'DRK', 9: 'BST', 10: 'BRD', 11: 'RNG', 12: 'SAM',
  13: 'NIN', 14: 'DRG', 15: 'SMN', 16: 'BLU', 17: 'COR', 18: 'PUP',
  19: 'DNC', 20: 'SCH', 21: 'GEO', 22: 'RUN',
};

export function jobName(id: number): string {
  return JOB_NAMES[id] ?? `Job#${id}`;
}

function hexByte(hex: string, byteIndex: number): number {
  const lo = byteIndex * 2;
  if (lo + 2 > hex.length) return 0;
  return parseInt(hex.slice(lo, lo + 2), 16) || 0;
}

function hexUint16LE(hex: string, byteIndex: number): number {
  return hexByte(hex, byteIndex) | (hexByte(hex, byteIndex + 1) << 8);
}

export interface DecodedJobExtended {
  jobId: number;
  jobName: string;
  isSubJob: boolean;
  cor?: { rolls: number[]; rollNames?: string[] };
  blu?: { spellIds: number[]; spellNames?: string[] };
  pup?: { frame: number; head: number; attachments: number[]; frameName?: string; headName?: string };
  sch?: { artsBits: number; arts?: string };
}

export function decodeJobExtended(e: JobExtendedEntry): DecodedJobExtended {
  const out: DecodedJobExtended = {
    jobId: e.jobId,
    jobName: jobName(e.jobId),
    isSubJob: e.isSubJob,
  };
  if (!e.rawHex || e.rawHex.length < 8) return out;
  const hex = e.rawHex;

  if (e.jobId === 17) {
    const rolls: number[] = [];
    for (let i = 0; i < 4; i++) {
      const id = hexByte(hex, i);
      if (id > 0) rolls.push(id);
    }
    out.cor = { rolls, rollNames: e.decoded?.rolls };
  }

  if (e.jobId === 16) {
    const spellIds: number[] = [];
    for (let i = 0; i < 20; i++) {
      const id = hexUint16LE(hex, i * 2);
      if (id > 0) spellIds.push(id);
    }
    out.blu = { spellIds, spellNames: e.decoded?.spellNames };
  }

  if (e.jobId === 18) {
    const frame = hexByte(hex, 0);
    const head  = hexByte(hex, 1);
    const attachments: number[] = [];
    for (let i = 0; i < 12; i++) {
      const id = hexByte(hex, 2 + i);
      if (id > 0) attachments.push(id);
    }
    out.pup = {
      frame,
      head,
      attachments,
      frameName: e.decoded?.frameName,
      headName:  e.decoded?.headName,
    };
  }

  if (e.jobId === 20) {
    out.sch = { artsBits: hexByte(hex, 0), arts: e.decoded?.arts };
  }

  return out;
}

export function summarizeJobExtended(entries: JobExtendedEntry[] | null | undefined): {
  total: number;
  subJobChanges: JobExtendedEntry[];
  byJob: Map<number, number>;
} {
  const byJob = new Map<number, number>();
  const subJobChanges: JobExtendedEntry[] = [];
  if (!Array.isArray(entries)) return { total: 0, subJobChanges, byJob };
  let prevSubJob = -1;
  for (const e of entries) {
    byJob.set(e.jobId, (byJob.get(e.jobId) ?? 0) + 1);
    if (e.isSubJob && e.jobId !== prevSubJob) {
      subJobChanges.push(e);
      prevSubJob = e.jobId;
    }
  }
  return { total: entries.length, subJobChanges, byJob };
}
