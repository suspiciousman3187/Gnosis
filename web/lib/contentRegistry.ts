
import type { LootEncounterSummary } from './dropAggregator';
import type { EncounterSource } from './encounter';

export type ContentCategory = 'endgame' | 'group' | 'solo' | 'event';
export type BossCategory = 'final' | 'mid' | 'mini-nm' | 'naakual' | 'mob';

export type ContentColorKey =
  | 'amber' | 'violet' | 'teal' | 'emerald' | 'rose' | 'orange' | 'cyan' | 'red' | 'sky' | 'fuchsia' | 'slate'
  | 'crimson' | 'bronze' | 'lime' | 'blue' | 'copper' | 'meadow' | 'amethyst' | 'spectral' | 'twilight';

export interface ContentColorClasses {
  chip:     string;
  titleOn:  string;
  titleOff: string;
  dot:      string;
}

export const CONTENT_COLOR_PALETTE: Record<ContentColorKey, ContentColorClasses> = {
  amber:   { chip: 'bg-amber-500/25 text-amber-200 border-amber-500/50',     titleOn: 'text-amber-300',   titleOff: 'text-amber-400',   dot: 'bg-amber-400'   },
  violet:  { chip: 'bg-violet-500/25 text-violet-200 border-violet-500/50',  titleOn: 'text-violet-300',  titleOff: 'text-violet-400',  dot: 'bg-violet-400'  },
  teal:    { chip: 'bg-teal-500/25 text-teal-200 border-teal-500/50',        titleOn: 'text-teal-300',    titleOff: 'text-teal-400',    dot: 'bg-teal-400'    },
  emerald: { chip: 'bg-emerald-500/25 text-emerald-200 border-emerald-500/50', titleOn: 'text-emerald-300', titleOff: 'text-emerald-400', dot: 'bg-emerald-400' },
  rose:    { chip: 'bg-rose-500/25 text-rose-200 border-rose-500/50',        titleOn: 'text-rose-300',    titleOff: 'text-rose-400',    dot: 'bg-rose-400'    },
  orange:  { chip: 'bg-orange-500/25 text-orange-200 border-orange-500/50',  titleOn: 'text-orange-300',  titleOff: 'text-orange-400',  dot: 'bg-orange-400'  },
  cyan:    { chip: 'bg-cyan-500/25 text-cyan-200 border-cyan-500/50',        titleOn: 'text-cyan-300',    titleOff: 'text-cyan-400',    dot: 'bg-cyan-400'    },
  red:     { chip: 'bg-red-500/25 text-red-200 border-red-500/50',           titleOn: 'text-red-300',     titleOff: 'text-red-400',     dot: 'bg-red-400'     },
  sky:     { chip: 'bg-sky-400/25 text-sky-100 border-sky-400/55',           titleOn: 'text-sky-200',     titleOff: 'text-sky-300',     dot: 'bg-sky-300'     },
  fuchsia: { chip: 'bg-fuchsia-500/25 text-fuchsia-200 border-fuchsia-500/50', titleOn: 'text-fuchsia-300', titleOff: 'text-fuchsia-400', dot: 'bg-fuchsia-400' },
  slate:   { chip: 'bg-white/[0.10] text-gray-200 border-white/25',          titleOn: 'text-gray-200',    titleOff: 'text-gray-300',    dot: 'bg-slate-400'   },
  crimson: { chip: 'bg-red-700/35 text-red-100 border-red-700/60',           titleOn: 'text-red-200',     titleOff: 'text-red-300',     dot: 'bg-red-600'     },
  bronze:  { chip: 'bg-amber-700/35 text-amber-100 border-amber-700/60',     titleOn: 'text-amber-200',   titleOff: 'text-amber-300',   dot: 'bg-amber-600'   },
  lime:    { chip: 'bg-lime-500/25 text-lime-200 border-lime-500/50',        titleOn: 'text-lime-300',    titleOff: 'text-lime-400',    dot: 'bg-lime-400'    },
  blue:    { chip: 'bg-blue-500/25 text-blue-200 border-blue-500/50',        titleOn: 'text-blue-300',    titleOff: 'text-blue-400',    dot: 'bg-blue-400'    },
  // Deep brass-orange — matches the Omen rune portal's burnt-copper hue.
  copper:  { chip: 'bg-orange-700/35 text-orange-100 border-orange-700/60',  titleOn: 'text-orange-200',  titleOff: 'text-orange-300',  dot: 'bg-orange-600'  },
  // Sun-bleached olive-grass — matches the dry meadow surrounding Omen's runes.
  meadow:  { chip: 'bg-lime-800/35 text-lime-100 border-lime-700/60',        titleOn: 'text-lime-200',    titleOff: 'text-lime-300',    dot: 'bg-lime-700'    },
  // Vivid magenta-purple — matches the iconic Sortie zone-energy fields.
  amethyst:{ chip: 'bg-purple-600/35 text-purple-100 border-purple-500/60',  titleOn: 'text-purple-200',  titleOff: 'text-purple-300',  dot: 'bg-purple-500'  },
  // Pale ghostly silver-white — matches Limbus's misty Apollyon/Temenos glow.
  spectral:{ chip: 'bg-stone-200/20 text-stone-50 border-stone-200/55',      titleOn: 'text-stone-100',   titleOff: 'text-stone-200',   dot: 'bg-stone-200'   },
  // Deep gothic indigo-purple — matches Walk of Echoes' twilit spires.
  twilight:{ chip: 'bg-indigo-700/35 text-indigo-100 border-indigo-700/60',  titleOn: 'text-indigo-200',  titleOff: 'text-indigo-300',  dot: 'bg-indigo-600'  },
};

