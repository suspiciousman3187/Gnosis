import type {
  ParsedRun,
  PartyMember,
  DamageEntry,
  WsEntry,
  PctEntry,
  AvgEntry,
  CorRolls,
  AminonData,
  BossReport,
  BonusObjectives,
  TreasureChests,
  SectorObjectives,
  AreaTimes,
  ZoneLogEntry,
  DeathEntry,
  ChestLogEntry,
  NaakualKills,
  MiniNmKill,
  DropLogEntry,
  SortieDrops,
  KillLogEntry,
} from './types';
import { extractGearCapture } from './types';
import { extractCommonLogs, extractBossReports, extractCombatStats } from './parseShared';
import { resolveChestId } from './chestIds';

// ─── Helpers ────────────────────────────────────────────────────────────────

function parseCommaNumber(s: string): number {
  return parseInt(s.replace(/,/g, ''), 10) || 0;
}

function deriveTreasureChestsFromChestLog(chestLog: ChestLogEntry[] | null | undefined): TreasureChests | null {
  if (!chestLog || chestLog.length === 0) return null;
  const out: TreasureChests = { chests: [], caskets: [], coffers: [] };
  const seen = new Set<string>(); // dedup `${type}|${name}` so multi-opens collapse
  for (const c of chestLog) {
    let type: 'Chest' | 'Casket' | 'Coffer' | null = null;
    let name: string | null = null;
    if (typeof c.npcId === 'number') {
      const r = resolveChestId(c.npcId);
      if (r) { type = r.type; name = r.name; }
    }
    // Pre-migration shape used inline type+name; respect those too.
    if (!type && c.type && c.type !== 'Unknown' && c.name) { type = c.type; name = c.name; }
    if (!type || !name) continue;
    const key = `${type}|${name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (type === 'Chest') out.chests.push(name);
    else if (type === 'Casket') out.caskets.push(name);
    else if (type === 'Coffer') out.coffers.push(name);
  }
  return out;
}

function pickTreasureChests(data: any): TreasureChests {
  const inline: TreasureChests | undefined = data.treasureChests ?? data.treasureContainers;
  const inlineHasData = inline
    && ((inline.chests?.length ?? 0) > 0
      || (inline.caskets?.length ?? 0) > 0
      || (inline.coffers?.length ?? 0) > 0);
  if (inlineHasData) return inline as TreasureChests;
  const derived = deriveTreasureChestsFromChestLog(data.chestLog);
  if (derived) return derived;
  return { chests: [], caskets: [], coffers: [] };
}

function stripFfxiChatCodes(s: string): string {
  return s
    .replace(/[\x1E\x1F]./g, '')
    .replace(/\xEF/g, '')
    .trim();
}

function parseDuration(s: string): number {
  // e.g. "4 min 16 sec" → seconds
  const minMatch = s.match(/(\d+)\s*min/);
  const secMatch = s.match(/(\d+)\s*sec/);
  const mins = minMatch ? parseInt(minMatch[1], 10) : 0;
  const secs = secMatch ? parseInt(secMatch[1], 10) : 0;
  return mins * 60 + secs;
}

/** Split report into named sections delimited by ---- lines */
function splitSections(text: string): Record<string, string[]> {
  const lines = text.split(/\r?\n/);
  const sections: Record<string, string[]> = {};
  let currentSection = '__header__';
  sections[currentSection] = [];

  for (const line of lines) {
    if (/^-{5,}$/.test(line.trim())) continue;
    const sectionMatch = line.match(/^\[(.+)\]$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1].trim();
      sections[currentSection] = [];
    } else {
      sections[currentSection].push(line);
    }
  }
  return sections;
}

// ─── Section parsers ─────────────────────────────────────────────────────────

function parseHeader(lines: string[]): { runDate: Date; gallimaufry: number; oldCasePlus1: number } {
  let runDate = new Date();
  let gallimaufry = 0;
  let oldCasePlus1 = 0;

  for (const line of lines) {
    const dateMatch = line.match(/\[Sortie Report - (.+)\]/);
    if (dateMatch) {
      runDate = new Date(dateMatch[1]);
    }
    const galliMatch = line.match(/Total Gallimaufry:\s*([\d,]+)/);
    if (galliMatch) gallimaufry = parseCommaNumber(galliMatch[1]);

    const caseMatch = line.match(/Total Old Case \+1:\s*(\d+)/);
    if (caseMatch) oldCasePlus1 = parseInt(caseMatch[1], 10);
  }
  return { runDate, gallimaufry, oldCasePlus1 };
}

function parseParty(lines: string[]): PartyMember[] {
  // Each line: "Name (MAINJOB99/SUBJOB59)"
  return lines
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(.+?)\s+\(([A-Z]+)(\d+)\/([A-Z]+)(\d+)\)$/);
      if (!match) return null;
      return {
        name: match[1].trim(),
        mainJob: match[2],
        mainLevel: parseInt(match[3], 10),
        subJob: match[4],
        subLevel: parseInt(match[5], 10),
      } as PartyMember;
    })
    .filter((m): m is PartyMember => m !== null);
}

function parseBosses(lines: string[]): string[] {
  return lines.map((l) => l.trim()).filter(Boolean);
}

function parseBonusObjectives(lines: string[]): BonusObjectives {
  const text = lines.join('\n');
  const aurumChest = /Ground floor Aurum Chest/i.test(text);
  const naakualMatch = text.match(/Naakual sets defeated:\s*(\d+)/);
  const naakualSets = naakualMatch ? parseInt(naakualMatch[1], 10) : 0;
  const flans = /Flans/i.test(text);

  const basementNms = ['Botulus', 'Ixion', 'Naraka', 'Tulittia'];
  const basementMiniNms = basementNms.filter((nm) =>
    new RegExp(`\\b${nm}\\b`, 'i').test(text)
  );

  return { aurumChest, naakualSets, basementMiniNms, flans };
}

function parseCorRolls(lines: string[]): CorRolls | null {
  let misers = 0, misersLucky = false;
  let tactician = 0, tacticianLucky = false;
  let wildCard = 0;

  for (const line of lines) {
    const misersMatch = line.match(/Miser'?s[^:]*:\s*(\d+)(.*)$/i);
    if (misersMatch) {
      misers = parseInt(misersMatch[1], 10);
      misersLucky = /Lucky/i.test(misersMatch[2]);
    }
    const tactMatch = line.match(/Tactician'?s[^:]*:\s*(\d+)(.*)$/i);
    if (tactMatch) {
      tactician = parseInt(tactMatch[1], 10);
      tacticianLucky = /Lucky/i.test(tactMatch[2]);
    }
    const wcMatch = line.match(/Wild Card:\s*(\d+)/i);
    if (wcMatch) wildCard = parseInt(wcMatch[1], 10);
  }

  if (misers === 0 && tactician === 0 && wildCard === 0) return null;
  return { misers, misersLucky, tactician, tacticianLucky, wildCard };
}

function parseDamageReport(lines: string[]): DamageEntry[] {
  const entries: DamageEntry[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || /^Name\s+Damage/i.test(trimmed)) continue;

    // Skillchain lines: "Skillchain (P4)   21,561   0.4%"
    const scMatch = trimmed.match(/^Skillchain\s+\((.+?)\)\s+([\d,]+)\s+([\d.]+)%/i);
    if (scMatch) {
      entries.push({
        name: `Skillchain (${scMatch[1]})`,
        damage: parseCommaNumber(scMatch[2]),
        percent: parseFloat(scMatch[3]),
        isSkillchain: true,
        skillchainOwner: scMatch[1],
      });
      continue;
    }

    // Player lines: "PLAYER4   2,073,289   38.6%"
    const playerMatch = trimmed.match(/^(.+?)\s{2,}([\d,]+)\s+([\d.]+)%/);
    if (playerMatch) {
      entries.push({
        name: playerMatch[1].trim(),
        damage: parseCommaNumber(playerMatch[2]),
        percent: parseFloat(playerMatch[3]),
        isSkillchain: false,
      });
    }
  }
  return entries;
}

function parseWsAverages(lines: string[]): WsEntry[] {
  const entries: WsEntry[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || /^Name\s+WS/i.test(trimmed)) continue;
    const match = trimmed.match(/^(.+?)\s{2,}([\d,]+)\s+(\d+)/);
    if (match) {
      entries.push({
        name: match[1].trim(),
        wsAvg: parseCommaNumber(match[2]),
        count: parseInt(match[3], 10),
      });
    }
  }
  return entries;
}

function parsePctStat(lines: string[]): PctEntry[] {
  const entries: PctEntry[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || /^Name\s+/i.test(trimmed)) continue;
    // "PlayerName     95.50%     456"
    const match = trimmed.match(/^(.+?)\s{2,}([\d.]+)%\s+(\d+)/);
    if (match) {
      entries.push({ name: match[1].trim(), pct: parseFloat(match[2]), count: parseInt(match[3], 10) });
    }
  }
  return entries;
}

function parseAvgStat(lines: string[]): AvgEntry[] {
  const entries: AvgEntry[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || /^Name\s+/i.test(trimmed)) continue;
    // "PlayerName     1,234      456"
    const match = trimmed.match(/^(.+?)\s{2,}([\d,]+)\s+(\d+)/);
    if (match) {
      entries.push({ name: match[1].trim(), avg: parseCommaNumber(match[2]), count: parseInt(match[3], 10) });
    }
  }
  return entries;
}

function parseTreasureChests(lines: string[]): TreasureChests {
  const containers: TreasureChests = { chests: [], caskets: [], coffers: [] };
  for (const line of lines) {
    const trimmed = line.trim();
    const chestsMatch = trimmed.match(/^Chests?:\s*(.+)/i);
    if (chestsMatch) containers.chests = chestsMatch[1].split(',').map((s) => s.trim()).filter(Boolean);
    const casketsMatch = trimmed.match(/^Caskets?:\s*(.+)/i);
    if (casketsMatch) containers.caskets = casketsMatch[1].split(',').map((s) => s.trim()).filter(Boolean);
    const cofferMatch = trimmed.match(/^Coffers?:\s*(.+)/i);
    if (cofferMatch) containers.coffers = cofferMatch[1].split(',').map((s) => s.trim()).filter(Boolean);
  }
  return containers;
}

function parseSectorObjectives(lines: string[]): SectorObjectives {
  const obj: SectorObjectives = { A: 0, B: 0, C: 0, D: 0, E: 0, F: 0, G: 0, H: 0 };
  for (const line of lines) {
    const m = line.trim().match(/^([A-H]):\s*(\d+)\/7/);
    if (m) obj[m[1] as keyof SectorObjectives] = parseInt(m[2], 10);
  }
  return obj;
}

const TRACKED_BOSSES = ['Ghatjot', 'Leshonn', 'Skomora', 'Degei', 'Dhartok', 'Gartell', 'Triboulex', 'Aita'] as const;

function parseBossReports(sections: Record<string, string[]>): Record<string, BossReport> | null {
  const reports: Record<string, BossReport> = {};

  for (const boss of TRACKED_BOSSES) {
    const damageLines = sections[`${boss} Damage Report`] ?? [];
    const wsLines = sections[`${boss} Weaponskill Averages`] ?? [];
    const durationLines = sections[`${boss} Fight Duration`] ?? [];
    const wsAccLines = sections[`${boss} WS Accuracy`] ?? [];
    const accLines = sections[`${boss} Accuracy`] ?? [];
    const critLines = sections[`${boss} Crit Rate`] ?? [];
    const mavgLines = sections[`${boss} Melee Average`] ?? [];
    const critAvgLines = sections[`${boss} Melee Crit Average`] ?? [];

    if (damageLines.length === 0 && wsLines.length === 0) continue;

    const durationText = durationLines.join(' ');
    reports[boss] = {
      damageReport: parseDamageReport(damageLines),
      wsAverages: parseWsAverages(wsLines),
      fightDurationSeconds: parseDuration(durationText),
      wsAccuracy: wsAccLines.length > 0 ? parsePctStat(wsAccLines) : undefined,
      accuracy: accLines.length > 0 ? parsePctStat(accLines) : undefined,
      critRate: critLines.length > 0 ? parsePctStat(critLines) : undefined,
      meleeAverage: mavgLines.length > 0 ? parseAvgStat(mavgLines) : undefined,
      meleeCritAverage: critAvgLines.length > 0 ? parseAvgStat(critAvgLines) : undefined,
    };
  }

  return Object.keys(reports).length > 0 ? reports : null;
}

// ─── JSON format parser (v1+) ─────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseJsonReport(data: any): ParsedRun {
  return {
    runDate: new Date(data.runDate),
    addonVersion: typeof data.addonVersion === 'string' ? data.addonVersion : undefined,
    gallimaufry: data.gallimaufry ?? 0,
    oldCasePlus1: data.oldCasePlus1 ?? 0,
    defeatedBosses: data.defeatedBosses ?? [],
    party: data.party ?? [],
    bonusObjectives: data.bonusObjectives ?? {
      aurumChest: false,
      naakualSets: 0,
      basementMiniNms: [],
      flans: false,
    },
    treasureChests: pickTreasureChests(data),
    sectorObjectives: data.sectorObjectives ?? { A: 0, B: 0, C: 0, D: 0, E: 0, F: 0, G: 0, H: 0 },
    aminon: data.aminon ?? null,
    bossReports: extractBossReports(data, { dropEmpty: true }),
    areaTimes: data.areaTimes ?? null,
    zoneLog: Array.isArray(data.zoneLog) ? (data.zoneLog as ZoneLogEntry[]) : null,
    deathLog: Array.isArray(data.deathLog) ? (data.deathLog as DeathEntry[]) : null,
    chestLog: Array.isArray(data.chestLog) ? (data.chestLog as ChestLogEntry[]) : null,
    naakualKills: (data.naakualKills && typeof data.naakualKills === 'object' && Object.keys(data.naakualKills).length > 0)
      ? data.naakualKills as NaakualKills : null,
    miniNmLog: Array.isArray(data.miniNmLog) ? (data.miniNmLog as MiniNmKill[]) : null,
    dropLog: Array.isArray(data.dropLog)
      ? (data.dropLog as DropLogEntry[]).map((d) => ({
          ...d,
          name: typeof d.name === 'string' ? stripFfxiChatCodes(d.name) : d.name,
        }))
      : null,
    drops: data.drops ? {
      sapphire:     data.drops.sapphire     ?? 0,
      starstone:    data.drops.starstone    ?? 0,
      eikondrite:   data.drops.eikondrite   ?? 0,
      octahedrite:  data.drops.octahedrite  ?? 0,
      hexahedrite:  data.drops.hexahedrite  ?? 0,
      mesosiderite: data.drops.mesosiderite ?? 0,
      oldCase:      data.drops.oldCase      ?? 0,
      oldCasePlus1: data.drops.oldCasePlus1 ?? data.oldCasePlus1 ?? 0,
    } as SortieDrops : null,
    notes: data.notes ?? '',
    sortieStartTime: typeof data.sortieStartTime === 'number' ? data.sortieStartTime : null,
    combatStats: extractCombatStats(data),
    ...extractCommonLogs(data),
    killLog:     Array.isArray(data.killLog)     ? (data.killLog     as KillLogEntry[])     : null,
    ...extractGearCapture(data),
  };
}

// ─── Main export ─────────────────────────────────────────────────────────────

export function parseReport(text: string): ParsedRun {
  if (text.trimStart().startsWith('{')) {
    return parseJsonReport(JSON.parse(text));
  }
  return parseLegacyTextReport(text);
}

function parseLegacyTextReport(text: string): ParsedRun {
  const sections = splitSections(text);

  const reportKey = Object.keys(sections).find((k) => /^Sortie Report/i.test(k));
  const headerLines = reportKey
    ? [`[${reportKey}]`, ...sections[reportKey]]
    : (sections['__header__'] ?? []);

  const header = parseHeader(headerLines);

  const party = parseParty(sections['Party Composition'] ?? []);
  const defeatedBosses = parseBosses(sections['Defeated Bosses'] ?? []);
  const bonusObjectives = parseBonusObjectives(sections['Completed Bonus Objectives'] ?? []);
  const treasureChests = parseTreasureChests(sections['Treasure Containers'] ?? []);
  const sectorObjectives = parseSectorObjectives(sections['Sector Objectives'] ?? []);

  const rolls = parseCorRolls(sections['COR Rolls'] ?? []);

  const modeLines = sections['Aminon Mode'] ?? [];
  const isHardmode = modeLines.some((l) => /hard/i.test(l));

  const damageLines = sections['Aminon Damage Report'] ?? [];
  const wsLines = sections['Aminon Weaponskill Averages'] ?? [];
  const durationLines = sections['Aminon Fight Duration'] ?? [];

  const mesoLine = (sections['Meso Drops'] ?? []).find((l) => /\d/.test(l));

  let aminon: AminonData | null = null;
  if (damageLines.length > 0) {
    const durationText = durationLines.join(' ');
    const aminonWsAccLines = sections['Aminon WS Accuracy'] ?? [];
    const aminonAccLines = sections['Aminon Accuracy'] ?? [];
    const aminonCritLines = sections['Aminon Crit Rate'] ?? [];
    const aminonMavgLines = sections['Aminon Melee Average'] ?? [];
    const aminonCritAvgLines = sections['Aminon Melee Crit Average'] ?? [];
    aminon = {
      mode: isHardmode ? 'hardmode' : 'normal',
      damageReport: parseDamageReport(damageLines),
      wsAverages: parseWsAverages(wsLines),
      fightDurationSeconds: parseDuration(durationText),
      rolls,
      mesoCount: mesoLine ? parseCommaNumber(mesoLine.replace(/[^\d,]/g, '')) : undefined,
      wsAccuracy: aminonWsAccLines.length > 0 ? parsePctStat(aminonWsAccLines) : undefined,
      accuracy: aminonAccLines.length > 0 ? parsePctStat(aminonAccLines) : undefined,
      critRate: aminonCritLines.length > 0 ? parsePctStat(aminonCritLines) : undefined,
      meleeAverage: aminonMavgLines.length > 0 ? parseAvgStat(aminonMavgLines) : undefined,
      meleeCritAverage: aminonCritAvgLines.length > 0 ? parseAvgStat(aminonCritAvgLines) : undefined,
    };
  }

  const bossReports = parseBossReports(sections);

  const notesLines = sections['Extra Notes/Mentions'] ?? [];
  const notes = notesLines.join('\n').trim() || 'Nothing to add';

  return {
    runDate: header.runDate,
    gallimaufry: header.gallimaufry,
    oldCasePlus1: header.oldCasePlus1,
    defeatedBosses,
    party,
    bonusObjectives,
    treasureChests,
    sectorObjectives,
    aminon,
    bossReports,
    areaTimes: null,
    zoneLog: null,
    deathLog: null,
    chestLog: null,
    naakualKills: null,
    miniNmLog: null,
    dropLog: null,
    drops: null,
    notes,
    sortieStartTime: null,
    combatStats: null,
    actionLog: null,
    killLog: null,
    itemUseLog: null,
    positionLog: null,
    bossHpLog: null,
    partyHpLog: null,
    partyTpLog: null,
    partyMpLog: null,
    buffLog: null,
    skillchainLog: null,
    petLog: null,
    battleMsgRaw: null,
    jobExtendedLog: null,
    effectLog: null,
  };
}
