
export interface ChestIdEntry {
  type: 'Chest' | 'Casket' | 'Coffer';
  name: string;
}

export const CHEST_IDS: Record<number, ChestIdEntry> = {
  // ── Chests (5 per sector in A-D, 1 each in E-H) ─────────────
  21000193: { type: 'Chest',  name: 'A1' },
  21000194: { type: 'Chest',  name: 'B1' },
  21000195: { type: 'Chest',  name: 'C1' },
  21000196: { type: 'Chest',  name: 'D1' },
  21000197: { type: 'Chest',  name: 'A2' },
  21000198: { type: 'Chest',  name: 'B2' },
  21000199: { type: 'Chest',  name: 'C2' },
  21000200: { type: 'Chest',  name: 'D2' },
  21000201: { type: 'Chest',  name: 'A5' },
  21000202: { type: 'Chest',  name: 'B5' },
  21000203: { type: 'Chest',  name: 'C5' },
  21000204: { type: 'Chest',  name: 'D5' },
  21000205: { type: 'Chest',  name: 'A3' },
  21000206: { type: 'Chest',  name: 'B3' },
  21000207: { type: 'Chest',  name: 'C3' },
  21000208: { type: 'Chest',  name: 'D3' },
  21000209: { type: 'Chest',  name: 'A4' },
  21000210: { type: 'Chest',  name: 'B4' },
  21000211: { type: 'Chest',  name: 'C4' },
  21000212: { type: 'Chest',  name: 'D4' },
  21000213: { type: 'Chest',  name: 'E'  },
  21000214: { type: 'Chest',  name: 'F'  },
  21000215: { type: 'Chest',  name: 'G'  },
  21000216: { type: 'Chest',  name: 'H'  },
  21000217: { type: 'Chest',  name: '?'  }, // DAT label is just "Chest -"; sector unspecified

  // ── Caskets & Coffers (sectors A-D) ─────────────────────────
  21000218: { type: 'Casket', name: 'A1' },
  21000219: { type: 'Casket', name: 'A2' },
  21000220: { type: 'Coffer', name: 'A'  },
  21000221: { type: 'Casket', name: 'B1' },
  21000222: { type: 'Casket', name: 'B2' },
  21000223: { type: 'Coffer', name: 'B'  },
  21000224: { type: 'Casket', name: 'C1' },
  21000225: { type: 'Casket', name: 'C2' },
  21000226: { type: 'Coffer', name: 'C'  },
  21000227: { type: 'Casket', name: 'D1' },
  21000228: { type: 'Casket', name: 'D2' },
  21000229: { type: 'Coffer', name: 'D'  },

  // ── Aurum Coffer (upper level) ──────────────────────────────
  21000230: { type: 'Coffer', name: 'Aurum Ground' },

  // ── Caskets & Coffers (sectors E-G) ─────────────────────────
  21000231: { type: 'Casket', name: 'E1' },
  21000232: { type: 'Casket', name: 'E2' },
  21000233: { type: 'Coffer', name: 'E'  },
  21000234: { type: 'Casket', name: 'F1' },
  21000235: { type: 'Casket', name: 'F2' },
  21000236: { type: 'Coffer', name: 'F'  },
  21000237: { type: 'Casket', name: 'G1' },
  21000238: { type: 'Casket', name: 'G2' },
  21000239: { type: 'Coffer', name: 'G'  },

  // ── Sector H ────────────────────────────────────────────────
  21000240: { type: 'Casket', name: 'H1' },
  21000241: { type: 'Casket', name: 'H2' },
  21000242: { type: 'Coffer', name: 'H'  },

  // ── Aurum Coffer (basement) ─────────────────────────────────
  21000243: { type: 'Coffer', name: 'Aurum Basement' },
};

export function resolveChestId(npcId: number): ChestIdEntry | null {
  if (CHEST_IDS[npcId]) return CHEST_IDS[npcId];
  const zoneBase = Math.floor(npcId / 0x10000) * 0x10000;
  const canonical = zoneBase + 0x7000 + (npcId % 0x1000);
  return CHEST_IDS[canonical] ?? null;
}
