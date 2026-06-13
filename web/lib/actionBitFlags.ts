export const BIT_FLAG_COVER        = 0x01;
export const BIT_FLAG_RESIST       = 0x02;
export const BIT_FLAG_MAGIC_BURST  = 0x04;
export const BIT_FLAG_IMMUNOBREAK  = 0x08;
export const BIT_FLAG_CRIT         = 0x10;

export interface DecodedBitFlags {
  cover: boolean;
  resist: boolean;
  magicBurst: boolean;
  immunobreak: boolean;
  crit: boolean;
}

export function decodeBitFlags(b: number | null | undefined): DecodedBitFlags {
  const v = b ?? 0;
  return {
    cover:       (v & BIT_FLAG_COVER)       !== 0,
    resist:      (v & BIT_FLAG_RESIST)      !== 0,
    magicBurst:  (v & BIT_FLAG_MAGIC_BURST) !== 0,
    immunobreak: (v & BIT_FLAG_IMMUNOBREAK) !== 0,
    crit:        (v & BIT_FLAG_CRIT)        !== 0,
  };
}
