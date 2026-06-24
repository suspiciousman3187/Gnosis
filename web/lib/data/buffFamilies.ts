export interface BuffFamilyDurationModel {
  initialSec: number;
  refreshSec: number;
  capSec: number;
}

export type BuffFamily = {
  name: string;
  ids: number[];
  durationModel?: BuffFamilyDurationModel;
};

const STEP_DURATION: BuffFamilyDurationModel = {
  initialSec: 60,
  refreshSec: 30,
  capSec: 120,
};

export const DANCE_STEP_FAMILIES: BuffFamily[] = [
  { name: 'Quickstep',    ids: [386, 387, 388, 389, 390], durationModel: STEP_DURATION },
  { name: 'Box Step',     ids: [391, 392, 393, 394, 395], durationModel: STEP_DURATION },
  { name: 'Stutter Step', ids: [396, 397, 398, 399, 400], durationModel: STEP_DURATION },
  { name: 'Feather Step', ids: [448, 449, 450, 451, 452], durationModel: STEP_DURATION },
];

export const ALL_BUFF_FAMILIES: BuffFamily[] = [
  ...DANCE_STEP_FAMILIES,
];

const FAMILY_BY_ID = new Map<number, BuffFamily>();
for (const fam of ALL_BUFF_FAMILIES) {
  for (const id of fam.ids) FAMILY_BY_ID.set(id, fam);
}

export function buffFamilyFor(id: number): BuffFamily | null {
  return FAMILY_BY_ID.get(id) ?? null;
}
