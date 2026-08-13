import { useAuth } from './AuthContext';
import { useAdminAuth } from './AdminAuthContext';
import type { CashierUser } from '../types';

/** Active operator: cashier session, or admin acting with full access. */
export function useCashierActor(): CashierUser | null {
  const { user } = useAuth();
  const { admin } = useAdminAuth();
  if (user) return user;
  if (admin) {
    return {
      id: admin.id,
      name: admin.name || admin.username || 'Admin',
      username: admin.username,
      role: 'admin',
      counterId: 'ADM',
      branchCode: '',
      branchLabel: 'Все филиалы',
    };
  }
  return null;
}
