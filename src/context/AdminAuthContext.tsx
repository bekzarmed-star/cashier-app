import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { adminApi, clearAdminSession, type AdminUser } from '../api/adminApi';

interface AdminAuthValue {
  admin: AdminUser | null;
  login: (username: string, password: string, keyFile: File) => Promise<void>;
  logout: () => Promise<void>;
}

const AdminAuthContext = createContext<AdminAuthValue | null>(null);
const ADMIN_KEY = 'zph_admin_user';

function loadAdmin(): AdminUser | null {
  try {
    const raw = localStorage.getItem(ADMIN_KEY);
    return raw ? (JSON.parse(raw) as AdminUser) : null;
  } catch {
    return null;
  }
}

export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const [admin, setAdmin] = useState<AdminUser | null>(() => loadAdmin());

  const login = useCallback(async (username: string, password: string, keyFile: File) => {
    const data = await adminApi.login(username, password, keyFile);
    setAdmin(data.admin);
  }, []);

  const logout = useCallback(async () => {
    await adminApi.logout();
    clearAdminSession();
    setAdmin(null);
  }, []);

  const value = useMemo(() => ({ admin, login, logout }), [admin, login, logout]);
  return <AdminAuthContext.Provider value={value}>{children}</AdminAuthContext.Provider>;
}

export function useAdminAuth() {
  const ctx = useContext(AdminAuthContext);
  if (!ctx) throw new Error('useAdminAuth must be used within AdminAuthProvider');
  return ctx;
}
