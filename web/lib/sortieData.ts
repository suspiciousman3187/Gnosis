// All Sortie reference data derived from SortieInfo.txt

export interface ChestInfo {
  objective: string;
  reward?: string; // only chests have a named item reward listed
}

export const CHEST_INFO: Record<string, ChestInfo> = {
  A1: { objective: 'Open any unlocked Gate #A. (Ground Floor: D-4, F-2, H-2)', reward: 'Ra\'Kaznar Key A' },
  A2: { objective: 'Cast magic next to Diaphanous Device #A. Any magic works, including summoning an alter-ego / trust.', reward: 'Ra\'Kaznar Plate A' },
  A3: { objective: 'Vanquish 3 Abject foes using single-target magic for the killing blow.', reward: 'Ra\'Kaznar Shard A' },
  A4: { objective: 'Vanquish 3 more Abject foes using single-target magic for the killing blow.', reward: 'Ra\'Kaznar Metal A' },
  A5: { objective: 'Interact with Diaphanous Bitzer #A while naked.', reward: 'Ra\'Kaznar Sheet A' },

  B1: { objective: 'Open Gates #B1 through #B6 in order.', reward: 'Ra\'Kaznar Key B' },
  B2: { objective: '/hurray with Diaphanous Device #B.', reward: 'Ra\'Kaznar Plate B' },
  B3: { objective: 'Perform a Weapon Skill on 5 Biune foes before defeating them.', reward: 'Ra\'Kaznar Shard B' },
  B4: { objective: 'Perform a Weapon Skill on 5 more Biune foes before defeating them.', reward: 'Ra\'Kaznar Metal B' },
  B5: { objective: 'Interact with Diaphanous Bitzer #B after traveling from the entrance on foot. If you use a Diaphanous Device to warp, you must warp back to the start and start over.', reward: 'Ra\'Kaznar Sheet B' },

  C1: { objective: 'Open Gate #C1 or #C2 before defeating any enemies in Sector C.', reward: 'Ra\'Kaznar Key C' },
  C2: { objective: 'Pull a Cachaemic foe to Diaphanous Device #C and defeat it there.', reward: 'Ra\'Kaznar Plate C' },
  C3: { objective: 'Perform a Magic Burst on 3 Cachaemic foes before defeating them.', reward: 'Ra\'Kaznar Shard C' },
  C4: { objective: 'Perform a Magic Burst on 3 more Cachaemic foes before defeating them.', reward: 'Ra\'Kaznar Metal C' },
  C5: { objective: 'Vanquish at least one Cachaemic foe, Materialize Cachaemic foes at Diaphanous Device #C, then interact with Diaphanous Bitzer #C. The same player who Materializes must interact with the Bitzer.', reward: 'Ra\'Kaznar Sheet C' },

  D1: { objective: 'Open Gates #D1 and #D2, in either order, within two minutes of each other.', reward: 'Ra\'Kaznar Key D' },
  D2: { objective: 'Drop your Obsidian Wing at Diaphanous Device #D. You will not be kicked out, and you will get a new one immediately.', reward: 'Ra\'Kaznar Plate D' },
  D3: { objective: 'Perform a 4-step Skillchain on 3 Demisang foes before defeating them.', reward: 'Ra\'Kaznar Shard D' },
  D4: { objective: 'Perform a 4-step Skillchain on 3 more Demisang foes before defeating them.', reward: 'Ra\'Kaznar Metal D' },
  D5: { objective: 'Vanquish all Demisang foes, then interact with Diaphanous Bitzer #D. (Demisang Deleterious not required)', reward: 'Ra\'Kaznar Sheet D' },

  E: { objective: 'Vanquish Esurient Botulus with a majority of damage coming from Weapon Skills performed from behind it. Skillchain damage does not count.', reward: 'Ra\'Kaznar Metal E' },
  F: { objective: 'Vanquish Fetid Ixion while the horn is broken.', reward: 'Ra\'Kaznar Metal F' },
  G: { objective: 'Vanquish Gyvewrapped Naraka.', reward: 'Ra\'Kaznar Metal G' },
  H: { objective: 'Vanquish Haughty Tulittia after doing a majority of indirect damage through AoEs targeted on another monster (~50%).', reward: 'Ra\'Kaznar Metal H' },
};

