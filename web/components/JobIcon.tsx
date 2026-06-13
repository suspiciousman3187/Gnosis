import { imgSrc, type ImageImport } from '@/lib/img';
import blmIcon from '@/assets/jobs/blm.png';
import bluIcon from '@/assets/jobs/blu.png';
import brdIcon from '@/assets/jobs/brd.png';
import bstIcon from '@/assets/jobs/bst.png';
import corIcon from '@/assets/jobs/cor.png';
import dncIcon from '@/assets/jobs/dnc.png';
import drgIcon from '@/assets/jobs/drg.png';
import drkIcon from '@/assets/jobs/drk.png';
import geoIcon from '@/assets/jobs/geo.png';
import mnkIcon from '@/assets/jobs/mnk.png';
import ninIcon from '@/assets/jobs/nin.png';
import pldIcon from '@/assets/jobs/pld.png';
import pupIcon from '@/assets/jobs/pup.png';
import rdmIcon from '@/assets/jobs/rdm.png';
import rngIcon from '@/assets/jobs/rng.png';
import runIcon from '@/assets/jobs/run.png';
import samIcon from '@/assets/jobs/sam.png';
import schIcon from '@/assets/jobs/sch.png';
import smnIcon from '@/assets/jobs/smn.png';
import thfIcon from '@/assets/jobs/thf.png';
import warIcon from '@/assets/jobs/war.png';
import whmIcon from '@/assets/jobs/whm.png';
import trustIcon from '@/assets/jobs/trust.png';

export const JOB_ICONS: Record<string, ImageImport> = {
  blm: blmIcon, blu: bluIcon, brd: brdIcon, bst: bstIcon,
  cor: corIcon, dnc: dncIcon, drg: drgIcon, drk: drkIcon,
  geo: geoIcon, mnk: mnkIcon, nin: ninIcon, pld: pldIcon,
  pup: pupIcon, rdm: rdmIcon, rng: rngIcon, run: runIcon,
  sam: samIcon, sch: schIcon, smn: smnIcon, thf: thfIcon,
  war: warIcon, whm: whmIcon, trust: trustIcon,
};

export function mainJobKey(jobString: string | undefined | null): string | null {
  if (!jobString) return null;
  if (/^trust/i.test(jobString)) return 'trust';
  const code = jobString.match(/^([A-Za-z]{3})/)?.[1]?.toLowerCase();
  return code && code in JOB_ICONS ? code : null;
}

export default function JobIcon({ job, label, size = 20, className = '' }: { job?: string | null; label?: string; size?: number; className?: string }) {
  const key = mainJobKey(job ?? undefined);
  if (!key || !JOB_ICONS[key]) return null;
  const pad = key === 'trust' ? Math.round(size * 0.1) : undefined;
  return (
    <img
      src={imgSrc(JOB_ICONS[key])}
      alt={label ?? key.toUpperCase()}
      data-tooltip={label ?? undefined}
      width={size}
      height={size}
      style={pad ? { padding: pad } : undefined}
      className={`object-contain shrink-0 rounded-sm ${className}`}
    />
  );
}
