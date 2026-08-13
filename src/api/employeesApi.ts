import { BMS_API_URL } from './config';

export interface Employee {
  id: number | string;
  fullName: string;
  branchCode: string;
  branchName: string;
  source?: 'local' | 'external';
  active?: boolean;
}

export interface EmployeesPage {
  total: number;
  limit: number;
  offset: number;
  items: Employee[];
}

export interface EmployeesHealth {
  ok: boolean;
  total?: number;
  baseUrl?: string;
  error?: string;
}

async function api<T>(path: string): Promise<T> {
  const res = await fetch(`${BMS_API_URL}${path}`);
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data?.error || `API ${res.status}: ${path}`);
  return data as T;
}

export const employeesApi = {
  list(params: { limit?: number; offset?: number; q?: string } = {}): Promise<EmployeesPage> {
    const qs = new URLSearchParams();
    qs.set('limit', String(params.limit ?? 100));
    qs.set('offset', String(params.offset ?? 0));
    if (params.q?.trim()) qs.set('q', params.q.trim());
    return api(`/api/cashier/employees?${qs}`);
  },

  health(): Promise<EmployeesHealth> {
    return fetch(`${BMS_API_URL}/api/cashier/employees/health`).then(async (r) => {
      const data = (await r.json()) as EmployeesHealth;
      return data;
    });
  },
};