export const CASKET_INFO: Record<string, ChestInfo> = {
  A1: { objective: 'Vanquish 5 Abject foes. (Does NOT include Abject Obdella)' },
  A2: { objective: '/heal in the area between Gate #A1 and the Abject Leeches.' },

  B1: { objective: 'Vanquish 3 Biune foes within 30 seconds of gaining enmity.' },
  B2: { objective: 'Open any Locked Gate #B. (Ground Floor: J-8, K-8, M-8)' },

  C1: { objective: 'Vanquish 3 Cachaemic foes within 15 seconds of gaining enmity.' },
  C2: { objective: 'Vanquish all Cachaemic foes.' },

  D1: { objective: 'Vanquish 6 Demisang foes of different jobs.' },
  D2: { objective: 'Vanquish Demisang foes in standard job order: WAR, MNK, WHM, BLM, RDM, THF. Defeating Demisang Deleterious does not interrupt the order.' },

  E1: { objective: 'Vanquish 12 Esurient foes in the room containing the Bitzer.' },
  E2: { objective: 'Vanquish 15 Esurient Flan.' },

  F1: { objective: 'Interact with the Diaphanous Bitzer while visibly wearing or lockstyling 5/5 pieces of Empyrean Armor of any upgrade level for your current job.' },
  F2: { objective: 'Vanquish all Fetid Veela.' },

  G1: { objective: 'Stand still within 6 yalms of the Diaphanous Bitzer while continuously targeting it for 30 seconds.' },
  G2: { objective: 'Vanquish 19 Gyvewrapped Dullahan.' },

  H1: { objective: 'Leave and re-enter Sector H.' },
  H2: { objective: 'Vanquish all Haughty Paladin.' },
};

export const COFFER_INFO: Record<string, ChestInfo> = {
  A: { objective: 'Vanquish Abject Obdella.' },
  B: { objective: 'Vanquish Biune Porxie after meeting the objective for Casket #B1.' },
  C: { objective: 'Vanquish Cachaemic Bhoot within 5 minutes of its spawn. Timer begins upon entering Sector C. Bhoot must be defeated before rematerializing to reset the timer.' },
  D: { objective: 'Vanquish Demisang Deleterious, then any 3 Demisang foes.' },
  E: { objective: 'Vanquish the 6 mini-Naakuals which appear 5 minutes after entering Sector E. Timer resets if the sector is evacuated before spawn. (Basement: F/G-6)' },
  F: { objective: 'Vanquish the 6 mini-Naakuals which appear when any party member who has previously left Sector F re-enters it. (Basement: J-6)' },
  G: { objective: 'Vanquish the 6 mini-Naakuals which appear after defeating all enemies in both sides of the split room. Must be killed in order: 🐝Bztavian → 🦈Rockfin → 🦖Gabbrath → 🦅Waktza → 🥦Yggdreant → 🦁Cehuetzi. (Basement: J-10)' },
  H: { objective: 'Vanquish the 6 mini-Naakuals which appear after defeating 8 Haughty foes of different jobs. Must be killed in order: 🐝Bztavian → 🦁Cehuetzi → 🦖Gabbrath → 🦈Rockfin → 🦅Waktza → 🥦Yggdreant. (Basement: F-10)' },
  Aurum: { objective: 'Vanquish Abject Obdella, Biune Porxie, Cachaemic Bhoot, and Demisang Deleterious. Any rematerialized copies must also be defeated.' },
};

// Gallimaufry from normal enemies
export const NORMAL_ENEMY_GALLI = [
  { sector: 'A', level: 119, galli: 30 },
  { sector: 'A', level: 120, galli: 33 },
  { sector: 'A', level: 121, galli: 36 },
  { sector: 'B', level: 123, galli: 42 },
  { sector: 'B', level: 124, galli: 45 },
  { sector: 'B', level: 125, galli: 48 },
  { sector: 'C', level: 127, galli: 54 },
  { sector: 'C', level: 128, galli: 57 },
  { sector: 'C', level: 129, galli: 60 },
  { sector: 'D', level: 131, galli: 66 },
  { sector: 'D', level: 132, galli: 69 },
  { sector: 'D', level: 133, galli: 72 },
  { sector: 'E', level: 134, galli: 75 },
  { sector: 'E', level: 135, galli: 78 },
  { sector: 'E', level: 136, galli: 81 },
  { sector: 'F', level: 135, galli: 78 },
  { sector: 'F', level: 136, galli: 81 },
  { sector: 'F', level: 137, galli: 84 },
  { sector: 'G', level: 136, galli: 81 },
  { sector: 'G', level: 137, galli: 84 },
  { sector: 'G', level: 138, galli: 87 },
  { sector: 'H', level: 137, galli: 84 },
  { sector: 'H', level: 138, galli: 87 },
  { sector: 'H', level: 139, galli: 90 },
  { sector: 'Naakuals', level: 140, galli: 93 },
];

