import { BMS_API_URL, USE_MOCK } from './config';
import type { AccountCode } from '../types/accountCode';
import {
  ACCOUNT_CODES,
  replaceAccountCodes,
  upsertAccountCode,
} from '../data/accountCodes';

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BMS_API_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data?.error || `API ${res.status}: ${path}`);
  return data as T;
}

export type NewAccountCodeInput = {
  code: string;
  russian?: string;
  uzbek?: string;
  english?: string;
  note?: string;
  group?: string;
  archived?: boolean;
};

export const codesApi = {
  async list(opts?: {
    q?: string;
    group?: string;
    includeArchived?: boolean;
  }): Promise<AccountCode[]> {
    if (USE_MOCK) {
      return [...ACCOUNT_CODES];
    }
    const params = new URLSearchParams();
    if (opts?.q) params.set('q', opts.q);
    if (opts?.group) params.set('group', opts.group);
    if (opts?.includeArchived) params.set('includeArchived', 'true');
    const qs = params.toString();
    return api<AccountCode[]>(`/api/cashier/codes${qs ? `?${qs}` : ''}`);
  },

  /** Load all codes from API into the shared in-memory chart. */
  async refreshRuntime(): Promise<AccountCode[]> {
    try {
      const list = await this.list({ includeArchived: true });
      if (list.length) replaceAccountCodes(list);
      return [...ACCOUNT_CODES];
    } catch {
      return [...ACCOUNT_CODES];
    }
  },

  async create(input: NewAccountCodeInput): Promise<AccountCode> {
    if (USE_MOCK) {
      const code: AccountCode = {
        code: String(input.code || '').trim().toUpperCase(),
        english: String(input.english || '').trim(),
        russian: String(input.russian || '').trim(),
        uzbek: String(input.uzbek || '').trim(),
        note: String(input.note || '').trim(),
        archived: Boolean(input.archived),
        group: input.group === 'Прочий приход' ? 'Прочий приход' : 'Расход',
      };
      if (!code.code) throw new Error('Укажите код счёта');
      if (ACCOUNT_CODES.some((c) => c.code.toUpperCase() === code.code)) {
        throw new Error(`Код «${code.code}» уже существует`);
      }
      if (!code.russian && !code.uzbek && !code.english) {
        throw new Error('Укажите название');
      }
      upsertAccountCode(code);
      return code;
    }

    const created = await api<AccountCode>('/api/cashier/codes', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    upsertAccountCode(created);
    return created;
  },
};
