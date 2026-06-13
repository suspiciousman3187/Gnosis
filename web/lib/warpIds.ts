
export interface WarpConfig {
  /** menuId → area name (fires enter_area in the addon) */
  warpEnter: Record<number, string>;
  /** area name → area to return to when exiting a boss room (menu ID 1009) */
  bossExitArea: Record<string, string>;
  /** menu IDs that return the player to Ground Floor (bitzer exits from upper sectors) */
  warpExitIds: number[];
  /** menu ID for the generic "exit boss room" gadget */
  bossExitMenuId: number;
  /** menu ID for the "exit Aminon" gadget */
  aminonExitMenuId: number;
  /** area to return to after exiting Aminon */
  aminonExitArea: string;
}

export const WARP_CONFIG: WarpConfig = {
  warpEnter: {
    1005: 'Boss A', 1006: 'Boss B', 1007: 'Boss C', 1008: 'Boss D',
    1010: 'Sector E', 1011: 'Sector F', 1012: 'Sector G', 1013: 'Sector H',
    1018: 'Boss E',  1019: 'Boss F',  1020: 'Boss G',  1021: 'Boss H',
    1022: 'Aminon',
  },
  bossExitArea: {
    'Boss A': 'Ground Floor', 'Boss B': 'Ground Floor',
    'Boss C': 'Ground Floor', 'Boss D': 'Ground Floor',
    'Boss E': 'Sector E',    'Boss F': 'Sector F',
    'Boss G': 'Sector G',    'Boss H': 'Sector H',
  },
  warpExitIds: [1014, 1015, 1016, 1017],
  bossExitMenuId: 1009,
  aminonExitMenuId: 1023,
  aminonExitArea: 'Sector E',
};
