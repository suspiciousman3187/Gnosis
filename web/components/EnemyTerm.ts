import { createContext, useContext } from 'react';

export const EnemyTermContext = createContext<string>('Boss');
export const useEnemyTerm = () => useContext(EnemyTermContext);
export const withTerm = (s: string, term: string) =>
  term === 'Boss' ? s : s.replace(/\bBoss\b/g, term);
