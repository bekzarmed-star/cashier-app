import { BMS_API_URL } from './config';

export interface AdminUser {
  id: string;
  username: string;
  name: string;
  role: 'cashier' | 'supervisor' | 'admin';
  counterId: string;
  active: boolean;
  createdAt?: string;
}

export interface AdminExcelFileMeta {
  id: string;
  name: string;
  createdBy?: string;
  createdByName?: string;
  updatedBy?: string;
  updatedByName?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AdminExcelFile extends AdminExcelFileMeta {
  headers: string[];
  data: (string | number | null)[][];
}

const TOKEN_KEY = 'zph_admin_token';
const ADMIN_KEY = 'zph_admin_user';

export function getAdminToken() {
  return localStorage.getItem(TOKEN_KEY) || '';
}

export function clearAdminSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(ADMIN_KEY);
}

async function adminFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers || {});
  const token = getAdminToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (!(init?.body instanceof FormData) && !headers.has('Content-Type') && init?.body) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(`${BMS_API_URL}/api/admin${path}`, {
    ...init,
    headers,
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data?.error || `Admin API ${res.status}`);
  return data as T;
}

export const adminApi = {
  async login(username: string, password: string, keyFile: File) {
    const body = new FormData();
    body.append('username', username);
    body.append('password', password);
    body.append('key', keyFile);
    const data = await adminFetch<{
      token: string;
      expiresAt: string;
      admin: AdminUser;
    }>('/login', { method: 'POST', body });
    localStorage.setItem(TOKEN_KEY, data.token);
    localStorage.setItem(ADMIN_KEY, JSON.stringify(data.admin));
    return data;
  },

  async logout() {
    try {
      await adminFetch('/logout', { method: 'POST' });
    } finally {
      clearAdminSession();
    }
  },

  async me() {
    return adminFetch<AdminUser>('/me');
  },

  listUsers() {
    return adminFetch<AdminUser[]>('/users');
  },

  createUser(input: {
    username: string;
    name: string;
    password: string;
    role?: string;
    counterId?: string;
  }) {
    return adminFetch<AdminUser>('/users', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  changeUserPassword(id: string, password: string) {
    return adminFetch<AdminUser>(`/users/${id}/password`, {
      method: 'PUT',
      body: JSON.stringify({ password }),
    });
  },

  updateUser(
    id: string,
    input: Partial<{ name: string; role: string; counterId: string; active: boolean }>,
  ) {
    return adminFetch<AdminUser>(`/users/${id}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    });
  },

  changeOwnPassword(currentPassword: string, newPassword: string) {
    return adminFetch<{ ok: boolean }>('/password', {
      method: 'PUT',
      body: JSON.stringify({ currentPassword, newPassword }),
    });
  },

  listExcelFiles() {
    return adminFetch<{ count: number; files: AdminExcelFileMeta[] }>('/excel/files');
  },

  getExcelFile(id: string) {
    return adminFetch<AdminExcelFile>(`/excel/files/${id}`);
  },

  createExcelFile(name: string) {
    return adminFetch<AdminExcelFile>('/excel/files', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
  },

  updateExcelFile(
    id: string,
    input: { name?: string; headers?: string[]; data?: (string | number | null)[][] },
  ) {
    return adminFetch<AdminExcelFile>(`/excel/files/${id}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    });
  },

  deleteExcelFile(id: string) {
    return adminFetch<{ ok: boolean }>(`/excel/files/${id}`, { method: 'DELETE' });
  },

  listEmployees(params: { q?: string; includeInactive?: boolean } = {}) {
    const qs = new URLSearchParams();
    if (params.q?.trim()) qs.set('q', params.q.trim());
    if (params.includeInactive) qs.set('includeInactive', '1');
    const suffix = qs.toString() ? `?${qs}` : '';
    return adminFetch<AdminEmployee[]>(`/employees${suffix}`);
  },

  createEmployee(input: { fullName: string; branchCode?: string; branchName?: string }) {
    return adminFetch<AdminEmployee>('/employees', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  updateEmployee(
    id: string,
    input: Partial<{ fullName: string; branchCode: string; branchName: string; active: boolean }>,
  ) {
    return adminFetch<AdminEmployee>(`/employees/${id}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    });
  },

  deleteEmployee(id: string) {
    return adminFetch<{ ok: boolean }>(`/employees/${id}`, { method: 'DELETE' });
  },
};

export interface AdminEmployee {
  id: string;
  fullName: string;
  branchCode: string;
  branchName: string;
  active: boolean;
  createdAt?: string;
  updatedAt?: string;
}
