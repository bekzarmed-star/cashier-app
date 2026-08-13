import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useEffect } from 'react';
import {
  LayoutDashboard,
  Receipt,
  LogOut,
  Building2,
  Settings,
  BookMarked,
  Table2,
  Users,
  FileCheck2,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useAdminAuth } from '../context/AdminAuthContext';
import { useCashierActor } from '../context/useCashierActor';
import { HOSPITAL_NAME, HOSPITAL_TAGLINE } from '../api/config';
import { BRANCHES } from '../data/branches';
import { codesApi } from '../api/codesApi';
import { roleRu } from '../i18n/ru';

const links = [
  { to: '/', label: 'Главная', icon: LayoutDashboard, end: true },
  { to: '/erp-invoices', label: 'Счета ERP', icon: FileCheck2 },
  { to: '/excel', label: 'Excel', icon: Table2 },
  { to: '/workers', label: 'Сотрудники', icon: Users },
  { to: '/codes', label: 'Коды счетов', icon: BookMarked },
  { to: '/transactions', label: 'Транзакции', icon: Receipt },
  { to: '/settings', label: 'Настройки', icon: Settings },
];

export function AppLayout() {
  const { user, setBranch, logout: cashierLogout } = useAuth();
  const { admin, logout: adminLogout } = useAdminAuth();
  const actor = useCashierActor();
  const navigate = useNavigate();

  useEffect(() => {
    void codesApi.refreshRuntime();
  }, []);

  async function handleLogout() {
    if (user) cashierLogout();
    if (admin) await adminLogout();
    navigate('/login');
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <Building2 size={22} strokeWidth={1.75} />
          </div>
          <div>
            <div className="brand-name">{HOSPITAL_NAME}</div>
            <div className="brand-sub">{HOSPITAL_TAGLINE}</div>
          </div>
        </div>

        <nav className="nav">
          {links.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
            >
              <Icon size={18} strokeWidth={1.75} />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-foot">
          {user && (
            <label className="field sidebar-branch">
              <span>Филиал</span>
              <select
                value={user.branchCode}
                onChange={(e) => setBranch(e.target.value)}
                aria-label="Филиал кассы"
              >
                {BRANCHES.map((b) => (
                  <option key={b.code} value={b.code}>
                    {b.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="user-chip">
            <div className="user-avatar">{actor?.name?.slice(0, 1)}</div>
            <div>
              <div className="user-name">{actor?.name}</div>
              <div className="user-meta">
                {roleRu(actor?.role)} · {actor?.branchLabel || '—'} · Касса {actor?.counterId}
              </div>
            </div>
          </div>
          <button type="button" className="btn ghost full" onClick={() => void handleLogout()}>
            <LogOut size={16} />
            Выйти
          </button>
        </div>
      </aside>

      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