// Gallimaufry from minor NMs
export const MINOR_NM_GALLI = [
  { sector: 'A', nm: 'Abject Obdella', galli: 195 },
  { sector: 'B', nm: 'Biune Porxie', galli: 255 },
  { sector: 'C', nm: 'Cachaemic Bhoot', galli: 315 },
  { sector: 'D', nm: 'Demisang Deleterious', galli: 375 },
  { sector: 'E', nm: 'Esurient Botulus', galli: 435 },
  { sector: 'F', nm: 'Fetid Ixion', galli: 450 },
  { sector: 'G', nm: 'Gyvewrapped Naraka', galli: 465 },
  { sector: 'H', nm: 'Haughty Tulittia', galli: 480 },
];

// Gallimaufry from major NMs (bosses)
export const MAJOR_NM_GALLI = [
  { sector: 'A', nm: 'Ghatjot', galli: 2000 },
  { sector: 'B', nm: 'Leshonn', galli: 2000 },
  { sector: 'C', nm: 'Skomora', galli: 2000 },
  { sector: 'D', nm: 'Degei', galli: 2000 },
  { sector: 'E', nm: 'Dhartok', galli: 10000 },
  { sector: 'F', nm: 'Gartell', galli: 10000 },
  { sector: 'G', nm: 'Triboulex', galli: 10000 },
  { sector: 'H', nm: 'Aita', galli: 10000 },
];

// Gallimaufry from treasure containers
export const CONTAINER_GALLI = [
  { sectors: 'A–D', type: 'Chest',       galli: 100 },
  { sectors: 'A–D', type: 'Casket',      galli: 100 },
  { sectors: 'A–D', type: 'Coffer',      galli: 500 },
  { sectors: 'A–D', type: 'Aurum Coffer',galli: 1000 },
  { sectors: 'E–H', type: 'Chest',       galli: 100 },
  { sectors: 'E–H', type: 'Casket',      galli: 300 },
  { sectors: 'E–H', type: 'Coffer',      galli: 1500 },
  { sectors: 'E–H', type: 'Aurum Coffer',galli: 3000 },
];

// Sector data for the info page
export const SECTORS = [
  {
    id: 'A', floor: 'Ground', theme: 'Abject', nm: 'Abject Obdella', boss: 'Ghatjot',
    chests: ['A1','A2','A3','A4','A5'],
    caskets: ['A1','A2'],
    coffer: 'A',
  },
  {
    id: 'B', floor: 'Ground', theme: 'Biune', nm: 'Biune Porxie', boss: 'Leshonn',
    chests: ['B1','B2','B3','B4','B5'],
    caskets: ['B1','B2'],
    coffer: 'B',
  },
  {
    id: 'C', floor: 'Ground', theme: 'Cachaemic', nm: 'Cachaemic Bhoot', boss: 'Skomora',
    chests: ['C1','C2','C3','C4','C5'],
    caskets: ['C1','C2'],
    coffer: 'C',
  },
  {
    id: 'D', floor: 'Ground', theme: 'Demisang', nm: 'Demisang Deleterious', boss: 'Degei',
    chests: ['D1','D2','D3','D4','D5'],
    caskets: ['D1','D2'],
    coffer: 'D',
  },
  {
    id: 'E', floor: 'Basement', theme: 'Esurient', nm: 'Esurient Botulus', boss: 'Dhartok',
    chests: ['E'],
    caskets: ['E1','E2'],
    coffer: 'E',
  },
  {
    id: 'F', floor: 'Basement', theme: 'Fetid', nm: 'Fetid Ixion', boss: 'Gartell',
    chests: ['F'],
    caskets: ['F1','F2'],
    coffer: 'F',
  },
  {
    id: 'G', floor: 'Basement', theme: 'Gyvewrapped', nm: 'Gyvewrapped Naraka', boss: 'Triboulex',
    chests: ['G'],
    caskets: ['G1','G2'],
    coffer: 'G',
  },
  {
    id: 'H', floor: 'Basement', theme: 'Haughty', nm: 'Haughty Tulittia', boss: 'Aita',
    chests: ['H'],
    caskets: ['H1','H2'],
    coffer: 'H',
  },
];