export const ADDON_SOURCE_COLOR: Record<EncounterSource, ContentColorKey | null> = {
  generic:   null,
  sortie:    'amethyst',
  limbus:    'blue',
  odyssey:   'twilight',
  omen:      'rose',
  ambuscade: 'bronze',
};

export const ADDON_SOURCE_LABEL: Record<EncounterSource, string> = {
  generic:   'Encounter',
  sortie:    'Sortie',
  limbus:    'Limbus',
  odyssey:   'Odyssey',
  omen:      'Omen',
  ambuscade: 'Ambuscade',
};

export interface ContentBoss {
  name: string;
  category: BossCategory;
  notable?: boolean; // counts toward the tile's "X/Y bosses lifetime" headline
}

export interface ContentDef {
  id: string;
  name: string;
  category: ContentCategory;
  color: ContentColorKey;
  shortDescription?: string;
  detect: {
    fileKinds?: ('encounter' | 'sortie')[];
    sheolType?: 'A' | 'B' | 'C';
    /** Zone-id match (any). */
    zoneIds?: number[];
    /** Zone-name match (any pattern, case-insensitive). */
    zoneNamePatterns?: RegExp[];
    /** Exact mob NAME — at least one must appear in killLog/dropLog/enemies. */
    requiredBosses?: string[];
    /** Japanese-client equivalents of requiredBosses. Same OR semantics; defs SHOULD declare
     *  both lists when JP players use this content. */
    requiredBossesJa?: string[];
    /** When true, requiredBosses is a hard gate even on rows with no mob evidence
     *  (no enemy_names). Use for content whose zone selectors aren't distinctive on
     *  their own (e.g. Unity NMs pop in open-world farming zones). */
    strictBosses?: boolean;
    /** Case-insensitive substring patterns against mob names. */
    requiredMobPatterns?: string[];
    /** Japanese-client equivalents of requiredMobPatterns. */
    requiredMobPatternsJa?: string[];
    /** Exact item NAME — at least one must appear in dropLog. Strong signature evidence. */
    requiredDrops?: string[];
    /** Japanese-client equivalents of requiredDrops. */
    requiredDropsJa?: string[];
    /** Case-insensitive substring patterns against drop item names. */
    requiredDropPatterns?: string[];
    /** Japanese-client equivalents of requiredDropPatterns. */
    requiredDropPatternsJa?: string[];
  };
  bosses: ContentBoss[];
  /** Headline drops surfaced on the hub tile. Optional polish. */
  highlightDrops?: string[];
}

