import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import {
  FileCheck2,
  FileSpreadsheet,
  KeyRound,
  LogOut,
  Plus,
  Shield,
  Trash2,
  UserPlus,
  Users,
  UserRound,
  Table2,
  BookMarked,
  LayoutDashboard,
} from 'lucide-react';
import { format } from 'date-fns';
import { useAdminAuth } from '../../context/AdminAuthContext';
import {
  adminApi,
  type AdminEmployee,
  type AdminExcelFileMeta,
  type AdminUser,
} from '../../api/adminApi';
import { HOSPITAL_NAME } from '../../api/config';

type Tab = 'users' | 'employees' | 'files' | 'security';

export function AdminPage() {
  const { admin, logout } = useAdminAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('users');
  const [error, setError] = useState('');
  const [hint, setHint] = useState('');

  const [users, setUsers] = useState<AdminUser[]>([]);
  const [employees, setEmployees] = useState<AdminEmployee[]>([]);
  const [files, setFiles] = useState<AdminExcelFileMeta[]>([]);
  const [loading, setLoading] = useState(true);

  const [newUser, setNewUser] = useState({
    username: '',
    name: '',
    password: '',
    role: 'cashier',
    counterId: 'C-01',
  });
  const [newEmployee, setNewEmployee] = useState({
    fullName: '',
    branchCode: '',
    branchName: '',
  });
  const [pwdEdits, setPwdEdits] = useState<Record<string, string>>({});
  const [newFileName, setNewFileName] = useState('');
  const [renameMap, setRenameMap] = useState<Record<string, string>>({});
  const [ownPwd, setOwnPwd] = useState({ current: '', next: '' });

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [u, e, f] = await Promise.all([
        adminApi.listUsers(),
        adminApi.listEmployees({ includeInactive: true }),
        adminApi.listExcelFiles(),
      ]);
      setUsers(u);
      setEmployees(e);
      setFiles(f.files);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось загрузить данные админки');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (admin) void refresh();
  }, [admin, refresh]);

  if (!admin) return <Navigate to="/admin/login" replace />;

  async function handleLogout() {
    await logout();
    navigate('/admin/login');
  }

  async function createAccount(e: FormEvent) {
    e.preventDefault();
    setError('');
    setHint('');
    try {
      await adminApi.createUser(newUser);
      setNewUser({
        username: '',
        name: '',
        password: '',
        role: 'cashier',
        counterId: 'C-01',
      });
      setHint('Аккаунт создан.');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка создания');
    }
  }

  async function changePassword(id: string) {
    const password = pwdEdits[id]?.trim();
    if (!password) return;
    setError('');
    try {
      await adminApi.changeUserPassword(id, password);
      setPwdEdits((m) => ({ ...m, [id]: '' }));
      setHint('Пароль обновлён.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка смены пароля');
    }
  }

  async function toggleActive(u: AdminUser) {
    try {
      await adminApi.updateUser(u.id, { active: !u.active });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка обновления');
    }
  }

  async function createEmployee(e: FormEvent) {
    e.preventDefault();
    setError('');
    setHint('');
    try {
      await adminApi.createEmployee(newEmployee);
      setNewEmployee({ fullName: '', branchCode: '', branchName: '' });
      setHint('Сотрудник добавлен. Он появится в Excel и на странице «Сотрудники».');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка добавления сотрудника');
    }
  }

  async function toggleEmployee(emp: AdminEmployee) {
    try {
      await adminApi.updateEmployee(emp.id, { active: !emp.active });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка обновления');
    }
  }

  async function deleteEmployee(emp: AdminEmployee) {
    if (!confirm(`Удалить сотрудника «${emp.fullName}»?`)) return;
    try {
      await adminApi.deleteEmployee(emp.id);
      setHint('Сотрудник удалён.');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка удаления');
    }
  }

  async function createFile(e: FormEvent) {
    e.preventDefault();
    try {
      await adminApi.createExcelFile(newFileName.trim() || `Лист ${format(new Date(), 'dd MMM HH:mm')}`);
      setNewFileName('');
      setHint('Excel файл создан.');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка создания файла');
    }
  }

  async function renameFile(id: string) {
    const name = renameMap[id]?.trim();
    if (!name) return;
    try {
      await adminApi.updateExcelFile(id, { name });
      setHint('Файл переименован.');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка переименования');
    }
  }

  async function deleteFile(id: string, name: string) {
    if (!confirm(`Удалить Excel файл «${name}»?`)) return;
    try {
      await adminApi.deleteExcelFile(id);
      setHint('Файл удалён.');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка удаления');
    }
  }

  async function changeOwnPassword(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      await adminApi.changeOwnPassword(ownPwd.current, ownPwd.next);
      setOwnPwd({ current: '', next: '' });
      setHint('Пароль администратора изменён.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка смены пароля');
    }
  }

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <div className="brand">
          <div className="brand-mark admin-mark">
            <Shield size={22} />
          </div>
          <div>
            <div className="brand-name">{HOSPITAL_NAME}</div>
            <div className="brand-sub">Админ-панель</div>
          </div>
        </div>
        <nav className="nav">
          <button
            type="button"
            className={tab === 'users' ? 'nav-link active' : 'nav-link'}
            onClick={() => setTab('users')}
          >
            <Users size={18} />
            Учётные записи
          </button>
          <button
            type="button"
            className={tab === 'employees' ? 'nav-link active' : 'nav-link'}
            onClick={() => setTab('employees')}
          >
            <UserRound size={18} />
            Сотрудники
          </button>
          <button
            type="button"
            className={tab === 'files' ? 'nav-link active' : 'nav-link'}
            onClick={() => setTab('files')}
          >
            <FileSpreadsheet size={18} />
            Excel файлы
          </button>
          <button
            type="button"
            className={tab === 'security' ? 'nav-link active' : 'nav-link'}
            onClick={() => setTab('security')}
          >
            <KeyRound size={18} />
            Безопасность
          </button>

          <div className="nav-divider" style={{ opacity: 0.35, margin: '10px 12px', borderTop: '1px solid #fff' }} />
          <div className="muted" style={{ padding: '4px 16px 6px', fontSize: '0.72rem', letterSpacing: '0.04em', textTransform: 'uppercase', color: '#9eb6cc' }}>
            Касса
          </div>
          <Link to="/erp-invoices" className="nav-link">
            <FileCheck2 size={18} />
            Счета ERP
          </Link>
          <Link to="/excel" className="nav-link">
            <Table2 size={18} />
            Excel (касса)
          </Link>
          <Link to="/" className="nav-link">
            <LayoutDashboard size={18} />
            Главная кассы
          </Link>
          <Link to="/codes" className="nav-link">
            <BookMarked size={18} />
            Коды счетов
          </Link>
        </nav>
        <div className="sidebar-foot">
          <div className="user-chip">
            <div className="user-avatar">{admin.name.slice(0, 1)}</div>
            <div>
              <div className="user-name">{admin.name}</div>
              <div className="user-meta">{admin.username}</div>
            </div>
          </div>
          <button type="button" className="btn ghost full" onClick={() => void handleLogout()}>
            <LogOut size={16} />
            Выйти
          </button>
          <Link to="/login" className="text-link" style={{ textAlign: 'center', color: '#cfe0f0' }}>
            Вход кассира
          </Link>
          <Link to="/erp-invoices" className="btn primary full" style={{ marginTop: 8 }}>
            <FileCheck2 size={16} />
            Открыть Счета ERP
          </Link>
        </div>
      </aside>

      <main className="admin-main">
        <header className="page-header">
          <div>
            <h1>
              {tab === 'users' && 'Учётные записи'}
              {tab === 'employees' && 'Сотрудники'}
              {tab === 'files' && 'Excel файлы'}
              {tab === 'security' && 'Безопасность администратора'}
            </h1>
            <p className="muted">
              {tab === 'employees'
                ? 'Добавление сотрудников для Excel и списка работников'
                : 'Управление кассирами, паролями и таблицами Excel'}
            </p>
          </div>
        </header>

        {error && <div className="alert error">{error}</div>}
        {hint && <div className="excel-hint" style={{ marginBottom: 12 }}>{hint}</div>}
        {loading && <div className="muted">Загрузка…</div>}

        {tab === 'users' && !loading && (
          <>
            <form className="panel" onSubmit={createAccount} style={{ marginBottom: 16 }}>
              <div className="panel-head">
                <h2>
                  <UserPlus size={18} style={{ verticalAlign: '-3px', marginRight: 6 }} />
                  Создать аккаунт
                </h2>
              </div>
              <div className="admin-form-grid">
                <label className="field">
                  <span>Логин</span>
                  <input
                    value={newUser.username}
                    onChange={(e) => setNewUser({ ...newUser, username: e.target.value })}
                    required
                  />
                </label>
                <label className="field">
                  <span>Полное имя</span>
                  <input
                    value={newUser.name}
                    onChange={(e) => setNewUser({ ...newUser, name: e.target.value })}
                    required
                  />
                </label>
                <label className="field">
                  <span>Надёжный пароль</span>
                  <input
                    type="password"
                    value={newUser.password}
                    onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                    required
                    placeholder="12+ символов, Aa1!"
                  />
                </label>
                <label className="field">
                  <span>Роль</span>
                  <select
                    value={newUser.role}
                    onChange={(e) => setNewUser({ ...newUser, role: e.target.value })}
                  >
                    <option value="cashier">кассир</option>
                    <option value="supervisor">супервизор</option>
                    <option value="admin">админ</option>
                  </select>
                </label>
                <label className="field">
                  <span>Касса</span>
                  <input
                    value={newUser.counterId}
                    onChange={(e) => setNewUser({ ...newUser, counterId: e.target.value })}
                  />
                </label>
              </div>
              <button type="submit" className="btn primary" style={{ marginTop: 12 }}>
                <Plus size={16} />
                Создать аккаунт
              </button>
            </form>

            <section className="panel">
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Пользователь</th>
                      <th>Роль</th>
                      <th>Касса</th>
                      <th>Статус</th>
                      <th>Сменить пароль</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((u) => (
                      <tr key={u.id}>
                        <td>
                          <div className="cell-title">{u.name}</div>
                          <div className="cell-sub">{u.username}</div>
                        </td>
                        <td>
                          <code>{u.role}</code>
                        </td>
                        <td>{u.counterId}</td>
                        <td>
                          <span className={`chip ${u.active ? 'method-cash' : 'method-card'}`}>
                            {u.active ? 'активен' : 'отключён'}
                          </span>
                        </td>
                        <td>
                          <div className="admin-inline">
                            <input
                              type="password"
                              placeholder="Новый надёжный пароль"
                              value={pwdEdits[u.id] || ''}
                              onChange={(e) =>
                                setPwdEdits((m) => ({ ...m, [u.id]: e.target.value }))
                              }
                            />
                            <button
                              type="button"
                              className="btn"
                              onClick={() => void changePassword(u.id)}
                            >
                              Сохранить
                            </button>
                          </div>
                        </td>
                        <td>
                          <button type="button" className="btn" onClick={() => void toggleActive(u)}>
                            {u.active ? 'Отключить' : 'Включить'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}

        {tab === 'employees' && !loading && (
          <>
            <form className="panel" onSubmit={createEmployee} style={{ marginBottom: 16 }}>
              <div className="panel-head">
                <h2>
                  <UserPlus size={18} style={{ verticalAlign: '-3px', marginRight: 6 }} />
                  Добавить сотрудника
                </h2>
              </div>
              <div className="admin-form-grid">
                <label className="field">
                  <span>ФИО</span>
                  <input
                    value={newEmployee.fullName}
                    onChange={(e) => setNewEmployee({ ...newEmployee, fullName: e.target.value })}
                    required
                    placeholder="Например: Сайдиев Бектемир"
                  />
                </label>
                <label className="field">
                  <span>Код филиала</span>
                  <input
                    value={newEmployee.branchCode}
                    onChange={(e) => setNewEmployee({ ...newEmployee, branchCode: e.target.value })}
                    placeholder="SAM / KAR / …"
                  />
                </label>
                <label className="field">
                  <span>Филиал</span>
                  <input
                    value={newEmployee.branchName}
                    onChange={(e) => setNewEmployee({ ...newEmployee, branchName: e.target.value })}
                    placeholder="Самарканд"
                  />
                </label>
              </div>
              <button type="submit" className="btn primary" style={{ marginTop: 12 }}>
                <Plus size={16} />
                Добавить
              </button>
              <p className="muted" style={{ marginTop: 10, fontSize: '0.88rem' }}>
                Локальные сотрудники появляются в автодополнении Excel и на странице «Сотрудники»
                вместе с данными из внешней системы.
              </p>
            </form>

            <section className="panel">
              <div className="panel-head">
                <h2>Локальные сотрудники ({employees.length})</h2>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>ФИО</th>
                      <th>Код филиала</th>
                      <th>Филиал</th>
                      <th>Статус</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {employees.length === 0 && (
                      <tr>
                        <td colSpan={5} className="empty">
                          Пока нет локальных сотрудников. Добавьте первого выше.
                        </td>
                      </tr>
                    )}
                    {employees.map((emp) => (
                      <tr key={emp.id}>
                        <td>
                          <div className="cell-title">{emp.fullName}</div>
                          <div className="cell-sub">{emp.id}</div>
                        </td>
                        <td>
                          <code>{emp.branchCode || '—'}</code>
                        </td>
                        <td>{emp.branchName || '—'}</td>
                        <td>
                          <span className={`chip ${emp.active ? 'method-cash' : 'method-card'}`}>
                            {emp.active ? 'активен' : 'отключён'}
                          </span>
                        </td>
                        <td>
                          <div className="excel-actions">
                            <button
                              type="button"
                              className="btn"
                              onClick={() => void toggleEmployee(emp)}
                            >
                              {emp.active ? 'Отключить' : 'Включить'}
                            </button>
                            <button
                              type="button"
                              className="icon-btn"
                              title="Удалить"
                              onClick={() => void deleteEmployee(emp)}
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}

        {tab === 'files' && !loading && (
          <>
            <form className="panel excel-add-column" onSubmit={createFile}>
              <FileSpreadsheet size={18} />
              <label className="excel-add-column-field">
                <span>Имя нового Excel файла</span>
                <input
                  value={newFileName}
                  onChange={(e) => setNewFileName(e.target.value)}
                  placeholder="напр. отчёт за июль"
                />
              </label>
              <button type="submit" className="btn primary">
                <Plus size={16} />
                Создать файл
              </button>
            </form>

            <section className="panel" style={{ marginTop: 16 }}>
              <div className="panel-head">
                <h2>Все Excel файлы ({files.length})</h2>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Файл</th>
                      <th>Создал</th>
                      <th>Последнее изменение</th>
                      <th>Обновлён</th>
                      <th>Переименовать</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {files.length === 0 && (
                      <tr>
                        <td colSpan={6} className="empty">
                          Excel файлов пока нет.
                        </td>
                      </tr>
                    )}
                    {files.map((f) => (
                      <tr key={f.id}>
                        <td>
                          <div className="cell-title">{f.name}</div>
                          <div className="cell-sub">{f.id}</div>
                        </td>
                        <td>{f.createdByName || '—'}</td>
                        <td>{f.updatedByName || '—'}</td>
                        <td>{format(new Date(f.updatedAt), 'dd MMM yyyy HH:mm')}</td>
                        <td>
                          <div className="admin-inline">
                            <input
                              value={renameMap[f.id] ?? f.name}
                              onChange={(e) =>
                                setRenameMap((m) => ({ ...m, [f.id]: e.target.value }))
                              }
                            />
                            <button type="button" className="btn" onClick={() => void renameFile(f.id)}>
                              Сохранить
                            </button>
                          </div>
                        </td>
                        <td>
                          <div className="excel-actions">
                            <Link className="btn" to={`/admin/excel/${f.id}`}>
                              Редактировать
                            </Link>
                            <button
                              type="button"
                              className="icon-btn"
                              title="Удалить"
                              onClick={() => void deleteFile(f.id, f.name)}
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="muted" style={{ marginTop: 10, fontSize: '0.88rem' }}>
                Кто создал и последний раз редактировал каждый файл. Нажмите <strong>Редактировать</strong>, чтобы
                изменить ячейки, или создайте / переименуйте / удалите файлы здесь.
              </p>
            </section>
          </>
        )}

        {tab === 'security' && (
          <form className="panel narrow" onSubmit={changeOwnPassword}>
            <h2>Сменить пароль администратора</h2>
            <p className="muted">Должен оставаться надёжным (12+ символов, заглавные, строчные, цифра, символ).</p>
            <label className="field" style={{ marginTop: 12 }}>
              <span>Текущий пароль</span>
              <input
                type="password"
                value={ownPwd.current}
                onChange={(e) => setOwnPwd({ ...ownPwd, current: e.target.value })}
                required
              />
            </label>
            <label className="field">
              <span>Новый надёжный пароль</span>
              <input
                type="password"
                value={ownPwd.next}
                onChange={(e) => setOwnPwd({ ...ownPwd, next: e.target.value })}
                required
              />
            </label>
            <button type="submit" className="btn primary" style={{ marginTop: 12 }}>
              Обновить пароль
            </button>
            <div className="settings-help" style={{ marginTop: 16 }}>
              <p>
                Вход администратора также требует зарегистрированный <strong>файл ключа E-imzo</strong>, хранящийся в{' '}
                <code>server/keys/admin.eimzo.key</code>.
              </p>
            </div>
          </form>
        )}
      </main>
    </div>
  );
}
