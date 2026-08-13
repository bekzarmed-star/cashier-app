export type AccountGroup = 'Расход' | 'Прочий приход' | string;

export interface AccountCode {
  /** Chart-of-accounts code, e.g. A1, C8, P5 */
  code: string;
  english: string;
  russian: string;
  uzbek: string;
  /** Usage note (Izoh) */
  note: string;
  archived: boolean;
  /** Расход = expense, Прочий приход = other income */
  group: AccountGroup;
}

export function displayName(c: AccountCode, lang: 'en' | 'ru' | 'uz' = 'en'): string {
  if (lang === 'ru') return c.russian || c.english || c.uzbek;
  if (lang === 'uz') return c.uzbek || c.english || c.russian;
  return c.english || c.russian || c.uzbek;
}

export function isParentCode(code: string): boolean {
  return /^[A-Z]$/i.test(code.trim());
}
