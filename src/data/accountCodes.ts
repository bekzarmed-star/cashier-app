import raw from './accountCodes.json';
import type { AccountCode } from '../types/accountCode';
import { displayName } from '../types/accountCode';

/** Bundled chart of accounts (seed). Runtime list may grow via API. */
const BASE_CODES: AccountCode[] = raw as AccountCode[];

/** Live list used by search / Excel / ERP (mutated in place). */
export const ACCOUNT_CODES: AccountCode[] = [...BASE_CODES];

const byCode = new Map<string, AccountCode>();

function rebuildIndex() {
  byCode.clear();
  for (const c of ACCOUNT_CODES) {
    byCode.set(c.code.toUpperCase(), c);
  }
}
rebuildIndex();

function normalizeCode(c: AccountCode): AccountCode {
  return {
    code: String(c.code || '').trim().toUpperCase(),
    english: String(c.english || ''),
    russian: String(c.russian || ''),
    uzbek: String(c.uzbek || ''),
    note: String(c.note || ''),
    archived: Boolean(c.archived),
    group: c.group || 'Расход',
  };
}

/** Replace runtime list (e.g. after loading from API). */
export function replaceAccountCodes(codes: AccountCode[]) {
  const next = (codes.length ? codes : BASE_CODES).map(normalizeCode);
  ACCOUNT_CODES.length = 0;
  ACCOUNT_CODES.push(...next);
  rebuildIndex();
}

/** Insert or update one code in the runtime list. */
export function upsertAccountCode(code: AccountCode) {
  const next = normalizeCode(code);
  if (!next.code) return;
  const idx = ACCOUNT_CODES.findIndex((c) => c.code.toUpperCase() === next.code);
  if (idx >= 0) ACCOUNT_CODES[idx] = next;
  else ACCOUNT_CODES.push(next);
  rebuildIndex();
}

/** Look up a single account by code (case-insensitive). */
export function getAccountByCode(code: string): AccountCode | undefined {
  return byCode.get(code.trim().toUpperCase());
}

/** Active (non-archived) codes only. */
export function getActiveCodes(group?: string): AccountCode[] {
  return ACCOUNT_CODES.filter((c) => !c.archived && (!group || c.group === group));
}

/**
 * Search by code, English / Russian / Uzbek name, or note.
 * Exact code match is ranked first.
 */
export function searchAccountCodes(
  query: string,
  opts?: { includeArchived?: boolean; group?: string },
): AccountCode[] {
  const q = query.trim().toLowerCase();
  let list = opts?.includeArchived
    ? [...ACCOUNT_CODES]
    : ACCOUNT_CODES.filter((c) => !c.archived);

  if (opts?.group) {
    list = list.filter((c) => c.group === opts.group);
  }

  if (!q) {
    return list.sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
  }

  const exact = list.filter((c) => c.code.toLowerCase() === q);
  const starts = list.filter(
    (c) => c.code.toLowerCase().startsWith(q) && c.code.toLowerCase() !== q,
  );
  const rest = list.filter((c) => {
    const code = c.code.toLowerCase();
    if (code === q || code.startsWith(q)) return false;
    return (
      code.includes(q) ||
      c.english.toLowerCase().includes(q) ||
      c.russian.toLowerCase().includes(q) ||
      c.uzbek.toLowerCase().includes(q) ||
      c.note.toLowerCase().includes(q)
    );
  });

  return [...exact, ...starts, ...rest];
}

export function accountLabel(code: string, lang: 'en' | 'ru' | 'uz' = 'en'): string {
  const c = getAccountByCode(code);
  if (!c) return code;
  const name = displayName(c, lang);
  return name ? `${c.code} — ${name}` : c.code;
}

export const ACCOUNT_GROUPS = ['Расход', 'Прочий приход'] as const;
