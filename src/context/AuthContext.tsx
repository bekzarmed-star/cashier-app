import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { cashierApi } from '../api/cashierApi';
import { branchLabel, isValidBranchCode } from '../data/branches';
import type { CashierUser } from '../types';

interface AuthContextValue {
  user: CashierUser | null;
  login: (username: string, password: string, branchCode: string) => Promise<void>;
  setBranch: (branchCode: string) => void;
  updateUser: (patch: Partial<CashierUser>) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);
const STORAGE_KEY = 'zph_cashier_user';

function loadUser(): CashierUser | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const u = JSON.parse(raw) as CashierUser;
    // Old sessions without branch must log in again
    if (!isValidBranchCode(u.branchCode)) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    if (!u.branchLabel) u.branchLabel = branchLabel(u.branchCode);
    return u;
  } catch {
    return null;
  }
}

function persist(user: CashierUser | null) {
  if (!user) localStorage.removeItem(STORAGE_KEY);
  else localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CashierUser | null>(() => loadUser());

  const login = useCallback(async (username: string, password: string, branchCode: string) => {
    const code = String(branchCode || '').trim().toLowerCase();
    if (!isValidBranchCode(code)) {
      throw new Error('Выберите филиал');
    }
    const u = await cashierApi.login(username, password);
    const next: CashierUser = {
      ...u,
      branchCode: code,
      branchLabel: branchLabel(code),
    };
    persist(next);
    setUser(next);
  }, []);

  const setBranch = useCallback((branchCode: string) => {
    const code = String(branchCode || '').trim().toLowerCase();
    if (!isValidBranchCode(code)) return;
    setUser((prev) => {
      if (!prev) return prev;
      const next: CashierUser = {
        ...prev,
        branchCode: code,
        branchLabel: branchLabel(code),
      };
      persist(next);
      return next;
    });
  }, []);

  const updateUser = useCallback((patch: Partial<CashierUser>) => {
    setUser((prev) => {
      if (!prev) return prev;
      const next: CashierUser = { ...prev, ...patch };
      persist(next);
      return next;
    });
  }, []);

  const logout = useCallback(() => {
    persist(null);
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, login, setBranch, updateUser, logout }),
    [user, login, setBranch, updateUser, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