const SORTIE: ContentDef = {
  id: 'sortie',
  name: 'Sortie',
  category: 'endgame',
  color: 'amethyst',
  shortDescription: 'Outer Ra\'Kaznar [U2]/[U3]',
  detect: {
    fileKinds: ['sortie'],
    zoneNamePatterns: [/Ra'Kaznar.*\[U[23]\]/i],
  },
  bosses: [
    { name: 'Ghatjot',   category: 'mid',  notable: true },
    { name: 'Leshonn',   category: 'mid',  notable: true },
    { name: 'Skomora',   category: 'mid',  notable: true },
    { name: 'Degei',     category: 'mid',  notable: true },
    { name: 'Dhartok',   category: 'mid',  notable: true },
    { name: 'Gartell',   category: 'mid',  notable: true },
    { name: 'Triboulex', category: 'mid',  notable: true },
    { name: 'Aita',      category: 'mid',  notable: true },
    { name: 'Aminon',    category: 'final', notable: true },
    // Per-sector Naakuals (E/F/G/H share the same six names).
    { name: 'Bztavian',  category: 'naakual' },
    { name: 'Rockfin',   category: 'naakual' },
    { name: 'Gabbrath',  category: 'naakual' },
    { name: 'Waktza',    category: 'naakual' },
    { name: 'Yggdreant', category: 'naakual' },
    { name: 'Cehuetzi',  category: 'naakual' },
  ],
  highlightDrops: ['Old Case', 'Old Case +1', "Ra'Kaznar Sapphire", 'Eikondrite'],
};

const SHEOL_A: ContentDef = {
  id: 'sheol-a',
  name: 'Sheol A',
  category: 'endgame',
  color: 'teal',
  shortDescription: 'Walk of Echoes - Sheol A',
  detect: {
    fileKinds: ['encounter'],
    zoneIds: [279, 298],
    zoneNamePatterns: [/Walk of Echoes.*\[P[12]\]/i],
    requiredMobPatterns: ['Nostos', 'Agon'],
    requiredDrops: ['Lustreless Scale'],
  },
  bosses: [
    { name: 'Mboze',   category: 'mid',   notable: true },
    { name: 'Ngai',    category: 'mid',   notable: true },
    { name: 'Kalunga', category: 'final', notable: true },
  ],
  highlightDrops: ['Lustreless Scale', 'Sherida Earring', 'Eabani Earring'],
};

const SHEOL_B: ContentDef = {
  id: 'sheol-b',
  name: 'Sheol B',
  category: 'endgame',
  color: 'amber',
  shortDescription: 'Walk of Echoes - Sheol B',
  detect: {
    fileKinds: ['encounter'],
    zoneIds: [279, 298],
    zoneNamePatterns: [/Walk of Echoes.*\[P[12]\]/i],
    requiredMobPatterns: ['Nostos', 'Agon'],
    requiredDrops: ['Lustreless Hide'],
  },
  bosses: [
    { name: 'Arebati',  category: 'mid',   notable: true },
    { name: 'Ongo',     category: 'mid',   notable: true },
    { name: 'Gogmagog', category: 'final', notable: true },
  ],
  highlightDrops: ['Lustreless Hide', 'Niqmaddu Ring', 'Beithir Ring'],
};

const SHEOL_C: ContentDef = {
  id: 'sheol-c',
  name: 'Sheol C',
  category: 'endgame',
  color: 'lime',
  shortDescription: 'Walk of Echoes - Sheol C',
  detect: {
    fileKinds: ['encounter'],
    zoneIds: [279, 298],
    zoneNamePatterns: [/Walk of Echoes.*\[P[12]\]/i],
    requiredMobPatterns: ['Nostos', 'Agon'],
    requiredDrops: ['Lustreless Wing'],
  },
  bosses: [
    { name: 'Henwen',      category: 'mid',   notable: true },
    { name: 'Marmorkrebs', category: 'mid',   notable: true },
    { name: 'Bumba',       category: 'final', notable: true },
  ],
  highlightDrops: ['Lustreless Wing', 'Adapa Shield', 'Moonlight Cape'],
};

const SHEOL_FLOORS: ContentDef = {
  id: 'sheol-floors',
  name: 'Sheol A/B/C',
  category: 'endgame',
  color: 'slate',
  shortDescription: 'Walk of Echoes - Sheol floors (V20/V25)',
  detect: {
    fileKinds: ['encounter'],
    zoneIds: [279, 298],
    zoneNamePatterns: [/Walk of Echoes.*\[P[12]\]/i],
    requiredMobPatterns: ['Nostos', 'Agon'],
  },
  bosses: [
    // A
    { name: 'Mboze',   category: 'mid', notable: true },
    { name: 'Ngai',    category: 'mid', notable: true },
    { name: 'Kalunga', category: 'final', notable: true },
    // B
    { name: 'Arebati',  category: 'mid', notable: true },
    { name: 'Ongo',     category: 'mid', notable: true },
    { name: 'Gogmagog', category: 'final', notable: true },
    // C
    { name: 'Henwen',      category: 'mid', notable: true },
    { name: 'Marmorkrebs', category: 'mid', notable: true },
    { name: 'Bumba',       category: 'final', notable: true },
  ],
  highlightDrops: [
    'Sherida Earring', 'Eabani Earring', 'Niqmaddu Ring', 'Esyiri Necklace',
    'Beithir Ring', 'Adapa Shield', 'Moonlight Cape',
  ],
};

const SHEOL_GAOL: ContentDef = {
  id: 'sheol-gaol',
  name: 'Sheol Gaol',
  category: 'endgame',
  color: 'crimson',
  shortDescription: 'Walk of Echoes - Gaol NMs',
  detect: {
    fileKinds: ['encounter'],
    zoneIds: [279, 298],
    zoneNamePatterns: [/Walk of Echoes.*\[P[12]\]/i],
    requiredBosses: [
      'Bumba', 'Kalunga', 'Gogmagog',
      'Dealan-dhe', 'Sgili', 'U Bnai', 'Aristaeus', 'Raskovniche',
      'Marmorkrebs', 'Gigelorum', 'Procne', 'Henwen', 'Xevioso', 'Ngai',
      'Ongo', 'Mboze', 'Arebati',
    ],
  },
  bosses: [
    { name: 'Bumba',    category: 'final', notable: true },
    { name: 'Kalunga',  category: 'final', notable: true },
    { name: 'Gogmagog', category: 'final', notable: true },
    { name: 'Dealan-dhe', category: 'mid' },
    { name: 'Sgili',      category: 'mid' },
    { name: 'U Bnai',     category: 'mid' },
    { name: 'Aristaeus',  category: 'mid' },
    { name: 'Raskovniche',category: 'mid' },
    { name: 'Marmorkrebs',category: 'mid' },
    { name: 'Gigelorum',  category: 'mid' },
    { name: 'Procne',     category: 'mid' },
    { name: 'Henwen',     category: 'mid' },
    { name: 'Xevioso',    category: 'mid' },
    { name: 'Ngai',       category: 'mid' },
    { name: 'Ongo',       category: 'mid' },
    { name: 'Mboze',      category: 'mid' },
    { name: 'Arebati',    category: 'mid' },
  ],
  highlightDrops: [
    'Nyame Helm', 'Nyame Mail', 'Nyame Gauntlets', 'Nyame Flanchard', 'Nyame Sollerets',
    'Agwu\'s Cap', 'Agwu\'s Robe', 'Agwu\'s Gages', 'Agwu\'s Slops', 'Agwu\'s Pigaches',
    'Niqmaddu Ring', 'Begrudging Ring',
  ],
};

const OMEN: ContentDef = {
  id: 'omen',
  name: 'Omen',
  category: 'endgame',
  color: 'meadow',
  shortDescription: 'Reisenjima Henge',
  detect: {
    fileKinds: ['encounter'],
    zoneIds: [292],
    zoneNamePatterns: [/Reisenjima Henge/i],
    requiredMobPatterns: [
      'Fu', 'Gin', 'Kei', 'Kin', 'Kyou', 'Ou',
      'Glassy Gorger', 'Glassy Carver', 'Glassy Thinker',
      'Transcended', 'Sweetwater',
    ],
  },
  bosses: [
    { name: 'Ou',             category: 'final', notable: true },
    { name: 'Kyou',           category: 'final', notable: true },
    { name: 'Kin',            category: 'final', notable: true },
    { name: 'Gin',            category: 'final', notable: true },
    { name: 'Fu',             category: 'final', notable: true },
    { name: 'Kei',            category: 'final', notable: true },
    { name: 'Glassy Carver',  category: 'mid', notable: true },
    { name: 'Glassy Gorger',  category: 'mid', notable: true },
    { name: 'Glassy Thinker', category: 'mid', notable: true },
    // Cardinal-scale droppers (the four-saint mid mobs).
    { name: 'Kouryu',         category: 'mid' },
    { name: 'Kirin',          category: 'mid' },
    { name: 'Suzaku',         category: 'mid' },
    { name: 'Genbu',          category: 'mid' },
    { name: 'Byakko',         category: 'mid' },
    { name: 'Seiryu',         category: 'mid' },
  ],
  highlightDrops: [
    'Hjarrandi Helm', 'Hjarrandi Breastplate', 'Regal Gloves', 'Regal Belt',
    'Regal Captain\'s Gorget', 'Regal Necklace', 'Regal Ring',
    'Cape of Kallos', 'Khonsu',
  ],
};

const DYNAMIS_D: ContentDef = {
  id: 'dynamis-d',
  name: 'Dynamis Divergence',
  category: 'endgame',
  color: 'orange',
  shortDescription: 'San d\'Oria / Bastok / Windurst / Jeuno [D]',
  detect: {
    fileKinds: ['encounter'],
    zoneNamePatterns: [/Dynamis.*\[D\]/i],
    requiredMobPatterns: [
      'Squadron', 'Regiment', 'Volte', 'Disjoined',
      'Aurix', 'Evincing Idol', 'Fii Pexu the Eternal', 'Halphas',
      'Impish Golem', "Ka'Rho Fearsinger", "Mu'Sha Effigy",
      'Obstatrix', "Overseer's Tombstone",
    ],
  },
  bosses: [
    { name: "Overseer's Tombstone", category: 'final', notable: true },
    { name: 'Halphas',              category: 'final', notable: true },
    { name: 'Aurix',                category: 'mid',   notable: true },
    { name: 'Evincing Idol',        category: 'mid',   notable: true },
    { name: 'Fii Pexu the Eternal', category: 'mid',   notable: true },
    { name: 'Impish Golem',         category: 'mid',   notable: true },
    { name: "Ka'Rho Fearsinger",    category: 'mid',   notable: true },
    { name: "Mu'Sha Effigy",        category: 'mid',   notable: true },
    { name: 'Obstatrix',            category: 'mid',   notable: true },
  ],
  highlightDrops: [
    'Crepuscular Ring', 'Crepuscular Pebble', 'Crepuscular Cloak',
    'Lustratio Cap +1', 'Volte Cap', 'Volte Doublet',
  ],
};

const GEAS_FETE: ContentDef = {
  id: 'geas-fete',
  name: 'Geas Fete',
  category: 'endgame',
  color: 'cyan',
  shortDescription: 'Escha - Zi\'Tah / Ru\'Aun / Reisenjima',
  detect: {
    fileKinds: ['encounter'],
    zoneIds: [288, 289, 291],
    zoneNamePatterns: [/Escha.*Zi'Tah/i, /Escha.*Ru'Aun/i, /^Reisenjima$/i],
    requiredBosses: [
      'Aglaophotis', 'Angrboda', 'Cunnast', 'Ferrodon', 'Gestalt', 'Gulltop',
      'Lustful Lydia', 'Revetaur', 'Tangata Manu', 'Vidala', 'Vyala', 'Wepwawet',
      'Brittlis', 'Ionos', 'Kamohoalii', 'Nosoi', 'Sensual Sandy', 'Umdhlebi',
      'Fleetstalker', 'Shockmaw', 'Urmahlullu',
      'Alpluachra', 'Bucca', 'Puca', 'Blazewing', 'Pazuzu', 'Wrathare',
      'Asida', 'Bia', 'Emputa', 'Khon', 'Khun', 'Ma', 'Met', 'Peirithoos',
      'Ruea', 'Sava Savanovic', 'Tenodera', 'Wasserspeier',
      'Amymone', 'Hanbi', 'Kammavaca', 'Naphula', 'Palila', 'Yilan',
      'Duke Vepar', 'Pakecet', "Vir'ava",
      'Ark Angel EV', 'Ark Angel GK', 'Ark Angel HM', 'Ark Angel MR', 'Ark Angel TT',
      'Byakko', 'Genbu', 'Kirin', 'Seiryu', 'Suzaku', 'Warder of Courage',
      'Belphegor', 'Crom Dubh', 'Dazzling Dolores', 'Golden Kist', 'Kabandha',
      'Mauve-wristed Gomberry', 'Oryx', 'Sabotender Royal', 'Sang Buaya',
      'Selkit', 'Taelmoth the Diremaw', 'Zduhac',
      'Bashmu', 'Gajasimha', 'Ironside', 'Old Shuck', 'Sarsaok', 'Strophadia',
      'Maju', 'Neak', 'Yakshi',
      'Albumen', 'Erinys', 'Onychophora', 'Schah', 'Teles', 'Vinipata', 'Zerde',
    ],
  },
  bosses: [
    // Zi'Tah
    { name: 'Aglaophotis',  category: 'mid', notable: true },
    { name: 'Angrboda',     category: 'mid', notable: true },
    { name: 'Cunnast',      category: 'mid', notable: true },
    { name: 'Ferrodon',     category: 'mid', notable: true },
    { name: 'Gestalt',      category: 'mid', notable: true },
    { name: 'Gulltop',      category: 'mid', notable: true },
    { name: 'Lustful Lydia',category: 'mid', notable: true },
    { name: 'Revetaur',     category: 'mid', notable: true },
    { name: 'Tangata Manu', category: 'mid', notable: true },
    { name: 'Vidala',       category: 'mid', notable: true },
    { name: 'Vyala',        category: 'mid', notable: true },
    { name: 'Wepwawet',     category: 'mid', notable: true },
    { name: 'Brittlis',     category: 'mid' },
    { name: 'Ionos',        category: 'mid' },
    { name: 'Kamohoalii',   category: 'mid' },
    { name: 'Nosoi',        category: 'mid' },
    { name: 'Sensual Sandy',category: 'mid' },
    { name: 'Umdhlebi',     category: 'mid' },
    { name: 'Fleetstalker', category: 'mid' },
    { name: 'Shockmaw',     category: 'mid' },
    { name: 'Urmahlullu',   category: 'mid' },
    // Ru'Aun
    { name: 'Alpluachra', category: 'mid' },
    { name: 'Bucca',      category: 'mid' },
    { name: 'Puca',       category: 'mid' },
    { name: 'Blazewing',  category: 'mid' },
    { name: 'Pazuzu',     category: 'mid', notable: true },
    { name: 'Wrathare',   category: 'mid' },
    { name: 'Asida',      category: 'mid' },
    { name: 'Bia',        category: 'mid' },
    { name: 'Emputa',     category: 'mid' },
    { name: 'Khon',       category: 'mid' },
    { name: 'Khun',       category: 'mid' },
    { name: 'Ma',         category: 'mid' },
    { name: 'Met',        category: 'mid' },
    { name: 'Peirithoos', category: 'mid' },
    { name: 'Ruea',       category: 'mid' },
    { name: 'Sava Savanovic', category: 'mid' },
    { name: 'Tenodera',   category: 'mid' },
    { name: 'Wasserspeier', category: 'mid' },
    { name: 'Amymone',    category: 'mid' },
    { name: 'Hanbi',      category: 'mid' },
    { name: 'Kammavaca',  category: 'mid' },
    { name: 'Naphula',    category: 'mid' },
    { name: 'Palila',     category: 'mid' },
    { name: 'Yilan',      category: 'mid' },
    { name: 'Duke Vepar', category: 'mid' },
    { name: 'Pakecet',    category: 'mid' },
    { name: "Vir'ava",    category: 'mid' },
    // Ark Angels (Ru'Aun gods cycle)
    { name: 'Ark Angel EV', category: 'final', notable: true },
    { name: 'Ark Angel GK', category: 'final', notable: true },
    { name: 'Ark Angel HM', category: 'final', notable: true },
    { name: 'Ark Angel MR', category: 'final', notable: true },
    { name: 'Ark Angel TT', category: 'final', notable: true },
    // Four-saints + Kirin
    { name: 'Byakko',           category: 'final', notable: true },
    { name: 'Genbu',            category: 'final', notable: true },
    { name: 'Kirin',            category: 'final', notable: true },
    { name: 'Seiryu',           category: 'final', notable: true },
    { name: 'Suzaku',           category: 'final', notable: true },
    { name: 'Warder of Courage',category: 'final', notable: true },
    // Reisenjima
    { name: 'Belphegor',   category: 'final', notable: true },
    { name: 'Crom Dubh',   category: 'final', notable: true },
    { name: 'Dazzling Dolores', category: 'mid' },
    { name: 'Golden Kist',  category: 'mid' },
    { name: 'Kabandha',     category: 'mid' },
    { name: 'Mauve-wristed Gomberry', category: 'mid' },
    { name: 'Oryx',         category: 'mid' },
    { name: 'Sabotender Royal', category: 'mid' },
    { name: 'Sang Buaya',   category: 'mid' },
    { name: 'Selkit',       category: 'mid' },
    { name: 'Taelmoth the Diremaw', category: 'mid' },
    { name: 'Zduhac',       category: 'mid' },
    { name: 'Bashmu',       category: 'mid' },
    { name: 'Gajasimha',    category: 'mid' },
    { name: 'Ironside',     category: 'mid' },
    { name: 'Old Shuck',    category: 'mid' },
    { name: 'Sarsaok',      category: 'mid' },
    { name: 'Strophadia',   category: 'mid' },
    { name: 'Maju',         category: 'mid' },
    { name: 'Neak',         category: 'mid' },
    { name: 'Yakshi',       category: 'mid' },
    { name: 'Albumen',      category: 'mid' },
    { name: 'Erinys',       category: 'mid' },
    { name: 'Onychophora',  category: 'mid' },
    { name: 'Schah',        category: 'mid' },
    { name: 'Teles',        category: 'mid' },
    { name: 'Vinipata',     category: 'mid' },
    { name: 'Zerde',        category: 'mid' },
  ],
  highlightDrops: [
    'Crepuscular Ring', 'Sroda Ring', 'Dampening Tam', 'Iskur Gorget',
    'Mache Earring +1', 'Halasz Earring', 'Karieyh Moufles +1',
  ],
};

const LIMBUS: ContentDef = {
  id: 'limbus',
  name: 'Limbus',
  category: 'endgame',
  color: 'blue',
  shortDescription: 'Apollyon / Temenos',
  detect: {
    fileKinds: ['encounter'],
    zoneIds: [37, 38],
    zoneNamePatterns: [/^Apollyon\b/i, /^Temenos\b/i],
    requiredMobPatterns: [
      'Ahriman', 'Bomb', 'Bugard', 'Chariot', 'Doll', 'Eft', 'Eruca',
      'Ghost', 'Goblin', 'Golem', 'Gorger', 'Hpemde', 'Imp', 'Manticore',
      'Mover', 'Nightmare', 'Orc', 'Quadav', 'Sahagin', 'Skeleton',
      'Smok', 'Tonberry', 'Wivre', 'Wyvern', 'Yagudo',
    ],
  },
  bosses: [
    { name: 'Apollyon Megaboss',  category: 'final', notable: true },
    { name: 'Temenos Megaboss',   category: 'final', notable: true },
  ],
  highlightDrops: [
    'Ancient Beastcoin', 'Homunculus', 'Animaclay', 'Animacrystal', 'Animadust',
  ],
};

const AMBUSCADE: ContentDef = {
  id: 'ambuscade',
  name: 'Ambuscade',
  category: 'group',
  color: 'bronze',
  shortDescription: 'Abdhaljs Maquette - Legion A/B',
  detect: {
    fileKinds: ['encounter'],
    zoneIds: [183, 287],
    zoneNamePatterns: [/Maquette Abdhaljs/i, /Abdhaljs Isle/i],
    requiredMobPatterns: ['Bozzetto'],
  },
  bosses: [],
  highlightDrops: [],
};

const UNITY: ContentDef = {
  id: 'unity',
  name: 'Unity',
  category: 'group',
  color: 'fuchsia',
  shortDescription: 'Unity Wanted NMs',
  detect: {
    fileKinds: ['encounter'],
    zoneNamePatterns: [
      /^South Gustaberg$/i, /^East Ronfaure$/i, /^East Sarutabaruta$/i,
      /^La Theine Plateau$/i, /^Konschtat Highlands$/i, /^Tahrongi Canyon$/i,
      /^Buburimu Peninsula$/i, /^Lufaise Meadows$/i, /^Bibiki Bay$/i,
      /^Qufim Island$/i, /^Carpenters' Landing$/i, /^Yuhtunga Jungle$/i,
      /^Valkurm Dunes$/i, /^Eastern Altepa Desert$/i, /^Jugner Forest$/i,
      /^Bostaunieux Oubliette$/i, /^Pashhow Marshlands$/i,
      /^The Sanctuary of Zi'Tah$/i, /^Misareaux Coast$/i,
      /^Labyrinth of Onzozo$/i, /^Meriphataud Mountains$/i,
      /^Yhoator Jungle$/i, /^Sauromugue Champaign$/i, /^The Boyahda Tree$/i,
      /^Temple of Uggalepih$/i, /^Sea Serpent Grotto$/i, /^Xarcabard$/i,
      /^Quicksand Caves$/i, /^Ifrit's Cauldron$/i, /^Ro'Maeve$/i,
      /^Western Altepa Desert$/i, /^Wajaom Woodlands$/i,
      /^Beaucedine Glacier$/i, /^Batallia Downs$/i, /^Garlaige Citadel$/i,
      /^Attohwa Chasm$/i, /^Kuftal Tunnel$/i, /^Rolanberry Fields$/i,
      /^Den of Rancor$/i, /^Fei'Yin$/i, /^Uleguerand Range$/i,
      /^Mount Zhayolm$/i, /^Cape Teriggan$/i,
      /^Alzadaal Undersea Ruins$/i, /^Gustav Tunnel$/i,
      /^Behemoth's Dominion$/i, /^Valley of Sorrows$/i,
      /^Caedarva Mire$/i, /^Aydeewa Subterrane$/i,
    ],
    requiredBosses: [
      'Bounding Belinda', 'Hugemaw Harold', 'Prickly Pitriv', 'Ironhorn Baldurno',
      'Sleepy Mabel', 'Serpopard Ninlil', 'Abyssdiver', 'Immanibugard',
      'Intuila', 'Jester Malatrix', 'Orcfeltrap', 'Sybaritic Samantha',
      'Valkurm Imperator', 'Cactrot Veloz', 'Emperor Arthro', 'Garbage Gel',
      'Joyous Green', 'Keeper of Heiligtum', 'Tiyanak', 'Voso',
      'Warblade Beak', 'Woodland Mender', 'Arke', 'Ayapec',
      'Azure-toothed Clawberry', 'Bakunawa', 'Beist', 'Centurio XX-I',
      'Coca', 'Douma Weapon', 'King Uropygid', "Kubool Ja's Mhuufya",
      'Largantua', 'Lumber Jill', 'Mephitas', 'Muut',
      'Specter Worm', 'Strix', 'Vermillion Fishfly', 'Azrael',
      'Borealis Shadow', 'Camahueto', 'Carousing Celine', 'Grand Grenade',
      'Vedrfolnir', 'Vidmapire', 'Volatile Cluster', 'Glazemane',
      'Wyvernhunter Bambrox', 'Hidhaegg', 'Sovereign Behemoth', 'Tolba',
      "Thu'ban", 'Sarama', 'Shedu', 'Tumult Curator',
    ],
    strictBosses: true,
  },
  bosses: [],
  highlightDrops: [],
};

export const CONTENT_REGISTRY: ContentDef[] = [
  SORTIE,
  SHEOL_A,
  SHEOL_B,
  SHEOL_C,
  SHEOL_FLOORS,
  SHEOL_GAOL,
  OMEN,
  DYNAMIS_D,
  GEAS_FETE,
  LIMBUS,
  AMBUSCADE,
  UNITY,
];

/** Lookup by id (for routes / drill-down links). */
export function contentById(id: string): ContentDef | null {
  return CONTENT_REGISTRY.find(c => c.id === id) ?? null;
}

export interface ClassifyInput {
  kind: 'encounter' | 'sortie';
  zoneId: number | null;
  zoneName: string | null;
  mobNames: Set<string>;
  /** Drop item names from this encounter's dropLog. Optional — when empty, drop-evidence rules
   *  are evaluated as "no positive evidence" (not a hard reject) so a fast first-pass
   *  classifier without loot loaded still works. */
  itemNames?: Set<string>;
  sheolType?: 'A' | 'B' | 'C';
}

const SCORE_ZONE_ID         = 1;
const SCORE_ZONE_NAME       = 1;
const SCORE_REQUIRED_BOSS   = 4;
const SCORE_MOB_PATTERN     = 2;
const SCORE_REQUIRED_DROP   = 4;
const SCORE_DROP_PATTERN    = 2;
const SCORE_FILE_KIND_MATCH = 1;

interface ScoredMatch {
  def: ContentDef;
  score: number;
  rank: number;
}

/** Returns the best-matching ContentDef. "Best" = highest evidence score; ties broken by
 *  registry order. A def must satisfy ALL declared categories (kind, sheol type, zone,
 *  required bosses, mob patterns, required drops, drop patterns) to be a match at all —
 *  scoring only chooses between defs that ALREADY qualify. */
export function classify(input: ClassifyInput): ContentDef | null {
  const matches: ScoredMatch[] = [];
  for (let i = 0; i < CONTENT_REGISTRY.length; i++) {
    const def = CONTENT_REGISTRY[i];
    if (!matchesKind(def, input)) continue;
    if (!matchesSheolType(def, input)) continue;
    if (isContentModuleMatch(def, input)) {
      matches.push({ def, score: scoreOf(def, input) + SCORE_FILE_KIND_MATCH, rank: i });
      continue;
    }
    if (!matchesZone(def, input)) continue;
    if (!matchesRequiredBosses(def, input)) continue;
    if (!matchesRequiredMobPatterns(def, input)) continue;
    if (!matchesRequiredDrops(def, input)) continue;
    if (!matchesRequiredDropPatterns(def, input)) continue;
    matches.push({ def, score: scoreOf(def, input), rank: i });
  }
  if (matches.length === 0) return null;
  matches.sort((a, b) => b.score - a.score || a.rank - b.rank);
  return matches[0].def;
}

function scoreOf(def: ContentDef, i: ClassifyInput): number {
  let s = 0;
  if (def.detect.fileKinds && def.detect.fileKinds.includes(i.kind)) s += SCORE_FILE_KIND_MATCH;
  if (def.detect.zoneIds && i.zoneId != null && def.detect.zoneIds.includes(i.zoneId)) s += SCORE_ZONE_ID;
  if (def.detect.zoneNamePatterns && i.zoneName) {
    for (const re of def.detect.zoneNamePatterns) if (re.test(i.zoneName)) { s += SCORE_ZONE_NAME; break; }
  }
  const bossList = ([] as string[]).concat(def.detect.requiredBosses ?? [], def.detect.requiredBossesJa ?? []);
  if (bossList.length > 0) {
    for (const b of bossList) if (i.mobNames.has(b)) { s += SCORE_REQUIRED_BOSS; break; }
  }
  const mobPats = ([] as string[]).concat(def.detect.requiredMobPatterns ?? [], def.detect.requiredMobPatternsJa ?? []);
  if (mobPats.length > 0) {
    const lower = mobPats.map(p => p.toLowerCase());
    outer: for (const name of i.mobNames) {
      const n = name.toLowerCase();
      for (const p of lower) if (n.indexOf(p) !== -1) { s += SCORE_MOB_PATTERN; break outer; }
    }
  }
  if (i.itemNames) {
    const dropList = ([] as string[]).concat(def.detect.requiredDrops ?? [], def.detect.requiredDropsJa ?? []);
    if (dropList.length > 0) {
      for (const d of dropList) if (i.itemNames.has(d)) { s += SCORE_REQUIRED_DROP; break; }
    }
    const dropPats = ([] as string[]).concat(def.detect.requiredDropPatterns ?? [], def.detect.requiredDropPatternsJa ?? []);
    if (dropPats.length > 0) {
      const lower = dropPats.map(p => p.toLowerCase());
      outer: for (const name of i.itemNames) {
        const n = name.toLowerCase();
        for (const p of lower) if (n.indexOf(p) !== -1) { s += SCORE_DROP_PATTERN; break outer; }
      }
    }
  }
  return s;
}

function matchesKind(def: ContentDef, i: ClassifyInput): boolean {
  if (!def.detect.fileKinds || def.detect.fileKinds.length === 0) return true;
  return def.detect.fileKinds.includes(i.kind);
}

function isContentModuleMatch(def: ContentDef, i: ClassifyInput): boolean {
  if (i.kind === 'encounter') return false;
  return !!def.detect.fileKinds?.includes(i.kind);
}

function matchesSheolType(def: ContentDef, i: ClassifyInput): boolean {
  // Only enforce the Sheol-type check when the def declares one.
  if (def.detect.sheolType == null) return true;
  return i.sheolType === def.detect.sheolType;
}

function matchesZone(def: ContentDef, i: ClassifyInput): boolean {
  const { zoneIds, zoneNamePatterns } = def.detect;
  const hasIdRule = !!(zoneIds && zoneIds.length);
  const hasNameRule = !!(zoneNamePatterns && zoneNamePatterns.length);
  if (!hasIdRule && !hasNameRule) return true;
  if (zoneIds && i.zoneId != null && zoneIds.includes(i.zoneId)) return true;
  if (zoneNamePatterns && i.zoneName) {
    for (const re of zoneNamePatterns) if (re.test(i.zoneName)) return true;
  }
  return false;
}

function hasZoneSelector(def: ContentDef): boolean {
  return !!(def.detect.zoneIds?.length || def.detect.zoneNamePatterns?.length);
}

function matchesRequiredBosses(def: ContentDef, i: ClassifyInput): boolean {
  const req = def.detect.requiredBosses;
  const reqJa = def.detect.requiredBossesJa;
  if ((!req || req.length === 0) && (!reqJa || reqJa.length === 0)) return true;
  if (i.mobNames.size === 0 && hasZoneSelector(def) && !def.detect.strictBosses) return true;
  if (req)   for (const b of req)   if (i.mobNames.has(b)) return true;
  if (reqJa) for (const b of reqJa) if (i.mobNames.has(b)) return true;
  return false;
}

function matchesRequiredMobPatterns(def: ContentDef, i: ClassifyInput): boolean {
  const pats = def.detect.requiredMobPatterns;
  const patsJa = def.detect.requiredMobPatternsJa;
  if ((!pats || pats.length === 0) && (!patsJa || patsJa.length === 0)) return true;
  if (i.mobNames.size === 0 && hasZoneSelector(def)) return true;
  const lower: string[] = [];
  if (pats)   for (const p of pats)   lower.push(p.toLowerCase());
  if (patsJa) for (const p of patsJa) lower.push(p.toLowerCase());
  for (const name of i.mobNames) {
    const n = name.toLowerCase();
    for (const p of lower) if (n.indexOf(p) !== -1) return true;
  }
  return false;
}

function matchesRequiredDrops(def: ContentDef, i: ClassifyInput): boolean {
  const req = def.detect.requiredDrops;
  const reqJa = def.detect.requiredDropsJa;
  if ((!req || req.length === 0) && (!reqJa || reqJa.length === 0)) return true;
  if ((!i.itemNames || i.itemNames.size === 0) && hasZoneSelector(def)) return true;
  if (!i.itemNames) return false;
  if (req)   for (const d of req)   if (i.itemNames.has(d)) return true;
  if (reqJa) for (const d of reqJa) if (i.itemNames.has(d)) return true;
  return false;
}

function matchesRequiredDropPatterns(def: ContentDef, i: ClassifyInput): boolean {
  const pats = def.detect.requiredDropPatterns;
  const patsJa = def.detect.requiredDropPatternsJa;
  if ((!pats || pats.length === 0) && (!patsJa || patsJa.length === 0)) return true;
  if ((!i.itemNames || i.itemNames.size === 0) && hasZoneSelector(def)) return true;
  if (!i.itemNames) return false;
  if (!i.itemNames) return true;
  const lower: string[] = [];
  if (pats)   for (const p of pats)   lower.push(p.toLowerCase());
  if (patsJa) for (const p of patsJa) lower.push(p.toLowerCase());
  for (const name of i.itemNames) {
    const n = name.toLowerCase();
    for (const p of lower) if (n.indexOf(p) !== -1) return true;
  }
  return false;
}

/** Build the cheap mob-name set the classifier wants from a loot summary -
 *  every name that appeared in killLog, dropLog (as source), or enemies. */
export function mobNamesFromLootSummary(s: LootEncounterSummary): Set<string> {
  const set = new Set<string>();
  for (const k of s.killLog) set.add(k.name);
  for (const e of s.enemies) set.add(e.name);
  for (const d of s.dropLog) if (d.source) set.add(d.source);
  return set;
}

/** Build the cheap item-name set the classifier wants from a loot summary —
 *  every drop name we've recorded for this encounter. */
export function itemNamesFromLootSummary(s: LootEncounterSummary): Set<string> {
  const set = new Set<string>();
  for (const d of s.dropLog) if (d.name) set.add(d.name);
  return set;
}

/** Resolve the color palette for a def (preferred) or fall back to the addon source. */
export function resolveContentColor(def: ContentDef | null, source: EncounterSource | null | undefined): ContentColorClasses | null {
  if (def) return CONTENT_COLOR_PALETTE[def.color] ?? null;
  if (source && source !== 'generic') {
    const key = ADDON_SOURCE_COLOR[source];
    if (key) return CONTENT_COLOR_PALETTE[key];
  }
  return null;
}

/** Resolve the display label for a def or addon source. Empty when nothing to show. */
export function resolveContentLabel(def: ContentDef | null, source: EncounterSource | null | undefined): string | null {
  if (def) return def.name;
  if (source && source !== 'generic') return ADDON_SOURCE_LABEL[source] ?? source.toUpperCase();
  return null;
}
