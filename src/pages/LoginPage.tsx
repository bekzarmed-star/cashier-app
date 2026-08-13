import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Building2, Lock, MapPin, User, UserPlus } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { cashierApi } from '../api/cashierApi';
import { employeesApi, type Employee } from '../api/employeesApi';
import { HOSPITAL_NAME, HOSPITAL_TAGLINE, USE_MOCK } from '../api/config';
import { BRANCHES } from '../data/branches';

type Mode = 'login' | 'register';

export function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>('login');

  const [username, setUsername] = useState('cashier');
  const [password, setPassword] = useState('1234');
  const [password2, setPassword2] = useState('');
  const [branchCode, setBranchCode] = useState('');
  const [workerName, setWorkerName] = useState('');
  const [workerOpen, setWorkerOpen] = useState(false);
  const [phone, setPhone] = useState('');

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [employeesLoading, setEmployeesLoading] = useState(false);
  const [employeesError, setEmployeesError] = useState('');

  const [error, setError] = useState('');
  const [hint, setHint] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (mode !== 'register') return;
    let alive = true;
    (async () => {
      setEmployeesLoading(true);
      setEmployeesError('');
      try {
        const page = await employeesApi.list({ limit: 500, offset: 0 });
        if (!alive) return;
        setEmployees(page.items || []);
      } catch (err) {
        if (!alive) return;
        setEmployees([]);
        setEmployeesError(
          err instanceof Error ? err.message : 'Не удалось загрузить список сотрудников',
        );
      } finally {
        if (alive) setEmployeesLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [mode]);

  const workerMatches = useMemo(() => {
    const q = workerName.trim().toLowerCase();
    const ranked = !q
      ? employees
      : [
          ...employees.filter((e) => e.fullName.toLowerCase().startsWith(q)),
          ...employees.filter((e) => {
            const name = e.fullName.toLowerCase();
            return !name.startsWith(q) && name.includes(q);
          }),
        ];
    const seen = new Set<string>();
    const unique: Employee[] = [];
    for (const e of ranked) {
      const key = e.fullName.trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      unique.push(e);
      if (unique.length >= 40) break;
    }
    return unique;
  }, [employees, workerName]);

  const exactWorker = useMemo(() => {
    const q = workerName.trim().toLowerCase();
    if (!q) return null;
    return employees.find((e) => e.fullName.trim().toLowerCase() === q) || null;
  }, [employees, workerName]);

  if (user?.branchCode) return <Navigate to="/" replace />;

  function switchMode(next: Mode) {
    setMode(next);
    setError('');
    setHint('');
    setWorkerOpen(false);
    if (next === 'register') {
      setUsername('');
      setPassword('');
      setPassword2('');
      setWorkerName('');
      setPhone('');
    } else {
      setUsername('cashier');
      setPassword('1234');
      setPassword2('');
    }
  }

  async function onLogin(e: FormEvent) {
    e.preventDefault();
    setError('');
    setHint('');
    if (!branchCode) {
      setError('Выберите филиал');
      return;
    }
    setLoading(true);
    try {
      await login(username.trim(), password, branchCode);
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка входа');
    } finally {
      setLoading(false);
    }
  }

  async function onRegister(e: FormEvent) {
    e.preventDefault();
    setError('');
    setHint('');
    if (!exactWorker) {
      setError('Выберите ФИО из списка сотрудников');
      return;
    }
    if (password !== password2) {
      setError('Пароли не совпадают');
      return;
    }
    if (password.length < 4) {
      setError('Пароль должен быть не короче 4 символов');
      return;
    }
    setLoading(true);
    try {
      const created = await cashierApi.register({
        username: username.trim(),
        password,
        name: exactWorker.fullName,
        phone: phone.trim(),
      });
      setHint(`Аккаунт «${created.username}» создан. Войдите с филиалом.`);
      setMode('login');
      setUsername(created.username);
      setPassword('');
      setPassword2('');
      setWorkerName('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось создать аккаунт');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-backdrop" aria-hidden />
      <form
        className="login-card"
        onSubmit={mode === 'login' ? onLogin : (e) => void onRegister(e)}
      >
        <div className="login-brand">
          <div className="brand-mark lg">
            <Building2 size={28} strokeWidth={1.6} />
          </div>
          <h1>{HOSPITAL_NAME}</h1>
          <p>
            {mode === 'login'
              ? `${HOSPITAL_TAGLINE} — рабочее место`
              : 'Регистрация кассира'}
          </p>
        </div>

        <div className="method-tabs codes-tabs" style={{ marginBottom: 14 }}>
          <button
            type="button"
            className={mode === 'login' ? 'active' : ''}
            onClick={() => switchMode('login')}
          >
            Вход
          </button>
          <button
            type="button"
            className={mode === 'register' ? 'active' : ''}
            onClick={() => switchMode('register')}
          >
            Создать аккаунт
          </button>
        </div>

        {error && <div className="alert error">{error}</div>}
        {hint && <div className="excel-hint" style={{ marginBottom: 12 }}>{hint}</div>}

        {mode === 'register' && (
          <label className="field">
            <span>ФИО (из списка сотрудников) *</span>
            <div className="input-wrap" style={{ position: 'relative', display: 'block' }}>
              <input
                value={workerName}
                onChange={(e) => {
                  setWorkerName(e.target.value);
                  setWorkerOpen(true);
                }}
                onFocus={() => setWorkerOpen(true)}
                onBlur={() => window.setTimeout(() => setWorkerOpen(false), 180)}
                placeholder={
                  employeesLoading
                    ? 'Загрузка сотрудников…'
                    : 'Начните вводить фамилию…'
                }
                autoComplete="off"
                required
              />
              {workerOpen && (
                <div className="erp-code-dropdown erp-recipient-dropdown">
                  {employeesError && (
                    <div className="erp-recipient-empty muted">{employeesError}</div>
                  )}
                  {!employeesError && employeesLoading && (
                    <div className="erp-recipient-empty muted">Загрузка…</div>
                  )}
                  {!employeesError && !employeesLoading && workerMatches.length === 0 && (
                    <div className="erp-recipient-empty muted">Сотрудник не найден</div>
                  )}
                  {workerMatches.map((e) => (
                    <button
                      key={String(e.id)}
                      type="button"
                      className="erp-code-option"
                      onMouseDown={(ev) => ev.preventDefault()}
                      onClick={() => {
                        setWorkerName(e.fullName);
                        setWorkerOpen(false);
                      }}
                    >
                      <code>{e.branchCode || '—'}</code>
                      <span>{e.fullName}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            {exactWorker && (
              <span className="muted" style={{ fontSize: '0.78rem' }}>
                Выбрано: {exactWorker.fullName}
                {exactWorker.branchName ? ` · ${exactWorker.branchName}` : ''}
              </span>
            )}
          </label>
        )}

        <label className="field">
          <span>Логин</span>
          <div className="input-wrap">
            <User size={16} />
            <input
              autoFocus={mode === 'login'}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder={mode === 'register' ? 'придумайте логин' : 'Логин'}
              autoComplete="username"
              required
            />
          </div>
        </label>

        <label className="field">
          <span>Пароль</span>
          <div className="input-wrap">
            <Lock size={16} />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Пароль"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              required
            />
          </div>
        </label>

        {mode === 'register' && (
          <>
            <label className="field">
              <span>Повтор пароля</span>
              <div className="input-wrap">
                <Lock size={16} />
                <input
                  type="password"
                  value={password2}
                  onChange={(e) => setPassword2(e.target.value)}
                  placeholder="Ещё раз"
                  autoComplete="new-password"
                  required
                />
              </div>
            </label>
            <label className="field">
              <span>Телефон (необязательно)</span>
              <div className="input-wrap">
                <UserPlus size={16} />
                <input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+998…"
                  autoComplete="tel"
                />
              </div>
            </label>
          </>
        )}

        {mode === 'login' && (
          <label className="field">
            <span>Филиал</span>
            <div className="input-wrap">
              <MapPin size={16} />
              <select
                value={branchCode}
                onChange={(e) => setBranchCode(e.target.value)}
                required
                aria-label="Филиал"
              >
                <option value="">Выберите филиал…</option>
                {BRANCHES.map((b) => (
                  <option key={b.code} value={b.code}>
                    {b.label}
                  </option>
                ))}
              </select>
            </div>
          </label>
        )}

        <button className="btn primary full" type="submit" disabled={loading}>
          {loading
            ? mode === 'login'
              ? 'Вход…'
              : 'Создание…'
            : mode === 'login'
              ? 'Войти'
              : 'Создать аккаунт'}
        </button>

        {mode === 'login' && USE_MOCK && (
          <p className="hint">
            Демо: <code>cashier</code> / <code>1234</code>
          </p>
        )}
        {mode === 'register' && (
          <p className="hint">
            ФИО только из списка сотрудников. После создания войдите и выберите филиал.
          </p>
        )}
      </form>
    </div>
  );
}
