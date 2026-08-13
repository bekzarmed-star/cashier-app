import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { AdminAuthProvider, useAdminAuth } from './context/AdminAuthContext';
import { AppLayout } from './components/AppLayout';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { TransactionsPage } from './pages/TransactionsPage';
import { SettingsPage } from './pages/SettingsPage';
import { CodesPage } from './pages/CodesPage';
import { ExcelPage } from './pages/ExcelPage';
import { WorkersPage } from './pages/WorkersPage';
import { ErpInvoicesPage } from './pages/ErpInvoicesPage';
import { AdminLoginPage } from './pages/admin/AdminLoginPage';
import { AdminPage } from './pages/admin/AdminPage';
import { AdminExcelEditPage } from './pages/admin/AdminExcelEditPage';
import type { ReactNode } from 'react';

function Protected({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { admin } = useAdminAuth();
  if (!user && !admin) return <Navigate to="/login" replace />;
  return children;
}

function AdminProtected({ children }: { children: ReactNode }) {
  const { admin } = useAdminAuth();
  if (!admin) return <Navigate to="/admin/login" replace />;
  return children;
}

export default function App() {
  return (
    <AuthProvider>
      <AdminAuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          {/* Admin login is secret URL only — not shown in cashier menu */}
          <Route path="/admin/login" element={<AdminLoginPage />} />
          <Route
            path="/admin"
            element={
              <AdminProtected>
                <AdminPage />
              </AdminProtected>
            }
          />
          <Route
            path="/admin/excel/:id"
            element={
              <AdminProtected>
                <AdminExcelEditPage />
              </AdminProtected>
            }
          />
          <Route
            path="/"
            element={
              <Protected>
                <AppLayout />
              </Protected>
            }
          >
            <Route index element={<DashboardPage />} />
            <Route path="erp-invoices" element={<ErpInvoicesPage />} />
            <Route path="excel" element={<ExcelPage />} />
            <Route path="workers" element={<WorkersPage />} />
            <Route path="codes" element={<CodesPage />} />
            <Route path="transactions" element={<TransactionsPage />} />
            <Route path="settings" element={<SettingsPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AdminAuthProvider>
    </AuthProvider>
  );
}
