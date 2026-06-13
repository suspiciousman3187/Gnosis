import actionMessagesData from '@/lib/data/actionMessages.json';

export interface ActionMessageEntry {
  id: number;
  en?: string;
  color?: string;
}

const TABLE = actionMessagesData as unknown as Record<string, ActionMessageEntry>;

export function lookupActionMessage(id: number | null | undefined): ActionMessageEntry | null {
  if (id == null) return null;
  return TABLE[String(id)] ?? null;
}

export function actionMessageText(id: number | null | undefined): string | null {
  return lookupActionMessage(id)?.en ?? null;
}
