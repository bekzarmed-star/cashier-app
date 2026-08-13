import { BMS_API_URL, USE_MOCK } from './config';
import type { CashierUser } from '../types';

export interface ExcelFileMeta {
  id: string;
  name: string;
  createdBy?: string;
  createdByName?: string;
  updatedBy?: string;
  updatedByName?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ExcelFile extends ExcelFileMeta {
  headers: string[];
  data: (string | number | null)[][];
}

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

const LOCAL_FILES_KEY = 'zph_excel_files_index';

function localList(): ExcelFileMeta[] {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_FILES_KEY) || '[]') as ExcelFileMeta[];
  } catch {
    return [];
  }
}

function localSaveIndex(files: ExcelFileMeta[]) {
  localStorage.setItem(LOCAL_FILES_KEY, JSON.stringify(files));
}

function localGet(id: string): ExcelFile | null {
  try {
    const raw = localStorage.getItem(`zph_excel_file_${id}`);
    return raw ? (JSON.parse(raw) as ExcelFile) : null;
  } catch {
    return null;
  }
}

function localPut(file: ExcelFile) {
  localStorage.setItem(`zph_excel_file_${file.id}`, JSON.stringify(file));
  const list = localList().filter((f) => f.id !== file.id);
  list.unshift({
    id: file.id,
    name: file.name,
    createdBy: file.createdBy,
    createdByName: file.createdByName,
    updatedBy: file.updatedBy,
    updatedByName: file.updatedByName,
    createdAt: file.createdAt,
    updatedAt: file.updatedAt,
  });
  localSaveIndex(list);
}

export const excelFilesApi = {
  async list(): Promise<{ count: number; files: ExcelFileMeta[] }> {
    if (USE_MOCK) {
      const files = localList();
      return { count: files.length, files };
    }
    return api('/api/cashier/excel/files');
  },

  async get(id: string): Promise<ExcelFile> {
    if (USE_MOCK) {
      const file = localGet(id);
      if (!file) throw new Error('File not found');
      return file;
    }
    return api(`/api/cashier/excel/files/${id}`);
  },

  async create(input: {
    name: string;
    headers: string[];
    data: (string | number | null)[][];
    cashier?: CashierUser | null;
  }): Promise<ExcelFile> {
    if (USE_MOCK) {
      const now = new Date().toISOString();
      const file: ExcelFile = {
        id: `xf-${Date.now()}`,
        name: input.name,
        headers: input.headers,
        data: input.data,
        createdBy: input.cashier?.id,
        createdByName: input.cashier?.name,
        updatedBy: input.cashier?.id,
        updatedByName: input.cashier?.name,
        createdAt: now,
        updatedAt: now,
      };
      localPut(file);
      return file;
    }
    return api('/api/cashier/excel/files', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  async update(
    id: string,
    input: {
      name?: string;
      headers?: string[];
      data?: (string | number | null)[][];
      cashier?: CashierUser | null;
    },
  ): Promise<ExcelFile> {
    if (USE_MOCK) {
      const prev = localGet(id);
      if (!prev) throw new Error('File not found');
      const file: ExcelFile = {
        ...prev,
        name: input.name ?? prev.name,
        headers: input.headers ?? prev.headers,
        data: input.data ?? prev.data,
        updatedBy: input.cashier?.id ?? prev.updatedBy,
        updatedByName: input.cashier?.name ?? prev.updatedByName,
        updatedAt: new Date().toISOString(),
      };
      localPut(file);
      return file;
    }
    return api(`/api/cashier/excel/files/${id}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    });
  },

  async remove(id: string): Promise<void> {
    if (USE_MOCK) {
      localStorage.removeItem(`zph_excel_file_${id}`);
      localSaveIndex(localList().filter((f) => f.id !== id));
      return;
    }
    await api(`/api/cashier/excel/files/${id}`, { method: 'DELETE' });
  },
};
