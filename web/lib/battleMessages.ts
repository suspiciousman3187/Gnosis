import type { RawBattleMessage } from '@/lib/types';
import { actionMessageText, lookupActionMessage } from '@/lib/actionMessages';

export type BattleMessageCategory =
  | 'death'
  | 'buff_gain'
  | 'buff_wear'
  | 'resist_no_effect'
  | 'resist_full'
  | 'resist_half'
  | 'resist_quarter'
  | 'resist_eighth'
  | 'magic_burst'
  | 'crit'
  | 'shadow_absorb'
  | 'interrupt'
  | 'cannot_use'
  | 'out_of_range'
  | 'dot_tick'
  | 'sp_ability'
  | 'recast_ready'
  | 'misc';

export interface BattleMessageMeta {
  category: BattleMessageCategory;
  label: string;
}

export const BATTLE_MESSAGE_DICT: Record<number, BattleMessageMeta> = {
  6:   { category: 'death',           label: 'is defeated' },
  20:  { category: 'death',           label: 'falls to the ground' },
  97:  { category: 'death',           label: 'is defeated' },
  113: { category: 'death',           label: 'is defeated' },
  406: { category: 'death',           label: 'falls' },
  605: { category: 'death',           label: 'is defeated' },
  646: { category: 'death',           label: 'is defeated' },
  756: { category: 'death',           label: 'is defeated' },

  64:  { category: 'buff_wear',       label: 'is no longer affected' },
  83:  { category: 'buff_wear',       label: 'effect wears off' },
  123: { category: 'buff_wear',       label: 'effect wears off' },
  159: { category: 'buff_wear',       label: 'effect wears off' },
  168: { category: 'buff_wear',       label: 'effect wears off' },
  204: { category: 'buff_wear',       label: 'effect wears off' },
  206: { category: 'buff_wear',       label: 'effect wears off' },
  350: { category: 'buff_wear',       label: 'effect wears off' },

  230: { category: 'buff_gain',       label: 'gains the effect' },
  263: { category: 'buff_gain',       label: 'pet gains the effect' },
  270: { category: 'buff_gain',       label: 'food effect' },

  75:  { category: 'resist_no_effect', label: 'spell had no effect' },
  85:  { category: 'resist_full',      label: 'fully resisted the spell' },
  284: { category: 'resist_no_effect', label: 'spell completely resisted' },
  653: { category: 'resist_half',      label: 'resisted (half effect)' },
  654: { category: 'resist_quarter',   label: 'resisted (quarter effect)' },
  655: { category: 'resist_eighth',    label: 'resisted (eighth effect)' },
  656: { category: 'resist_full',      label: 'fully resisted' },

  252: { category: 'magic_burst',     label: 'magic burst' },
  265: { category: 'magic_burst',     label: 'magic burst (variant)' },
  274: { category: 'magic_burst',     label: 'magic burst (variant)' },
  379: { category: 'magic_burst',     label: 'magic burst (cure)' },
  747: { category: 'magic_burst',     label: 'magic burst (variant)' },
  748: { category: 'magic_burst',     label: 'magic burst (variant)' },

  67:  { category: 'crit',            label: 'critical hit' },

  9:   { category: 'shadow_absorb',   label: 'shadow absorbed the attack' },
  33:  { category: 'shadow_absorb',   label: 'image disappears' },
  51:  { category: 'shadow_absorb',   label: 'images shielded' },

  28787: { category: 'interrupt',     label: 'casting interrupted' },

  21:  { category: 'cannot_use',      label: 'cannot move' },
  49:  { category: 'cannot_use',      label: 'cannot use ability' },
  71:  { category: 'cannot_use',      label: 'ability not ready' },

  86:  { category: 'out_of_range',    label: 'too far away' },

  102: { category: 'sp_ability',      label: 'uses special ability' },

  279: { category: 'dot_tick',        label: 'drown tick' },
  280: { category: 'dot_tick',        label: 'burn tick' },
  281: { category: 'dot_tick',        label: 'poison tick' },
};

export function classifyBattleMessage(m: RawBattleMessage): BattleMessageMeta | null {
  return BATTLE_MESSAGE_DICT[m.msgId] ?? null;
}

export function describeBattleMessage(msgId: number): { label: string; category: BattleMessageCategory | null; raw: string | null } {
  const cat = BATTLE_MESSAGE_DICT[msgId] ?? null;
  const raw = actionMessageText(msgId);
  return {
    label: cat?.label ?? raw ?? '?',
    category: cat?.category ?? null,
    raw,
  };
}

export { lookupActionMessage };

export function summarizeBattleMessages(messages: RawBattleMessage[] | null | undefined): {
  byCategory: Map<BattleMessageCategory, number>;
  byMsgId: Map<number, number>;
  unknownIds: Map<number, number>;
  total: number;
} {
  const byCategory = new Map<BattleMessageCategory, number>();
  const byMsgId = new Map<number, number>();
  const unknownIds = new Map<number, number>();
  if (!Array.isArray(messages)) return { byCategory, byMsgId, unknownIds, total: 0 };
  for (const m of messages) {
    byMsgId.set(m.msgId, (byMsgId.get(m.msgId) ?? 0) + 1);
    const meta = BATTLE_MESSAGE_DICT[m.msgId];
    if (meta) {
      byCategory.set(meta.category, (byCategory.get(meta.category) ?? 0) + 1);
    } else {
      unknownIds.set(m.msgId, (unknownIds.get(m.msgId) ?? 0) + 1);
    }
  }
  return { byCategory, byMsgId, unknownIds, total: messages.length };
}
